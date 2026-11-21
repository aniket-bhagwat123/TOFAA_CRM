"""Pipeline stage settings: Admin edits the starting probabilities."""
from fastapi import APIRouter, Depends
from pydantic import Field

from src.core import cache
from src.core.audit import write_audit
from src.core.errors import NotFoundError
from src.core.schema import CamelModel, ok
from src.core.supabase import get_service_client
from src.modules.auth.dependencies import CurrentUserDep, require_roles
from src.modules.auth.schemas import Role

router = APIRouter(prefix="/stages", tags=["stages"])


class ProbabilityUpdate(CamelModel):
    probability: int = Field(ge=0, le=100)


@router.get("")
def list_stages(_: CurrentUserDep):
    return ok(
        cache.reference("stages", "list", 300, lambda: get_service_client().table("stage_config").select("*").order("position").execute().data)
    )


@router.patch("/{stage}", dependencies=[Depends(require_roles(Role.ADMIN))])
def update_probability(stage: str, body: ProbabilityUpdate, user: CurrentUserDep):
    res = get_service_client().table("stage_config").update({"probability": body.probability}).eq("stage", stage).execute()
    if not res.data:
        raise NotFoundError("Stage not found.")
    cache.invalidate_reference("stages")  # settings changed: drop the cached copies
    write_audit(user.id, "update", "stage_config", None, {"stage": stage, "probability": body.probability})
    return ok(res.data[0], "Saved.")
