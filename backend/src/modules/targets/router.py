from fastapi import APIRouter

from src.core.access import require_lead_role
from src.core.schema import ok
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.targets import schemas, service

router = APIRouter(prefix="/targets", tags=["targets"])


@router.get("/card")
def card(user: CurrentUserDep):
    require_lead_role(user)
    return ok(service.target_card(user))


@router.get("")
def list_targets(user: CurrentUserDep, month: str | None = None):
    return ok(service.list_settings(user, month))


@router.put("")
def set_target(body: schemas.TargetSet, user: CurrentUserDep):
    return ok(service.set_settings(user, body), "Saved.")
