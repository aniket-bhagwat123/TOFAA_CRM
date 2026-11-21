from datetime import date
from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile
from starlette.concurrency import run_in_threadpool

from src.core.documents import MAX_DOCUMENT_BYTES
from src.core.errors import AppError
from src.core.schema import ok
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.minutes import service

router = APIRouter(prefix="/leads", tags=["minutes"])


@router.post("/{lead_id}/minutes", status_code=201)
async def add_minutes(
    lead_id: str,
    user: CurrentUserDep,
    occasion: Annotated[str | None, Form()] = None,
    quantity: Annotated[str | None, Form()] = None,
    budget: Annotated[str | None, Form()] = None,
    delivery_date: Annotated[str | None, Form(alias="deliveryDate")] = None,
    next_follow_up: Annotated[date | None, Form(alias="nextFollowUp")] = None,
    note: Annotated[str | None, Form()] = None,
    meeting_id: Annotated[str | None, Form(alias="meetingId")] = None,
    file: Annotated[UploadFile | None, File()] = None,
):
    payload = None
    if file is not None and file.filename:
        data = await file.read(MAX_DOCUMENT_BYTES + 1)
        if len(data) > MAX_DOCUMENT_BYTES:
            raise AppError("The file must be 10 MB or smaller.", status_code=413)
        payload = (data, file.filename)
    result = await run_in_threadpool(
        lambda: service.add_minutes(
            user, lead_id, note=note, occasion=occasion, quantity=quantity, budget=budget, delivery_date=delivery_date,
            next_follow_up=next_follow_up, meeting_id=meeting_id or None, file=payload,
        )
    )
    return ok(result, "Minutes saved. The lead is now at Requirement Received.")
