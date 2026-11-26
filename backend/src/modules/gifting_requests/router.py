"""Gift requests from Gifting OS: HTTP only (KAM and admin; the service checks role and accounts)."""
from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Query
from pydantic import Field

from src.core.schema import CamelModel
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.gifting_requests import clients, service

router = APIRouter(prefix="/gifting-requests", tags=["gift requests"])

Status = Literal["SUBMITTED", "IN_REVIEW", "NEEDS_INFO", "PROPOSAL_READY", "CONFIRMED", "IN_PROGRESS", "DISPATCHED", "DELIVERED", "CANCELLED"]


class Option(CamelModel):
    name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=1000)
    price: float = Field(ge=0, le=9_999_999_999)


class Proposal(CamelModel):
    options: list[Option] = Field(min_length=1, max_length=20)
    note: str | None = Field(default=None, max_length=2000)


class Action(CamelModel):
    action: Literal["start_review", "request_info", "publish_proposal", "reject", "start_fulfilment", "send_to_oms", "dispatch", "deliver"]
    note: str | None = Field(default=None, max_length=2000)
    proposal: Proposal | None = None


@router.get("")
def search(
    user: CurrentUserDep,
    company_id: Annotated[str | None, Query(alias="companyId")] = None,
    status: Status | None = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
):
    # Not passed through core.schema.ok(): Gifting OS already answers in camelCase, and its data must stay as it is.
    return {"data": service.search(user, company_id=company_id, status=status, search=search, page=page, limit=limit), "message": "OK"}


@router.get("/{request_id}")
def detail(request_id: UUID, user: CurrentUserDep):
    return {"data": service.detail(user, str(request_id)), "message": "OK"}


@router.post("/{request_id}/actions")
def act(request_id: UUID, body: Action, user: CurrentUserDep):
    proposal = None
    if body.proposal:
        proposal = body.proposal.model_dump(by_alias=True, exclude_none=True)
        for option in proposal["options"]:
            option["price"] = round(option["price"], 2)
    return {"data": service.act(user, str(request_id), body.action, body.note, proposal), "message": "Gift request updated."}


# --- occasions, events and new requests -------------------------------------------------------------------------------

planning_router = APIRouter(prefix="/gifting-planning", tags=["gift requests"])


class NewDay(CamelModel):
    """A new occasion (for the whole client) or event (for one person)."""
    company_id: str
    name: str = Field(min_length=1, max_length=150)
    day: date


class NewEvent(NewDay):
    recipient_id: UUID


class NewRequest(CamelModel):
    company_id: str
    recipient_id: UUID
    occasion_id: UUID | None = None
    event_id: UUID | None = None
    delivery_date: date
    budget_mode: Literal["SPECIFIC", "TOFAA_RECOMMEND"] = "SPECIFIC"
    budget: float | None = Field(default=None, gt=0, le=10_000_000)
    initiated_via: Literal["DIRECTOR_WHATSAPP", "DIRECTOR_EMAIL", "DIRECTOR_CALL", "DIRECTOR_MEETING", "SELF", "HR_REQUEST", "OTHER"]
    relationship: str = Field(min_length=1, max_length=60)
    delivery_address: str | None = Field(default=None, max_length=600)
    special_instructions: str | None = Field(default=None, max_length=500)


@planning_router.get("/accounts")
def planning_accounts(user: CurrentUserDep):
    return {"data": service.planning_accounts(user), "message": "OK"}


@planning_router.get("/options")
def options(user: CurrentUserDep, company_id: Annotated[str, Query(alias="companyId")], recipient_id: Annotated[UUID | None, Query(alias="recipientId")] = None):
    return {"data": service.options(user, company_id, str(recipient_id) if recipient_id else None), "message": "OK"}


@planning_router.post("/occasions", status_code=201)
def new_occasion(body: NewDay, user: CurrentUserDep):
    data = service.create_occasion(user, body.company_id, {"occasionName": body.name.strip(), "occasionDate": body.day.isoformat()})
    return {"data": data, "message": "Occasion created."}


@planning_router.post("/events", status_code=201)
def new_event(body: NewEvent, user: CurrentUserDep):
    data = service.create_event(user, body.company_id, str(body.recipient_id), {"eventName": body.name.strip(), "eventDate": body.day.isoformat()})
    return {"data": data, "message": "Event created."}


@planning_router.post("/requests", status_code=201)
def new_request(body: NewRequest, user: CurrentUserDep):
    request = body.model_dump(mode="json", by_alias=True, exclude={"company_id", "budget"}, exclude_none=True)
    if body.budget_mode == "SPECIFIC" and body.budget:
        request["budgetMin"] = request["budgetMax"] = round(body.budget, 2)
    return {"data": service.create_request(user, body.company_id, request), "message": "Gift request sent."}


# --- the client's Gifting OS set-up ---------------------------------------------------------------------------------

clients_router = APIRouter(prefix="/gifting-clients", tags=["gift requests"])


class Invite(CamelModel):
    email: str = Field(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    full_name: str | None = Field(default=None, max_length=150)
    client_role: Literal["OWNER", "EA", "HR"] = "OWNER"


@clients_router.get("/{company_id}")
def client_status(company_id: UUID, user: CurrentUserDep):
    return {"data": clients.status(user, str(company_id)), "message": "OK"}


@clients_router.post("/{company_id}", status_code=201)
def set_up_client(company_id: UUID, user: CurrentUserDep):
    return {"data": clients.set_up(user, str(company_id)), "message": "Set up in Gifting OS."}


@clients_router.post("/{company_id}/users", status_code=201)
def invite_user(company_id: UUID, body: Invite, user: CurrentUserDep):
    data = clients.invite(user, str(company_id), body.email.strip(), body.full_name, body.client_role)
    return {"data": data, "message": "Invitation sent."}
