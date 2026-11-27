import json
from decimal import Decimal

from fastapi import APIRouter, Request
from pydantic import Field

from src.core.config import settings
from src.core.errors import ForbiddenError
from src.core.schema import CamelModel, ok
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.payments import service

router = APIRouter(prefix="/payments", tags=["payments"])


class Confirm(CamelModel):
    amount: Decimal | None = Field(default=None, gt=0)


@router.get("")
def list_payments(user: CurrentUserDep, status: str | None = None):
    return ok({"items": service.list_requests(user, status), "fallbackEnabled": settings.PAYMENT_FALLBACK_ENABLED})


@router.post("/{request_id}/confirm")
def confirm(request_id: str, body: Confirm, user: CurrentUserDep):
    return ok(service.confirm(user, request_id, body.amount), "Payment confirmed.")


@router.delete("/{request_id}")
def delete_request(request_id: str, user: CurrentUserDep):
    return ok(service.delete_request(user, request_id), "Payment request deleted.")


# Called by the ERP: no bearer token; protected by the shared-secret signature.
@router.post("/erp-webhook", include_in_schema=False)
async def erp_webhook(request: Request):
    raw = await request.body()
    if not service.valid_signature(raw, request.headers.get("x-erp-signature")):
        raise ForbiddenError("Bad signature.")
    from starlette.concurrency import run_in_threadpool

    try:
        payload = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        from src.core.errors import AppError

        raise AppError("Body must be JSON.", status_code=422)
    return ok(await run_in_threadpool(service.handle_erp, payload))
