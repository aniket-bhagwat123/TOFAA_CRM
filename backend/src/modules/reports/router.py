from typing import Annotated

from fastapi import APIRouter, Query

from src.core.schema import ok
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.reports import service

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("")
def report(
    user: CurrentUserDep,
    start: Annotated[str | None, Query(alias="from")] = None,
    end: Annotated[str | None, Query(alias="to")] = None,
    owner_id: Annotated[str | None, Query(alias="ownerId")] = None,
):
    return ok(service.report(user, start, end, owner_id))
