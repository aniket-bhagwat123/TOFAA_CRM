"""The OS-side modules in the CRM: HTTP only (the service checks role and account).

Answers are not passed through core.schema.ok(): Gifting OS already answers in camelCase."""
from datetime import date
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Path, Query
from pydantic import Field

from src.core.schema import CamelModel
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.os_modules import service

router = APIRouter(prefix="/os", tags=["gifting os modules"])
Page = Annotated[int, Query(ge=1)]
Limit = Annotated[int, Query(ge=1, le=100)]
# A client's id, or "all" for every client the person may see.
Scope = Annotated[str, Path(pattern=r"^(all|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$")]


def _ok(data: Any, message: str = "OK") -> dict:
    return {"data": data, "message": message}


class Day(CamelModel):
    """An occasion (for the whole client) or an event (for one person)."""
    name: str = Field(min_length=1, max_length=150)
    day: date
    description: str | None = Field(default=None, max_length=2000)
    repeat_annually: bool = False
    category: str | None = Field(default=None, max_length=60)  # a company occasion's category
    occasion_type: str | None = Field(default=None, max_length=60)  # a person's occasion (Birthday ...)
    relationship: str | None = Field(default=None, max_length=60)
    priority: Literal["NORMAL", "HIGH", "VIP"] | None = None
    notes: str | None = Field(default=None, max_length=2000)


class NewEvent(Day):
    recipient_id: UUID


def _sent(body: Day, *fields: str) -> dict:
    """Only what the form sent, so a change never clears a detail it did not show."""
    values = {"category": body.category, "occasionType": body.occasion_type, "relationship": body.relationship,
              "priority": body.priority, "notes": body.notes}
    names = {"category": "category", "occasionType": "occasion_type", "relationship": "relationship",
             "priority": "priority", "notes": "notes"}
    out = {}
    for key in fields:
        if names[key] not in body.model_fields_set:
            continue
        value = (values[key] or "").strip() or None
        if value is not None or key == "notes":  # notes may be cleared; the others keep what is saved
            out[key] = value
    return out


def _occasion(body: Day) -> dict:
    return {"occasionName": body.name.strip(), "occasionDate": body.day.isoformat(),
            "description": (body.description or "").strip() or None, "repeatAnnually": body.repeat_annually,
            **_sent(body, "category", "priority", "notes")}


def _event(body: Day) -> dict:
    out = {"eventName": body.name.strip(), "eventDate": body.day.isoformat(), "repeatAnnually": body.repeat_annually,
           **_sent(body, "occasionType", "relationship", "priority", "notes")}
    if "description" in body.model_fields_set:
        out["description"] = (body.description or "").strip() or None
    return out


@router.get("/gift-ideas")
def gift_ideas(user: CurrentUserDep, page: Page = 1, limit: Limit = 100, search: Annotated[str | None, Query(max_length=100)] = None):
    return _ok(service.gift_ideas(user, page, limit, search))


class Idea(CamelModel):
    occasion: str = Field(min_length=1, max_length=150)
    gift_idea: str = Field(min_length=1, max_length=300)
    category: str | None = Field(default=None, max_length=60)
    gift_to: list[str] = Field(default_factory=list, max_length=20)
    start_date: date | None = None
    end_date: date | None = None
    is_active: bool = True


def _idea(body: Idea) -> dict:
    return body.model_dump(mode="json", by_alias=True)


@router.post("/gift-ideas", status_code=201)
def create_gift_idea(body: Idea, user: CurrentUserDep):
    return _ok(service.write_idea(user, "POST", payload={"idea": _idea(body)}), "Gift idea added.")


@router.patch("/gift-ideas/{idea_id}")
def update_gift_idea(idea_id: UUID, body: Idea, user: CurrentUserDep):
    return _ok(service.write_idea(user, "PATCH", str(idea_id), {"changes": _idea(body)}), "Gift idea updated.")


@router.delete("/gift-ideas/{idea_id}")
def delete_gift_idea(idea_id: UUID, user: CurrentUserDep):
    return _ok(service.write_idea(user, "DELETE", str(idea_id)), "Gift idea deleted.")


@router.get("/{company_id}/home")
def home(company_id: Scope, user: CurrentUserDep, month: str | None = None, category: str = "ALL"):
    return _ok(service.read(user, str(company_id), "home", {"month": month, "category": category}))


@router.get("/{company_id}/calendar")
def calendar(company_id: Scope, user: CurrentUserDep, q: str | None = None, tab: str = "ALL", sort: str = "soonest",
             page: Page = 1, limit: Annotated[int, Query(ge=1, le=500)] = 20):
    return _ok(service.read(user, str(company_id), "calendar", {"q": q, "tab": tab, "sort": sort, "page": page, "limit": limit}))


@router.get("/{company_id}/occasions")
def occasions(company_id: Scope, user: CurrentUserDep, page: Page = 1, limit: Limit = 100):
    return _ok(service.read(user, str(company_id), "occasions", {"page": page, "limit": limit}))


@router.get("/{company_id}/events")
def events(company_id: Scope, user: CurrentUserDep, page: Page = 1, limit: Limit = 20):
    return _ok(service.read(user, str(company_id), "events", {"page": page, "limit": limit}))


@router.get("/{company_id}/recipients")
def recipients(company_id: UUID, user: CurrentUserDep, q: str | None = None):
    return _ok(service.read(user, str(company_id), "recipients", {"q": q}))


@router.get("/{company_id}/activity")
def activity(company_id: Scope, user: CurrentUserDep, page: Page = 1, limit: Limit = 20):
    return _ok(service.read(user, str(company_id), "activity", {"page": page, "limit": limit}))


@router.post("/{company_id}/occasions", status_code=201)
def create_occasion(company_id: UUID, body: Day, user: CurrentUserDep):
    return _ok(service.write(user, str(company_id), "POST", "occasions", {"occasion": _occasion(body)}), "Occasion created.")


@router.patch("/{company_id}/occasions/{occasion_id}")
def update_occasion(company_id: UUID, occasion_id: UUID, body: Day, user: CurrentUserDep):
    return _ok(service.write(user, str(company_id), "PATCH", f"occasions/{occasion_id}", {"changes": _occasion(body)}), "Occasion updated.")


@router.delete("/{company_id}/occasions/{occasion_id}")
def delete_occasion(company_id: UUID, occasion_id: UUID, user: CurrentUserDep):
    return _ok(service.write(user, str(company_id), "DELETE", f"occasions/{occasion_id}"), "Occasion deleted.")


@router.post("/{company_id}/events", status_code=201)
def create_event(company_id: UUID, body: NewEvent, user: CurrentUserDep):
    payload = {"recipientId": str(body.recipient_id), "event": _event(body)}
    return _ok(service.write(user, str(company_id), "POST", "events", payload), "Event created.")


@router.patch("/{company_id}/events/{event_id}")
def update_event(company_id: UUID, event_id: UUID, body: Day, user: CurrentUserDep):
    return _ok(service.write(user, str(company_id), "PATCH", f"events/{event_id}", {"changes": _event(body)}), "Event updated.")


@router.delete("/{company_id}/events/{event_id}")
def delete_event(company_id: UUID, event_id: UUID, user: CurrentUserDep):
    return _ok(service.write(user, str(company_id), "DELETE", f"events/{event_id}"), "Event deleted.")
