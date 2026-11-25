from fastapi import APIRouter, Depends

from src.core.schema import ok
from src.modules.auth.dependencies import CurrentUserDep, require_roles
from src.modules.auth.schemas import Role
from src.modules.clients import schemas, service

router = APIRouter(tags=["clients"])
admin_only = Depends(require_roles(Role.ADMIN))


@router.get("/clients")
def list_clients(
    user: CurrentUserDep, search: str | None = None, tier: str | None = None, status: str | None = None,
    ownerId: str | None = None, occasionSoon: bool = False, noOccasions: bool = False,  # noqa: N803 - query names match the app
):
    return ok(service.list_clients(user, search=search, tier=tier, status=status, owner_id=ownerId, occasion_soon=occasionSoon, no_occasions=noOccasions))


@router.post("/clients", status_code=201)
def add_client(body: schemas.ClientCreate, user: CurrentUserDep):
    return ok(service.add_client(user, body), "Client added.")


@router.get("/clients/{company_id}")
def get_client(company_id: str, user: CurrentUserDep):
    return ok(service.get_client(user, company_id))


@router.patch("/clients/{company_id}")
def update_client(company_id: str, body: schemas.ClientUpdate, user: CurrentUserDep):
    return ok(service.update_client(user, company_id, body), "Saved.")


@router.post("/clients/{company_id}/contacts", status_code=201)
def add_contact(company_id: str, body: schemas.ContactCreate, user: CurrentUserDep):
    return ok(service.add_contact(user, company_id, body), "Contact added.")


@router.post("/clients/{company_id}/occasions", status_code=201)
def add_occasion(company_id: str, body: schemas.OccasionCreate, user: CurrentUserDep):
    return ok(service.add_occasion(user, company_id, body), "Occasion added.")


@router.delete("/clients/{company_id}")
def delete_client(company_id: str, user: CurrentUserDep):
    return ok(service.delete_client(user, company_id), "Client deleted.")


@router.delete("/clients/{company_id}/occasions/{occasion_id}")
def delete_occasion(company_id: str, occasion_id: str, user: CurrentUserDep):
    service.delete_occasion(user, company_id, occasion_id)
    return ok(None, "Occasion removed.")


@router.post("/clients/{company_id}/followups", status_code=201)
def create_followup(company_id: str, body: schemas.FollowUpCreate, user: CurrentUserDep):
    return ok(service.create_followup(user, company_id, body), "Follow-up scheduled.")


@router.post("/clients/{company_id}/calls")
def log_client_call(company_id: str, body: schemas.FollowUpComplete, user: CurrentUserDep):
    return ok(service.log_client_call(user, company_id, body), "Saved.")


@router.post("/clients/{company_id}/followups/{task_id}/complete")
def complete_followup(company_id: str, task_id: str, body: schemas.FollowUpComplete, user: CurrentUserDep):
    return ok(service.complete_followup(user, company_id, task_id, body), "Saved.")


@router.post("/clients/{company_id}/projects", status_code=201)
def create_project(company_id: str, body: schemas.ProjectCreate, user: CurrentUserDep):
    return ok(service.create_project(user, company_id, body), "Project created.")


@router.post("/clients/{company_id}/projects/repeat", status_code=201)
def repeat_project(company_id: str, body: schemas.RepeatProject, user: CurrentUserDep):
    return ok(service.repeat_project(user, company_id, body), "Repeat project created with last time's items.")


@router.get("/occasion-calendar")
def calendar(_: CurrentUserDep):
    return ok(service.list_calendar())


@router.post("/occasion-calendar", status_code=201, dependencies=[admin_only])
def add_calendar(body: schemas.CalendarCreate):
    return ok(service.add_calendar(body), "Date added.")


@router.delete("/occasion-calendar/{calendar_id}", dependencies=[admin_only])
def delete_calendar(calendar_id: str):
    service.delete_calendar(calendar_id)
    return ok(None, "Date removed.")


@router.get("/campaigns")
def campaigns(user: CurrentUserDep):
    return ok(service.list_campaigns(user))


@router.post("/campaigns", status_code=201)
def create_campaign(body: schemas.CampaignCreate, user: CurrentUserDep):
    c = service.create_campaign(user, body)
    return ok(c, f"Campaign started: {c['targets']} clients to call.")
