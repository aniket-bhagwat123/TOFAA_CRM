from fastapi import APIRouter

from src.core.schema import ok
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.meetings import schemas, service

router = APIRouter(tags=["meetings"])


@router.post("/leads/{lead_id}/meetings", status_code=201)
def create_meeting(lead_id: str, body: schemas.MeetingCreate, user: CurrentUserDep):
    return ok(service.create_meeting(user, lead_id, body), "Meeting scheduled.")


@router.get("/meetings")
def upcoming(user: CurrentUserDep):
    return ok(service.list_upcoming(user))


@router.patch("/meetings/{meeting_id}")
def update_meeting(meeting_id: str, body: schemas.MeetingUpdate, user: CurrentUserDep):
    return ok(service.update_meeting(user, meeting_id, body), "Meeting updated.")
