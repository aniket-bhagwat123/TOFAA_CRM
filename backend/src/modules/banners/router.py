from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, File, Form, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import Field, ValidationError, model_validator

from src.core.errors import AppError
from src.core.schema import CamelModel, ok
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.banners import service

router = APIRouter(tags=["banners"])

Audience = Literal["ALL", "KAM", "ADMIN"]


class BannerSettings(CamelModel):
    """Settings of a banner. On create every field has a default; on update only the fields sent change."""
    audience: Audience | None = None
    title: str | None = Field(default=None, max_length=120)
    sort_order: int | None = Field(default=None, ge=0, le=9999)
    is_active: bool | None = None
    starts_on: date | None = None
    ends_on: date | None = None
    company_ids: list[UUID] | None = Field(default=None, max_length=service.MAX_CLIENTS)  # empty = every client

    @model_validator(mode="after")
    def dates_in_order(self):
        if self.starts_on and self.ends_on and self.ends_on < self.starts_on:
            raise ValueError("The end date is before the start date.")
        return self


async def _read(file: UploadFile) -> bytes:
    data = await file.read(service.MAX_BYTES + 1)
    if len(data) > service.MAX_BYTES:
        raise AppError("The picture must be 5 MB or smaller.", status_code=413)
    return data


@router.get("/banners")
def live(user: CurrentUserDep, company_id: Annotated[UUID | None, Query(alias="companyId")] = None):
    """The banners this person sees now, for one client or all of theirs (empty for roles without banners)."""
    return ok(service.live(user, str(company_id) if company_id else None))


@router.get("/admin/banners")
def manage_list(user: CurrentUserDep):
    return ok(service.manage_list(user))


@router.post("/admin/banners", status_code=201)
async def create(
    user: CurrentUserDep,
    file: UploadFile = File(...),
    audience: Audience = Form("ALL"),
    title: str | None = Form(None),
    sort_order: int = Form(0, alias="sortOrder"),
    is_active: bool = Form(True, alias="isActive"),
    starts_on: date | None = Form(None, alias="startsOn"),
    ends_on: date | None = Form(None, alias="endsOn"),
    company_ids: list[UUID] = Form([], alias="companyIds"),
):
    try:
        settings = BannerSettings(audience=audience, title=(title or "").strip() or None, sort_order=sort_order, is_active=is_active, starts_on=starts_on, ends_on=ends_on, company_ids=company_ids)
    except ValidationError as exc:  # built by hand from form fields: turn a rule break into a clear 422
        raise AppError(exc.errors()[0]["msg"].removeprefix("Value error, "), status_code=422) from exc
    data = await _read(file)
    fields = settings.model_dump(exclude_none=True, mode="json")
    return ok(await run_in_threadpool(service.create, user, fields, data), "Banner added.")


@router.patch("/admin/banners/{banner_id}")
def update(banner_id: str, body: BannerSettings, user: CurrentUserDep):
    fields = body.model_dump(exclude_unset=True, mode="json")
    if "title" in fields:
        fields["title"] = (fields["title"] or "").strip() or None
    for k in ("audience", "sort_order", "is_active", "company_ids"):
        if k in fields and fields[k] is None:
            raise AppError(f"{k.replace('_', ' ').capitalize()} cannot be empty.", status_code=422)
    return ok(service.update(user, banner_id, fields), "Banner updated.")


@router.put("/admin/banners/{banner_id}/image")
async def set_image(banner_id: str, user: CurrentUserDep, file: UploadFile = File(...)):
    data = await _read(file)
    return ok(await run_in_threadpool(service.set_image, user, banner_id, data), "Picture saved.")


@router.delete("/admin/banners/{banner_id}")
def delete(banner_id: str, user: CurrentUserDep):
    service.delete(user, banner_id)
    return ok(None, "Banner deleted.")
