from fastapi import APIRouter

from src.core.schema import ok
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.tasks import schemas, service

router = APIRouter(tags=["tasks"])


@router.get("/today")
def today(user: CurrentUserDep):
    return ok(service.today_view(user))


@router.get("/today/end-of-day")
def end_of_day(user: CurrentUserDep):
    return ok(service.end_of_day(user))


@router.get("/follow-ups")
def follow_ups(user: CurrentUserDep, ownerId: str | None = None):  # noqa: N803 - query name matches the app
    return ok(service.follow_ups(user, ownerId))


@router.post("/tasks", status_code=201)
def create_task(body: schemas.TaskCreate, user: CurrentUserDep):
    return ok(service.create_task(user, body.lead_id, body.due_date, body.title), "Follow-up scheduled.")


@router.post("/tasks/{task_id}/complete")
def complete_task(task_id: str, body: schemas.TaskComplete, user: CurrentUserDep):
    return ok(service.complete_task(user, task_id, body.next_follow_up, body.outcome), "Done.")
