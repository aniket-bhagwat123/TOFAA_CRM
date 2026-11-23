from typing import Annotated

from fastapi import APIRouter, File, Query, UploadFile
from starlette.concurrency import run_in_threadpool

from src.core.errors import AppError
from src.core.images import UPLOAD_MAX_BYTES

from src.core.pagination import PageDep
from src.core.schema import ok
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.leads import schemas, service

router = APIRouter(prefix="/leads", tags=["leads"])


@router.get("/meta")
def meta(_: CurrentUserDep):
    return ok(service.meta())


@router.post("/check-duplicates")
def check_duplicates(body: schemas.DuplicateCheck, user: CurrentUserDep):
    return ok(service.find_duplicates(user, body.company_name, body.phone, body.email))


@router.get("/board")
def board(
    user: CurrentUserDep,
    overdue: bool = False,
    source: str | None = None,
    owner_id: Annotated[str | None, Query(alias="ownerId")] = None,
    search: str | None = None,
    pipeline: str = "new_business",
    company_id: Annotated[str | None, Query(alias="companyId")] = None,
    occasion: str | None = None,
    origin: str | None = None,
    call_outcome: Annotated[str | None, Query(alias="callOutcome")] = None,
    tag: str | None = None,
):
    return ok(service.board(user, overdue=overdue, source=source, owner_id=owner_id, search=search, pipeline=pipeline, company_id=company_id, occasion=occasion, origin=origin, call_outcome=call_outcome, tag=tag))


@router.get("")
def list_leads(
    user: CurrentUserDep,
    page: PageDep,
    stage: str | None = None,
    overdue: bool = False,
    source: str | None = None,
    owner_id: Annotated[str | None, Query(alias="ownerId")] = None,
    pipeline: str = "new_business",
    company_id: Annotated[str | None, Query(alias="companyId")] = None,
    occasion: str | None = None,
    origin: str | None = None,
    call_outcome: Annotated[str | None, Query(alias="callOutcome")] = None,
    tag: str | None = None,
):
    return ok(service.list_leads(user, page, stage=stage, overdue=overdue, source=source, owner_id=owner_id, pipeline=pipeline, company_id=company_id, occasion=occasion, origin=origin, call_outcome=call_outcome, tag=tag))


@router.post("", status_code=201)
def create_lead(body: schemas.LeadCreate, user: CurrentUserDep):
    return ok(service.create_lead(user, body), "Lead added.")


@router.get("/{lead_id}")
def get_lead(lead_id: str, user: CurrentUserDep):
    return ok(service.get_lead_detail(user, lead_id))


@router.patch("/{lead_id}")
def update_lead(lead_id: str, body: schemas.LeadUpdate, user: CurrentUserDep):
    return ok(service.update_lead(user, lead_id, body), "Saved.")


@router.post("/{lead_id}/stage")
def move_stage(lead_id: str, body: schemas.StageMove, user: CurrentUserDep):
    return ok(service.move_stage(user, lead_id, body), "Stage updated.")


@router.post("/{lead_id}/reassign")
def reassign(lead_id: str, body: schemas.Reassign, user: CurrentUserDep):
    return ok(service.reassign(user, lead_id, body), "Lead reassigned.")


# Client photo (one per lead contact)
@router.put("/{lead_id}/photo")
async def set_photo(lead_id: str, user: CurrentUserDep, file: UploadFile = File(...)):
    data = await file.read(UPLOAD_MAX_BYTES + 1)
    if len(data) > UPLOAD_MAX_BYTES:
        raise AppError("Image must be 2 MB or smaller.", status_code=413)
    return ok(await run_in_threadpool(service.set_photo, user, lead_id, data), "Photo saved.")


@router.delete("/{lead_id}/photo")
def remove_photo(lead_id: str, user: CurrentUserDep):
    service.remove_photo(user, lead_id)
    return ok(None, "Photo removed.")
