from fastapi import APIRouter

from src.core.schema import ok
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.projects import service

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("/summary")
def summary(
    user: CurrentUserDep, ownerId: str | None = None, companyId: str | None = None,  # noqa: N803 - query names match the app
    occasion: str | None = None, origin: str | None = None, search: str | None = None,
):
    return ok(service.summary(user, owner_id=ownerId, company_id=companyId, occasion=occasion, origin=origin, search=search))


@router.get("/filters")
def filters(user: CurrentUserDep):
    return ok(service.filters(user))
