from fastapi import APIRouter

from src.core.schema import ok
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.team import service

router = APIRouter(prefix="/team", tags=["team"])


@router.get("/summary")
def summary(user: CurrentUserDep):
    return ok(service.summary(user))
