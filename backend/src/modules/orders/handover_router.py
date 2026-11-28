"""The handover screens of the CRM."""
from fastapi import APIRouter, File, UploadFile
from fastapi.concurrency import run_in_threadpool

from src.core.documents import MAX_DOCUMENT_BYTES
from src.core.schema import ok
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.orders import handover, handover_schemas as schemas

router = APIRouter(prefix="/orders", tags=["order handover"])
approvals_router = APIRouter(prefix="/approvals", tags=["order handover"])


@router.post("/handover/from-lead/{lead_id}")
def start(lead_id: str, user: CurrentUserDep):
    return ok(handover.start(user, lead_id), "Handover started.")


@router.get("/by-id/{order_id}/handover")
def get(order_id: str, user: CurrentUserDep):
    return ok(handover.get(user, order_id))


@router.put("/by-id/{order_id}/handover")
def save(order_id: str, body: schemas.HandoverIn, user: CurrentUserDep):
    return ok(handover.save(user, order_id, body.model_dump(mode="json")), "Handover saved.")


@router.post("/by-id/{order_id}/handover/files")
async def upload(order_id: str, user: CurrentUserDep, file: UploadFile = File(...)):
    data = await file.read(MAX_DOCUMENT_BYTES + 1)
    return ok(await run_in_threadpool(handover.upload, user, order_id, data, file.filename), "File uploaded.")


@router.post("/by-id/{order_id}/handover/submit")
def submit(order_id: str, user: CurrentUserDep):
    return ok(handover.submit(user, order_id), "Sent for approval.")


@router.post("/by-id/{order_id}/handover/decision")
def decide(order_id: str, body: schemas.Decision, user: CurrentUserDep):
    data = handover.decide(user, order_id, body.approve, body.version, body.submitted_at, body.note)
    return ok(data, "Approved. OMS can read it now." if body.approve else "Rejected.")


@router.post("/by-id/{order_id}/handover/cancel")
def cancel(order_id: str, body: schemas.Cancel, user: CurrentUserDep):
    return ok(handover.cancel(user, order_id, body.note), "Handover cancelled.")


@approvals_router.get("/handovers")
def pending(user: CurrentUserDep):
    return ok(handover.pending(user))
