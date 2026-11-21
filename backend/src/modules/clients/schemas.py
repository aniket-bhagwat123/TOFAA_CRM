from datetime import date
from typing import Literal

from pydantic import Field, field_validator, model_validator

from src.core.schema import CamelModel
from src.core.validators import Email, clean_phone


def _blank(v):
    return v.strip() or None if isinstance(v, str) else v


class ClientCreate(CamelModel):
    """Add an existing customer by hand: either convert a company already in the CRM, or type a new one."""

    company_id: str | None = None
    company_name: str | None = Field(default=None, max_length=200)
    contact_name: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=25)
    email: Email | None = None
    designation: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default=None, max_length=120)

    @field_validator("company_name", "contact_name", "designation", "city", "phone", mode="before")
    @classmethod
    def _strip(cls, v):
        return _blank(v)

    @field_validator("email", mode="before")
    @classmethod
    def _email_blank(cls, v):
        return _blank(v)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v):
        return clean_phone(v)

    @model_validator(mode="after")
    def _needs(self):
        if self.company_id:
            return self
        if not self.company_name or not self.contact_name:
            raise ValueError("Company and contact name are required.")
        if not self.phone and not self.email:
            raise ValueError("Enter a phone number or an email.")
        return self


class ClientUpdate(CamelModel):
    account_owner_id: str | None = None
    tier_override: Literal["A", "B", "C"] | None = None
    clear_tier_override: bool = False


class ContactCreate(CamelModel):
    name: str = Field(min_length=1, max_length=200)
    designation: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=25)
    email: Email | None = None

    @field_validator("phone", "designation", mode="before")
    @classmethod
    def _strip(cls, v):
        return _blank(v)

    @field_validator("email", mode="before")
    @classmethod
    def _email_blank(cls, v):
        return _blank(v)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v):
        return clean_phone(v)

    @model_validator(mode="after")
    def _reach(self):
        if not self.phone and not self.email:
            raise ValueError("Enter a phone number or an email.")
        return self


class OccasionCreate(CamelModel):
    name: str = Field(min_length=1, max_length=80)
    from_calendar: bool = False
    month: int | None = Field(default=None, ge=1, le=12)
    day: int | None = Field(default=None, ge=1, le=31)
    lead_days: int = Field(default=45, ge=1, le=180)
    notes: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _date(self):
        if not self.from_calendar and (self.month is None or self.day is None):
            raise ValueError("Pick the date of this occasion.")
        return self


class FollowUpCreate(CamelModel):
    due_date: date
    title: str | None = Field(default=None, max_length=200)


class FollowUpComplete(CamelModel):
    outcome: Literal["interested", "not_now", "no_answer", "done"]
    note: str | None = Field(default=None, max_length=2000)
    next_follow_up: date | None = None
    project_title: str | None = Field(default=None, max_length=200)


class ProjectCreate(CamelModel):
    title: str = Field(min_length=1, max_length=200)
    occasion: str | None = Field(default=None, max_length=80)
    origin: Literal["outbound", "inbound", "occasion"] = "outbound"
    contact_id: str | None = None
    quantity: float | None = Field(default=None, gt=0)
    budget: float | None = Field(default=None, gt=0)
    delivery_date: date | None = None
    notes: str | None = Field(default=None, max_length=4000)
    next_follow_up: date | None = None


class RepeatProject(CamelModel):
    source_project_id: str
    title: str | None = Field(default=None, max_length=200)
    occasion: str | None = Field(default=None, max_length=80)


class CalendarCreate(CamelModel):
    name: str = Field(min_length=1, max_length=80)
    occurs_on: date


class CampaignCreate(CamelModel):
    occasion: str = Field(min_length=1, max_length=80)
    occurs_on: date | None = None
    name: str | None = Field(default=None, max_length=120)
    due_date: date | None = None
