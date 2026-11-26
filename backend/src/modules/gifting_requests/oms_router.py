"""Called by OMS: no sign-in, protected by the shared-secret signature."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Request
from pydantic import Field, ValidationError
from starlette.concurrency import run_in_threadpool

from src.core.errors import AppError, ForbiddenError
from src.core.schema import CamelModel
from src.modules.gifting_requests import oms, service

router = APIRouter(prefix="/integrations/oms", tags=["integrations"])


class StatusUpdate(CamelModel):
    request_id: UUID
    status: Literal["DISPATCHED", "DELIVERED"]
    reference: str | None = Field(default=None, max_length=100)


@router.post("/status", include_in_schema=False)
async def status_update(request: Request):
    raw = await request.body()
    if not oms.valid_signature(raw, request.headers.get("x-oms-signature")):
        raise ForbiddenError("Bad signature.")
    try:
        body = StatusUpdate.model_validate_json(raw)
    except ValidationError as exc:
        raise AppError("Send requestId, status (DISPATCHED or DELIVERED) and optionally reference.", status_code=422) from exc
    data = await run_in_threadpool(service.apply_oms_status, str(body.request_id), body.status, body.reference)
    return {"data": data, "message": "OK"}
