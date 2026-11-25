"""People and groups: HTTP only (KAM and admin; the service checks role and account). Fixed paths are declared before
"/people/{recipient_id}" so they are never read as an id."""
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, Query, Response, UploadFile
from fastapi.concurrency import run_in_threadpool

from src.core.errors import AppError
from src.core.images import UPLOAD_MAX_BYTES
from src.core.schema import ok
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.people import groups, io, schemas, service

router = APIRouter(tags=["people"])
IMPORT_MAX = 10 * 1024 * 1024


def _filters(company_id, search, relationship, city, group_id, status, upcoming_days, sort, order) -> dict:
    return {"company_id": company_id, "search": search, "relationship": relationship, "city": city, "group_id": group_id,
            "status": status, "upcoming_days": upcoming_days, "sort": sort, "order": order}


def _download(data: bytes, mime: str, name: str) -> Response:
    return Response(content=data, media_type=mime, headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/people")
def list_people(
    user: CurrentUserDep,
    company_id: Annotated[str | None, Query(alias="companyId")] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    search: str | None = None,
    relationship: str | None = None,
    city: str | None = None,
    group_id: Annotated[str | None, Query(alias="groupId")] = None,
    status: Literal["ACTIVE", "ARCHIVED", "ALL"] = "ACTIVE",
    upcoming_days: Annotated[int | None, Query(alias="upcomingDays", ge=1, le=366)] = None,
    sort: Literal["name", "city", "mobile", "created", "nextOccasion"] = "created",
    order: Literal["asc", "desc"] | None = None,
    recipient_ids: Annotated[str | None, Query(alias="recipientIds")] = None,
):
    ids = [x for x in recipient_ids.split(",") if x] if recipient_ids is not None else None
    return ok(service.list_people(user, page=page, limit=limit, recipient_ids=ids, **_filters(company_id, search, relationship, city, group_id, status, upcoming_days, sort, order or "")))


@router.get("/people/summary")
def summary(user: CurrentUserDep, company_id: Annotated[str | None, Query(alias="companyId")] = None):
    return ok(service.summary(user, company_id))


@router.get("/people/duplicates")
def duplicates(user: CurrentUserDep, company_id: Annotated[str, Query(alias="companyId")], name: str | None = None,
               mobile_number: Annotated[str | None, Query(alias="mobileNumber")] = None, email: str | None = None,
               exclude_id: Annotated[str | None, Query(alias="excludeId")] = None):
    return ok(service.find_duplicates(user, company_id, name, mobile_number, email, exclude_id))


@router.get("/people/template")
def template(user: CurrentUserDep, format: Literal["xlsx", "csv"] = "xlsx"):  # noqa: A002 - query name
    service.require_role(user)
    return _download(*io.template(format))


@router.get("/people/export")
def export(
    user: CurrentUserDep,
    format: Literal["xlsx", "csv"] = "xlsx",  # noqa: A002
    company_id: Annotated[str | None, Query(alias="companyId")] = None,
    search: str | None = None, relationship: str | None = None, city: str | None = None,
    group_id: Annotated[str | None, Query(alias="groupId")] = None,
    status: Literal["ACTIVE", "ARCHIVED", "ALL"] = "ACTIVE",
    upcoming_days: Annotated[int | None, Query(alias="upcomingDays", ge=1, le=366)] = None,
    sort: Literal["name", "city", "mobile", "created", "nextOccasion"] = "name",
    recipient_ids: Annotated[str | None, Query(alias="recipientIds")] = None,
):
    filters = _filters(company_id, search, relationship, city, group_id, status, upcoming_days, sort, "asc")
    if recipient_ids:
        filters["recipient_ids"] = [x for x in recipient_ids.split(",") if x]
    return _download(*io.export(user, format, **filters))


@router.post("/people/import")
async def import_people(user: CurrentUserDep, company_id: str = Form(..., alias="companyId"), file: UploadFile = File(...)):
    content = await file.read(IMPORT_MAX + 1)
    if len(content) > IMPORT_MAX:
        raise AppError("The file must be 10 MB or smaller.", status_code=413)
    result = await run_in_threadpool(io.import_file, user, company_id, file.filename or "", content)
    return ok(result, f"{result['created']} added, {len(result['skipped'])} skipped.")


@router.post("/people", status_code=201)
def create(body: schemas.RecipientCreate, user: CurrentUserDep):
    return ok(service.create(user, body), "Person added.")


@router.post("/people/bulk-delete")
def bulk_delete(body: schemas.Ids, user: CurrentUserDep):
    return ok(service.bulk_delete(user, body.recipient_ids))


@router.post("/people/bulk-status")
def bulk_status(body: schemas.BulkStatus, user: CurrentUserDep):
    return ok(service.bulk_status(user, body.recipient_ids, body.status))


# --- groups (declared before /people/{id}) --------------------------------------------------------------------------

@router.get("/people-groups")
def list_groups(user: CurrentUserDep, company_id: Annotated[str | None, Query(alias="companyId")] = None):
    return ok(groups.list_groups(user, company_id))


@router.post("/people-groups", status_code=201)
def create_group(body: schemas.GroupIn, user: CurrentUserDep):
    return ok(groups.create(user, body), "Group saved.")


@router.post("/people-groups/bulk-delete")
def bulk_delete_groups(body: schemas.GroupIds, user: CurrentUserDep):
    return ok(groups.bulk_delete(user, body.group_ids))


@router.put("/people-groups/{group_id}")
def update_group(group_id: str, body: schemas.GroupUpdate, user: CurrentUserDep):
    return ok(groups.update(user, group_id, body), "Group saved.")


@router.delete("/people-groups/{group_id}")
def delete_group(group_id: str, user: CurrentUserDep):
    groups.delete(user, group_id)
    return ok(None, "Group deleted.")


# --- one person ----------------------------------------------------------------------------------------------------

@router.get("/people/{recipient_id}")
def get(recipient_id: str, user: CurrentUserDep):
    return ok(service.get(user, recipient_id))


@router.patch("/people/{recipient_id}")
def update(recipient_id: str, body: schemas.RecipientUpdate, user: CurrentUserDep):
    return ok(service.update(user, recipient_id, body), "Saved.")


@router.delete("/people/{recipient_id}")
def delete(recipient_id: str, user: CurrentUserDep):
    service.delete(user, recipient_id)
    return ok(None, "Person deleted.")


@router.post("/people/{recipient_id}/restore")
def restore(recipient_id: str, user: CurrentUserDep):
    return ok(service.restore(user, recipient_id), "Person restored.")


@router.put("/people/{recipient_id}/photo")
async def set_photo(recipient_id: str, user: CurrentUserDep, file: UploadFile = File(...)):
    data = await file.read(UPLOAD_MAX_BYTES + 1)
    return ok(await run_in_threadpool(service.set_photo, user, recipient_id, data), "Photo saved.")


@router.delete("/people/{recipient_id}/photo")
def remove_photo(recipient_id: str, user: CurrentUserDep):
    return ok(service.remove_photo(user, recipient_id), "Photo removed.")


@router.get("/people/{recipient_id}/history")
def history(recipient_id: str, user: CurrentUserDep, page: Annotated[int, Query(ge=1)] = 1, limit: Annotated[int, Query(ge=1, le=100)] = 30):
    return ok(service.history(user, recipient_id, page, limit))


@router.get("/people/{recipient_id}/addresses")
def addresses(recipient_id: str, user: CurrentUserDep):
    return ok(service.addresses(user, recipient_id))


@router.post("/people/{recipient_id}/addresses", status_code=201)
def add_address(recipient_id: str, body: schemas.AddressIn, user: CurrentUserDep):
    return ok(service.add_address(user, recipient_id, body), "Address added.")


@router.patch("/people/{recipient_id}/addresses/{address_id}")
def update_address(recipient_id: str, address_id: str, body: schemas.AddressUpdate, user: CurrentUserDep):
    return ok(service.update_address(user, recipient_id, address_id, body), "Address saved.")


@router.delete("/people/{recipient_id}/addresses/{address_id}")
def delete_address(recipient_id: str, address_id: str, user: CurrentUserDep):
    service.delete_address(user, recipient_id, address_id)
    return ok(None, "Address removed.")


@router.get("/people/{recipient_id}/preferences")
def preferences(recipient_id: str, user: CurrentUserDep):
    return ok(service.preferences(user, recipient_id))


@router.put("/people/{recipient_id}/preferences")
def save_preferences(recipient_id: str, body: schemas.PreferencesIn, user: CurrentUserDep):
    return ok(service.save_preferences(user, recipient_id, body), "Preferences saved.")


@router.get("/people/{recipient_id}/relationships")
def links(recipient_id: str, user: CurrentUserDep):
    return ok(service.links(user, recipient_id))


@router.put("/people/{recipient_id}/relationships")
def save_links(recipient_id: str, body: schemas.LinksIn, user: CurrentUserDep):
    return ok(service.save_links(user, recipient_id, body), "Relationships saved.")
