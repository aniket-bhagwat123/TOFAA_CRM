from fastapi import APIRouter

from src.core.schema import ok
from src.modules.activities import schemas, service
from src.modules.auth.dependencies import CurrentUserDep

router = APIRouter(prefix="/leads", tags=["activities"])


@router.post("/{lead_id}/calls", status_code=201)
def log_call(lead_id: str, body: schemas.CallLog, user: CurrentUserDep):
    return ok(service.log_call(user, lead_id, body), "Call logged.")


@router.post("/{lead_id}/notes", status_code=201)
def add_note(lead_id: str, body: schemas.NoteCreate, user: CurrentUserDep):
    return ok(service.add_note(user, lead_id, body.note), "Note saved.")
