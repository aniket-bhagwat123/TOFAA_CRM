"""The order APIs the order management system (OMS) calls. Server to server: header X-API-Key = OMS_INBOUND_KEY.

OMS sees only orders released to it, may read them, move them through the fulfilment stages and record the shipment.
It cannot create, edit or delete orders. The contract is in backend/OMS_ORDER_API.md.
"""
import hmac
import logging
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Security
from fastapi.security import APIKeyHeader
from pydantic import Field, StringConstraints

from src.core import cache
from src.core.config import settings
from src.core.dates import now_ist
from src.core.errors import AppError, ConflictError, NotFoundError, UnauthorizedError
from src.core.schema import CamelModel, ok
from src.core.supabase import get_service_client
from src.modules.orders import flow, rules
from src.modules.orders.schemas import Short, Status

log = logging.getLogger(__name__)
MIN_KEY_LENGTH = 32
ACTOR = "OMS"
# Named in the API docs, so Swagger shows an "Authorize" button for the key.
oms_key = APIKeyHeader(name="X-API-Key", scheme_name="OMS API key", description="The OMS key (OMS_INBOUND_KEY).", auto_error=False)


def require_oms_key(x_api_key: Annotated[str | None, Security(oms_key)] = None) -> None:
    expected = settings.OMS_INBOUND_KEY
    if len(expected) < MIN_KEY_LENGTH:
        log.warning("OMS_INBOUND_KEY is not set (or under %s characters): OMS call refused.", MIN_KEY_LENGTH)
        raise UnauthorizedError("A valid API key is required.")
    if not x_api_key or not hmac.compare_digest(x_api_key.encode(), expected.encode()):
        raise UnauthorizedError("A valid API key is required.")
    flow.require_upgraded()


router = APIRouter(prefix="/oms/orders", tags=["OMS"], dependencies=[Depends(require_oms_key)])


class Move(CamelModel):
    status: Status
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None
    oms_reference: Short | None = None


class Shipment(CamelModel):
    courier: Short | None = None
    tracking_number: Short | None = None
    tracking_url: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500, pattern=r"^(https?://\S+)?$")] | None = None
    expected_delivery: date | None = None
    oms_reference: Short | None = None


def _released():
    return get_service_client().table("orders").select(flow.SELECT, count="exact").not_.is_("released_at", "null").is_("deleted_at", "null")


def _find(order_number: str) -> dict:
    rows = _released().eq("order_number", order_number.strip().upper()).limit(1).execute().data
    if not rows:
        raise NotFoundError("Order not found.")
    return flow.snapshot(rows[0])


def view(order: dict) -> dict:
    """What OMS needs to make and ship an order. No internal notes, deals or payments."""
    sums = rules.money(order.get("items") or [], order.get("transportation"), order.get("gst_rate"))
    company = order.get("company") or {}
    contact, owner = flow._person(order)
    photos = [p for item in sums["lines"] for p in item.get("photos") or []]
    urls = flow.signed_urls(flow.DOCUMENTS, photos) if photos else {}
    return {
        "order_number": order["order_number"], "status": order["status"], "oms_reference": order.get("oms_reference"),
        "created_at": order.get("created_at"), "released_at": order.get("released_at"), "updated_at": order.get("updated_at"),
        "client": {"name": company.get("name"), "billing_name": order.get("billing_name"), "billing_gstin": order.get("billing_gstin")},
        "contact": {"name": contact.get("name"), "phone": contact.get("phone"), "email": contact.get("email")} if contact else None,
        "account_manager": (owner or {}).get("full_name"),
        "delivery": {"expected_date": order.get("expected_delivery"), "address": order.get("delivery_address"),
                     "receiver_name": order.get("receiver_name"), "receiver_phone": order.get("receiver_phone"),
                     "instructions": order.get("instructions")},
        "items": [{"line": n, "name": i["name"], "quantity": i["quantity"], "unit_price": i["unit_price"], "amount": i["amount"],
                   "gst_amount": i["gst_amount"], "line_total": i["line_total"], "contents": i.get("details") or [],
                   "photo_urls": [urls[p] for p in i.get("photos") or [] if p in urls]} for n, i in enumerate(sums["lines"], 1)],
        "totals": {k: sums[k] for k in ("units", "subtotal", "transportation", "gst_rate", "gst_amount", "total")},
        "shipment": {k: order.get(k) for k in ("courier", "tracking_number", "tracking_url")},
        "next_statuses": sorted(rules.oms_moves(order["status"], order.get("held_from"))),
    }


@router.get("")
def list_orders(status: Status | None = None, updated_since: Annotated[datetime | None, Query(alias="updatedSince")] = None,
                page: Annotated[int, Query(ge=1)] = 1, limit: Annotated[int, Query(ge=1, le=100)] = 25):
    q = _released()
    if status:
        q = q.eq("status", status)
    if updated_since:
        q = q.gte("updated_at", updated_since.isoformat())
    res = q.order("updated_at").order("order_number").range((page - 1) * limit, page * limit - 1).execute()
    return ok({"items": [view(flow.snapshot(r)) for r in res.data], "page": page, "limit": limit, "total": res.count or 0})


@router.get("/{order_number}")
def one(order_number: str):
    return ok(view(_find(order_number)))


@router.post("/{order_number}/status")
def change_status(order_number: str, body: Move):
    order = _find(order_number)
    if body.status == order["status"]:
        return ok(view(order), "Already in this stage.")  # a repeated call changes nothing
    allowed = rules.oms_moves(order["status"], order.get("held_from"))
    if body.status not in allowed:
        raise ConflictError(f"An order that is {order['status']} cannot move to {body.status}. Allowed: {', '.join(sorted(allowed)) or 'none'}.")
    if body.status in ("rejected", "on_hold") and not body.note:
        raise AppError("Send a note saying why.", status_code=422)
    extra = {"oms_reference": body.oms_reference} if body.oms_reference else None
    flow.move(order, body.status, actor_id=None, actor_name=ACTOR, note=body.note, extra=extra)
    flow.tell_owner(order, body.status, body.note)
    return ok(view(_find(order_number)), "Status updated.")


@router.put("/{order_number}/shipment")
def shipment(order_number: str, body: Shipment):
    order = _find(order_number)
    if order["status"] in ("delivered", "cancelled", "rejected", "ready"):
        raise ConflictError(f"Shipment details cannot change while the order is {order['status']}.")
    patch = body.model_dump(mode="json", exclude_unset=True)
    if not patch:
        raise AppError("Send at least one shipment field.", status_code=422)
    get_service_client().table("orders").update({**patch, "updated_at": now_ist().isoformat()}).eq("id", order["id"]).execute()
    cache.clear()
    return ok(view(_find(order_number)), "Shipment saved.")


@router.get("/{order_number}/history")
def history(order_number: str):
    order = _find(order_number)
    rows = (get_service_client().table("order_status_history").select("from_status,to_status,note,created_at,actor_name")
            .eq("order_id", order["id"]).order("created_at").limit(200).execute().data)
    return ok([{**r, "by": r.pop("actor_name") or "TOFAA"} for r in rows])
