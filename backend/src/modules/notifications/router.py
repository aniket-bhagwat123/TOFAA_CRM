from fastapi import APIRouter
from pydantic import Field

from src.core.schema import CamelModel, ok
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.notifications import service

router = APIRouter(prefix="/notifications", tags=["notifications"])


class MarkRead(CamelModel):
    ids: list[str] = Field(max_length=100)


@router.get("")
def unread(user: CurrentUserDep):
    return ok(service.list_unread(user))


@router.get("/center")
def center(user: CurrentUserDep):
    return ok(service.center(user))


@router.post("/read-all")
def read_all(user: CurrentUserDep):
    service.mark_all_read(user)
    return ok(None)


@router.post("/read")
def mark_read(body: MarkRead, user: CurrentUserDep):
    service.mark_read(user, body.ids)
    return ok(None)
