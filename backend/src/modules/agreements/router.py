from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile
from pydantic import Field
from starlette.concurrency import run_in_threadpool

from src.core.documents import MAX_DOCUMENT_BYTES
from src.core.errors import AppError
from src.core.schema import CamelModel, ok
from src.modules.agreements import service
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.leads import service as leads

router = APIRouter(prefix="/leads", tags=["agreement"])


class PaymentRequestIn(CamelModel):
    invoice_number: str = Field(min_length=1, max_length=60)
    amount: Decimal | None = Field(default=None, gt=0)


@router.get("/{lead_id}/agreement")
def get_state(lead_id: str, user: CurrentUserDep):
    leads.get_lead_row(user, lead_id)
    return ok(service.state(lead_id))


@router.post("/{lead_id}/agreement/sent")
def sent(lead_id: str, user: CurrentUserDep):
    return ok(service.mark_sent(user, lead_id), "Marked as sent.")


@router.put("/{lead_id}/agreement/signed")
async def signed(
    lead_id: str,
    user: CurrentUserDep,
    file: Annotated[UploadFile, File()],
    next_follow_up: Annotated[date | None, Form(alias="nextFollowUp")] = None,
):
    data = await file.read(MAX_DOCUMENT_BYTES + 1)
    if len(data) > MAX_DOCUMENT_BYTES:
        raise AppError("The file must be 10 MB or smaller.", status_code=413)
    return ok(await run_in_threadpool(service.upload_signed, user, lead_id, data, file.filename, next_follow_up), "Signed agreement saved.")


@router.post("/{lead_id}/payment-request", status_code=201)
def payment_request(lead_id: str, body: PaymentRequestIn, user: CurrentUserDep):
    return ok(service.request_payment(user, lead_id, body.invoice_number, body.amount), "Payment requested. Finance has been told.")
