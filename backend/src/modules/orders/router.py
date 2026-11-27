from typing import Annotated, Literal

from fastapi import APIRouter, Query

from src.core.pagination import PageDep
from src.core.schema import CamelModel, ok
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.orders import flow, schemas, service

router = APIRouter(prefix="/orders", tags=["orders"])


class StatusIn(CamelModel):
    status: Literal["production", "quality_check", "dispatched", "delivered"]
    note: str | None = None


@router.get("")
def list_orders(user: CurrentUserDep, page: PageDep, status: str | None = None, owner_id: Annotated[str | None, Query(alias="ownerId")] = None):
    if flow.upgraded():
        return ok(flow.list_orders(user, page, status=status, owner_id=owner_id))
    return ok(service.list_orders(user, page, status=status, owner_id=owner_id))


@router.post("", status_code=201)
def create(body: schemas.OrderCreate, user: CurrentUserDep):
    data = body.model_dump(mode="json")
    items = data.pop("items")
    made = flow.create(user, data.pop("company_id"), items, data.pop("transportation"), data.pop("gst_rate"), data)
    return ok(made, "Order created.")


@router.get("/by-id/{order_id}")
def detail(order_id: str, user: CurrentUserDep):
    return ok(flow.detail(user, order_id))


@router.patch("/by-id/{order_id}")
def update(order_id: str, body: schemas.OrderUpdate, user: CurrentUserDep):
    changes = body.model_dump(mode="json", exclude_unset=True)
    for k in ("items", "transportation", "gst_rate"):
        if changes.get(k, "") is None:
            del changes[k]
    return ok(flow.update(user, order_id, changes), "Order saved.")


@router.post("/by-id/{order_id}/status")
def change_status(order_id: str, body: schemas.StatusChange, user: CurrentUserDep):
    return ok(flow.set_status(user, order_id, body.status, body.note), "Order updated.")


@router.delete("/by-id/{order_id}")
def delete(order_id: str, user: CurrentUserDep):
    return ok(flow.delete(user, order_id), "Order deleted.")


@router.patch("/{lead_id}")
def set_status(lead_id: str, body: StatusIn, user: CurrentUserDep):
    return ok(service.set_status(user, lead_id, body.status, (body.note or "").strip()[:500] or None), "Order updated.")


@router.get("/{lead_id}/history")
def history(lead_id: str, user: CurrentUserDep):
    return ok(service.history(user, lead_id))
