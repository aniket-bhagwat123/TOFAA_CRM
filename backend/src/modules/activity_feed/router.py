from fastapi import APIRouter

from src.core.schema import ok
from src.modules.activity_feed import service
from src.modules.auth.dependencies import CurrentUserDep

router = APIRouter(tags=["activity"])


@router.get("/activity")
def activity(
    user: CurrentUserDep, before: str | None = None, kind: str | None = None,
    ownerId: str | None = None, leadId: str | None = None, companyId: str | None = None,  # noqa: N803 - query names match the app
):
    return ok(service.feed(user, before=before, kind=kind, owner_id=ownerId, lead_id=leadId, company_id=companyId))
