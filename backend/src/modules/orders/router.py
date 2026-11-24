from typing import Annotated, Literal

from fastapi import APIRouter, Query

from src.core.pagination import PageDep
from src.core.schema import CamelModel, ok
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.orders import service

router = APIRouter(prefix="/orders", tags=["orders"])


class StatusIn(CamelModel):
    status: Literal["production", "quality_check", "dispatched", "delivered"]
    note: str | None = None


@router.get("")
def list_orders(user: CurrentUserDep, page: PageDep, status: str | None = None, owner_id: Annotated[str | None, Query(alias="ownerId")] = None):
    return ok(service.list_orders(user, page, status=status, owner_id=owner_id))


@router.patch("/{lead_id}")
def set_status(lead_id: str, body: StatusIn, user: CurrentUserDep):
    return ok(service.set_status(user, lead_id, body.status, (body.note or "").strip()[:500] or None), "Order updated.")


@router.get("/{lead_id}/history")
def history(lead_id: str, user: CurrentUserDep):
    return ok(service.history(user, lead_id))
