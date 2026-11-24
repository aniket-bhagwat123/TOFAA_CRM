from fastapi import APIRouter

from src.core.schema import ok
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.dashboard import service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("")
def dashboard(user: CurrentUserDep):
    """Each role's own dashboard (see dashboard.service)."""
    return ok(service.dashboard(user))
