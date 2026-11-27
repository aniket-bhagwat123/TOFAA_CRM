"""Orders: won deals being delivered, kept in their own `orders` table (migration 20260115000000_orders.sql).
A database trigger creates the order when a lead becomes Closed Won. Delivery moves through
Production -> Quality check -> Dispatched -> Delivered, and every change is kept in `order_status_history`."""
import logging

from src.core import cache
from src.core.access import require_lead_role, visible_owner_ids
from src.core.audit import write_audit
from src.core.dates import now_ist
from src.core.errors import AppError, ForbiddenError, NotFoundError
from src.core.pagination import PageParams, page_meta
from src.core.supabase import get_service_client
from src.core.timeline import add_activity
from src.core.soft_delete import live
from src.modules.auth.schemas import Profile, Role
from src.modules.leads import service as leads

log = logging.getLogger(__name__)
STEPS = ["production", "quality_check", "dispatched", "delivered"]
LABEL = {"new": "Not started", "production": "Production", "quality_check": "Quality check", "dispatched": "Dispatched", "delivered": "Delivered"}
NOT_READY = "Orders are not set up yet. An admin needs to apply the database migration 20260115000000_orders.sql, then try again."
ORDER_FIELDS = "id,order_number,lead_id,status,status_updated_at,amount,expected_delivery,delivered_at,created_at,lead:leads!inner(id,owner_id,company_id,contact_id)"
NOWHERE = "00000000-0000-0000-0000-000000000000"


def _missing(exc: Exception) -> bool:
    text = str(exc)
    return "orders" in text and ("does not exist" in text or "42P01" in text or "PGRST205" in text)


def _kam_companies(user: Profile) -> list[str]:
    """The client accounts a KAM looks after."""
    rows = live(get_service_client().table("companies").select("id"), "companies").eq("account_owner_id", user.id).limit(5000).execute().data
    return [r["id"] for r in rows] or [NOWHERE]


def _own_order_leads(user: Profile) -> list[str]:
    """Deals with an order that the user closed themselves, whoever looks after the account."""
    rows = get_service_client().table("orders").select("lead_id,lead:leads!inner(owner_id)").eq("lead.owner_id", user.id).limit(500).execute().data
    return [r["lead_id"] for r in rows] or [NOWHERE]


def _scoped(q, user: Profile, owner_id: str | None):
    """Only orders whose deal the user may see (a manager or admin all, a KAM the orders of their own accounts and
    of their own deals)."""
    if user.role == Role.KAM:
        return q.or_(f"company_id.in.({','.join(_kam_companies(user))}),lead_id.in.({','.join(_own_order_leads(user))})")
    owners = visible_owner_ids(user)
    if owner_id:
        return q.eq("lead.owner_id", owner_id if owners is None or owner_id in owners else NOWHERE)
    return q.in_("lead.owner_id", owners) if owners is not None else q


def _row(order: dict, lead: dict) -> dict:
    """The deal (company, contact, owner, photo, value) with the order on top, in the shape the Orders screen uses."""
    status = order["status"]
    return {
        **lead,
        "order_id": order["id"], "order_number": order["order_number"], "order_amount": order.get("amount"),
        "delivery_status": None if status == "new" else status, "delivery_updated_at": order.get("status_updated_at"),
        "expected_delivery": order.get("expected_delivery"), "delivered_at": order.get("delivered_at"),
    }


def list_orders(user: Profile, page: PageParams, *, status: str | None = None, owner_id: str | None = None) -> dict:
    """Orders, newest first, with how many are at each step. `status=new` means not started yet."""
    require_lead_role(user)

    def load() -> dict:
        db = get_service_client()
        q = _scoped(db.table("orders").select(ORDER_FIELDS, count="exact"), user, owner_id)
        if status in ("new", *STEPS):
            q = q.eq("status", status)
        if page.search and page.search.strip():
            companies, contacts = leads._matching_ids(page.search)
            clauses = ([f"company_id.in.({','.join(companies)})"] if companies else []) + ([f"contact_id.in.({','.join(contacts)})"] if contacts else [])
            q = q.or_(",".join(clauses), reference_table="lead") if clauses else q.eq("lead.company_id", NOWHERE)
        try:
            res = q.order("created_at", desc=True).range(page.start, page.end).execute()
        except Exception as exc:
            if _missing(exc):
                raise AppError(NOT_READY, status_code=503) from exc
            raise
        orders = res.data
        lead_rows = (
            db.table("leads").select(leads.LEAD_SELECT).in_("id", [o["lead_id"] for o in orders]).execute().data if orders else []
        )
        by_id = {lead["id"]: lead for lead in leads.attach_photos(lead_rows)}
        items = [_row(o, by_id[o["lead_id"]]) for o in orders if o["lead_id"] in by_id]

        counts = {s: 0 for s in ["new", *STEPS]}
        try:
            for r in _scoped(db.table("orders").select("status,lead:leads!inner(owner_id)"), user, owner_id).limit(5000).execute().data:
                counts[r["status"]] = counts.get(r["status"], 0) + 1
        except Exception:  # noqa: BLE001 - counts are a nicety
            log.warning("could not count orders", exc_info=True)
        return {"items": items, "meta": page_meta(page, res.count or 0), "counts": counts}

    return cache.memo("orders", user.id, {"p": page.page, "l": page.limit, "q": page.search, "s": status, "o": owner_id}, 20, load)


def _lead_for(user: Profile, lead_id: str) -> dict:
    """The order's deal, if the user may see it. A KAM may when the deal is theirs, or its client is one of their accounts."""
    if user.role != Role.KAM:
        return leads.get_lead_row(user, lead_id)
    rows = get_service_client().table("leads").select(leads.LEAD_SELECT).eq("id", lead_id).limit(1).execute().data
    if not rows:
        raise NotFoundError("Order not found.")
    if rows[0].get("owner_id") != user.id and rows[0].get("company_id") not in _kam_companies(user):
        raise ForbiddenError("This order is for another account.")
    return leads.attach_photos(rows)[0]


def _order_for(lead: dict) -> dict:
    """The lead's order. Made here if the trigger has not (for example a deal won before the migration ran)."""
    db = get_service_client()
    try:
        rows = db.table("orders").select("*").eq("lead_id", lead["id"]).limit(1).execute().data
        if rows:
            if rows[0].get("deleted_at"):
                raise NotFoundError("This order was deleted.")
            return rows[0]
        amount = lead.get("paid_amount") or lead.get("quote_amount") or lead.get("estimate_amount")
        return db.table("orders").insert({"lead_id": lead["id"], "company_id": lead.get("company_id"), "amount": amount}).execute().data[0]
    except NotFoundError:
        raise
    except Exception as exc:
        if _missing(exc):
            raise AppError(NOT_READY, status_code=503) from exc
        raise


def set_status(user: Profile, lead_id: str, status: str, note: str | None = None) -> dict:
    """Move an order to a delivery step (any step: forward, or back to correct a mistake). Kept in the history."""
    if status not in STEPS:
        raise AppError("Pick a delivery step.", status_code=422)
    lead = _lead_for(user, lead_id)
    if lead["stage"] != "closed_won":
        raise AppError("Only won deals are orders.", status_code=409)
    order = _order_for(lead)
    current = order["status"]
    if current == status:
        return {"leadId": lead_id, "orderNumber": order["order_number"], "deliveryStatus": status}

    db = get_service_client()
    now = now_ist().isoformat()
    patch = {"status": status, "status_updated_at": now, "updated_at": now, "delivered_at": now if status == "delivered" else None}
    db.table("orders").update(patch).eq("id", order["id"]).execute()
    db.table("order_status_history").insert({"order_id": order["id"], "from_status": current, "to_status": status, "changed_by": user.id, "note": note}).execute()
    try:
        add_activity(lead_id, user.id, "order", outcome=status, note=f"Order {order['order_number']}: {LABEL.get(current, current)} -> {LABEL[status]}",
                     meta={"orderId": order["id"], "from": current, "to": status})
    except Exception:  # noqa: BLE001 - the timeline entry needs migration 20260114; the order itself is saved either way
        log.warning("could not add the order timeline entry", exc_info=True)
    write_audit(user.id, "order_status", "orders", order["id"], {"from": current, "to": status, "lead": lead_id})
    return {"leadId": lead_id, "orderNumber": order["order_number"], "deliveryStatus": status}


def history(user: Profile, lead_id: str) -> list[dict]:
    """Every step change of the lead's order, newest first, with who made it."""
    _lead_for(user, lead_id)  # access check
    db = get_service_client()
    try:
        rows = db.table("orders").select("id").eq("lead_id", lead_id).limit(1).execute().data
        if not rows:
            return []
        return (
            db.table("order_status_history").select("from_status,to_status,note,created_at,by:profiles!changed_by(full_name)")
            .eq("order_id", rows[0]["id"]).order("created_at", desc=True).limit(50).execute().data
        )
    except Exception as exc:
        if _missing(exc):
            raise AppError(NOT_READY, status_code=503) from exc
        raise
