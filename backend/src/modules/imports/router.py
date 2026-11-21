from fastapi import APIRouter, File, UploadFile
from starlette.concurrency import run_in_threadpool

from src.core.access import require_lead_role
from src.core.errors import AppError
from src.core.schema import ok
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.imports import schemas, service

router = APIRouter(prefix="/imports", tags=["imports"])
MAX_BYTES = 5 * 1024 * 1024


@router.post("/parse")
async def parse(user: CurrentUserDep, file: UploadFile = File(...)):
    await run_in_threadpool(require_lead_role, user)
    content = await file.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise AppError("File is too large (5 MB maximum).", status_code=413)
    return ok(await run_in_threadpool(service.parse_file, file.filename or "", content))


@router.post("/preview")
def preview(body: schemas.ImportRequest, user: CurrentUserDep):
    return ok(service.preview(user, body))


@router.post("/commit")
def commit(body: schemas.CommitRequest, user: CurrentUserDep):
    return ok(service.commit(user, body), "Import finished.")
