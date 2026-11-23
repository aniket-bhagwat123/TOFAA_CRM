from typing import Annotated

from fastapi import APIRouter, File, UploadFile
from starlette.concurrency import run_in_threadpool

from src.core.documents import MAX_DOCUMENT_BYTES
from src.core.errors import AppError
from src.core.schema import ok
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.leads import service as leads
from src.modules.samples import schemas, service

router = APIRouter(prefix="/leads", tags=["samples"])


@router.get("/{lead_id}/samples")
def get_samples(lead_id: str, user: CurrentUserDep):
    leads.get_lead_row(user, lead_id)
    return ok(service.state(lead_id))


@router.post("/{lead_id}/sample-files", status_code=201)
async def upload_file(lead_id: str, user: CurrentUserDep, file: Annotated[UploadFile, File()]):
    """One sample image or file. The returned path goes into an item's `files` when the samples are saved."""
    data = await file.read(MAX_DOCUMENT_BYTES + 1)
    if len(data) > MAX_DOCUMENT_BYTES:
        raise AppError("The file must be 10 MB or smaller.", status_code=413)
    return ok(await run_in_threadpool(lambda: service.upload_file(user, lead_id, data, file.filename)), "File uploaded.")


@router.put("/{lead_id}/samples")
def save(lead_id: str, body: schemas.SamplesSave, user: CurrentUserDep):
    return ok(service.save(user, lead_id, body), "Samples saved.")


@router.post("/{lead_id}/samples/send")
def send(lead_id: str, body: schemas.SamplesSend, user: CurrentUserDep):
    return ok(service.send(user, lead_id, body), "Samples sent.")
