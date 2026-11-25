"""People (recipients of a client's gifts) and their groups: request and response shapes. camelCase on the wire."""
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import ConfigDict, Field, field_validator, model_validator

from src.core.schema import CamelModel

Relationship = Literal["CLIENT", "EMPLOYEE", "PARTNER", "ADVISOR", "VENDOR", "FAMILY", "SPOUSE", "CHILD", "PARENT", "SIBLING", "FRIEND", "OTHER"]
RecipientStatus = Literal["ACTIVE", "ARCHIVED"]
RecipientType = Literal["INTERNAL", "EXTERNAL"]
AddressLabel = Literal["PERMANENT", "CURRENT", "OFFICE"]
LinkType = Literal["SPOUSE", "SON", "DAUGHTER", "PARENT", "SIBLING", "BUSINESS_ASSOCIATE", "COLLEAGUE", "OTHER"]
EMAIL = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
Money = Decimal

STRICT = ConfigDict(extra="forbid", str_strip_whitespace=True)


class _Strict(CamelModel):
    model_config = ConfigDict(**CamelModel.model_config, **STRICT)


class _Person(_Strict):
    """Fields shared by create and update."""
    mobile_number: str | None = Field(default=None, max_length=20)
    email: str | None = Field(default=None, max_length=254, pattern=EMAIL)
    company_name: str | None = Field(default=None, max_length=200)
    designation: str | None = Field(default=None, max_length=120)
    department: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default=None, max_length=100)
    date_of_birth: date | None = None
    anniversary_date: date | None = None
    budget: Money | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    birthday_budget: Money | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    anniversary_budget: Money | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    gifting_occasion: str | None = Field(default=None, max_length=200)
    remark: str | None = Field(default=None, max_length=2000)
    relationship: Relationship | None = None

    @field_validator("date_of_birth")
    @classmethod
    def not_in_future(cls, v: date | None) -> date | None:
        if v and v > date.today():
            raise ValueError("The date of birth is in the future.")
        return v

    @field_validator("email", "company_name", "designation", "department", "city", "gifting_occasion", "remark", "mobile_number", mode="before")
    @classmethod
    def blank_is_none(cls, v):
        return None if isinstance(v, str) and not v.strip() else v


class RecipientCreate(_Person):
    company_id: str
    name: str = Field(min_length=1, max_length=200)
    recipient_type: RecipientType = "INTERNAL"
    is_primary: bool = False
    allow_duplicate: bool = False  # "this is a different person" after the duplicate prompt
    address: "AddressIn | None" = None  # optional first (default) delivery address


class RecipientUpdate(_Person):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    recipient_type: RecipientType | None = None
    status: RecipientStatus | None = None
    is_primary: bool | None = None
    version: int = Field(ge=1)  # the copy the person edited; a newer save in between is refused

    @model_validator(mode="after")
    def something_to_change(self):
        changed = self.model_fields_set - {"version"}
        if not changed:
            raise ValueError("Change at least one field.")
        for f in ("name", "recipient_type", "status", "is_primary"):
            if f in changed and getattr(self, f) is None:
                raise ValueError(f"{f.replace('_', ' ').capitalize()} cannot be empty.")
        return self


class AddressIn(_Strict):
    label: AddressLabel = "OFFICE"
    address_line1: str = Field(min_length=3, max_length=300)
    address_line2: str | None = Field(default=None, max_length=300)
    city: str = Field(min_length=1, max_length=100)
    state: str | None = Field(default=None, max_length=100)
    postal_code: str = Field(pattern=r"^[0-9]{6}$")
    country: str = Field(default="IN", pattern=r"^[A-Z]{2}$")
    is_default: bool = False


class AddressUpdate(_Strict):
    label: AddressLabel | None = None
    address_line1: str | None = Field(default=None, min_length=3, max_length=300)
    address_line2: str | None = Field(default=None, max_length=300)
    city: str | None = Field(default=None, min_length=1, max_length=100)
    state: str | None = Field(default=None, max_length=100)
    postal_code: str | None = Field(default=None, pattern=r"^[0-9]{6}$")
    country: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")
    is_default: bool | None = None


Tag = str


class PreferencesIn(_Strict):
    interests: list[Tag] = Field(default_factory=list, max_length=30)
    preferred_brands: list[Tag] = Field(default_factory=list, max_length=30)
    gift_preferences: str | None = Field(default=None, max_length=2000)
    dietary_preferences: str | None = Field(default=None, max_length=1000)
    gifts_to_avoid: str | None = Field(default=None, max_length=1000)
    special_instructions: str | None = Field(default=None, max_length=2000)

    @field_validator("interests", "preferred_brands")
    @classmethod
    def tags(cls, v: list[str]) -> list[str]:
        out = []
        for t in v:
            t = t.strip()
            if not 1 <= len(t) <= 60:
                raise ValueError("Each item must be 1 to 60 characters.")
            if t.lower() not in [x.lower() for x in out]:
                out.append(t)
        return out


class LinkIn(_Strict):
    related_recipient_id: str
    relationship_type: LinkType


class LinksIn(_Strict):
    items: list[LinkIn] = Field(default_factory=list, max_length=50)


class Ids(_Strict):
    recipient_ids: list[str] = Field(min_length=1, max_length=1000)


class BulkStatus(Ids):
    status: RecipientStatus


class GroupIn(_Strict):
    company_id: str
    name: str = Field(min_length=1, max_length=120)
    recipient_ids: list[str] = Field(default_factory=list, max_length=1000)

    @field_validator("recipient_ids")
    @classmethod
    def unique(cls, v: list[str]) -> list[str]:
        if len(set(v)) != len(v):
            raise ValueError("A person is in the list twice.")
        return v


class GroupUpdate(_Strict):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    recipient_ids: list[str] | None = Field(default=None, max_length=1000)
    add_recipient_ids: list[str] | None = Field(default=None, max_length=1000)  # add these, keep the rest


class GroupIds(_Strict):
    group_ids: list[str] = Field(min_length=1, max_length=200)


RecipientCreate.model_rebuild()
