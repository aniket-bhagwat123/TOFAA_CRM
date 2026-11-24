from datetime import date

from pydantic import Field, field_validator, model_validator

from src.core.schema import CamelModel
from src.core.validators import Email, clean_phone
from src.modules.leads.stages import ALL_STAGES, VALUE_BANDS


def _blank_to_none(v):
    return v.strip() or None if isinstance(v, str) else v


class LeadCreate(CamelModel):
    """Three mandatory fields: company, contact name, and a phone or an email."""

    company_name: str = Field(min_length=1, max_length=200)
    contact_name: str = Field(min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=25)
    email: Email | None = None
    source: str | None = Field(default=None, max_length=60)
    designation: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default=None, max_length=120)
    value_band: str | None = None
    notes: str | None = Field(default=None, max_length=4000)
    next_follow_up: date | None = None  # defaults to the next business day
    owner_id: str | None = None  # managers/admin can create on behalf of someone
    use_existing_company: bool = False  # allow a new contact at a company that already exists

    @field_validator("company_name", "contact_name", "phone", "source", "designation", "city", "notes", mode="before")
    @classmethod
    def _strip(cls, v):
        return _blank_to_none(v)

    @field_validator("email", mode="before")
    @classmethod
    def _email_blank(cls, v):
        return _blank_to_none(v)

    @field_validator("value_band")
    @classmethod
    def _band(cls, v):
        if v and v not in VALUE_BANDS:
            raise ValueError("Unknown value band.")
        return v or None

    @field_validator("phone")
    @classmethod
    def _ten_digit_phone(cls, v):
        return clean_phone(v)  # exactly 10 digits, or a friendly error

    @model_validator(mode="after")
    def _needs_contact_channel(self):
        if not self.company_name or not self.contact_name:
            raise ValueError("Company and contact name are required.")
        if not self.phone and not self.email:
            raise ValueError("Enter a phone number or an email.")
        return self


class DuplicateCheck(CamelModel):
    company_name: str | None = None
    phone: str | None = None
    email: str | None = None


class LeadUpdate(CamelModel):
    version: int
    source: str | None = None
    value_band: str | None = None
    notes: str | None = None
    estimate_amount: float | None = Field(default=None, gt=0, le=1e11)  # "Add deal amount" on the lead card
    company_name: str | None = Field(default=None, min_length=1, max_length=200)
    city: str | None = None
    contact_name: str | None = Field(default=None, min_length=1, max_length=200)
    designation: str | None = None
    phone: str | None = None
    email: Email | None = None

    @field_validator("phone")
    @classmethod
    def _ten_digit_phone(cls, v):
        return clean_phone(v)  # exactly 10 digits, or a friendly error


class StageMove(CamelModel):
    stage: str
    next_follow_up: date | None = None
    lost_reason: str | None = None
    requirement: dict[str, str | int | float | None] = Field(default_factory=dict)

    @field_validator("stage")
    @classmethod
    def _stage(cls, v):
        if v not in ALL_STAGES:
            raise ValueError("Unknown stage.")
        return v

    @field_validator("lost_reason")
    @classmethod
    def _reason(cls, v):
        from src.core import app_settings

        # The list is edited in Settings; "Invalid contact" is always allowed (a Wrong contact call closes with it).
        if v and v not in app_settings.lost_reasons() and v != "Invalid contact":
            raise ValueError("Pick a reason from the list.")
        return v


class Reassign(CamelModel):
    owner_id: str
    note: str | None = Field(default=None, max_length=500)
