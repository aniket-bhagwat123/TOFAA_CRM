from fastapi import APIRouter

from src.core.schema import ok
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.deal import service

router = APIRouter(prefix="/leads", tags=["deal"])


@router.get("/{lead_id}/deal")
def get_deal(lead_id: str, user: CurrentUserDep):
    return ok(service.deal(user, lead_id))
