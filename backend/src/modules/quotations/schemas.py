from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from src.core.schema import CamelModel

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Detail = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]


class PackageItemIn(CamelModel):
    """One gifting item inside a requirement package. Not priced on its own: the package carries the price."""
    name: Name
    description: Detail | None = None


class PackageIn(CamelModel):
    """A client requirement: its own name, rate per unit, quantity, items and mockup photos."""
    name: Name
    unit_price: Decimal = Field(ge=0, le=Decimal("10000000000"))
    quantity: Decimal = Field(gt=0, le=10_000_000)
    items: list[PackageItemIn] = Field(default_factory=list, max_length=50)
    photos: list[str] = Field(default_factory=list, max_length=10)  # storage paths from POST /leads/{id}/quotation-photos


class QuotationCreate(CamelModel):
    template_id: str | None = None
    packages: list[PackageIn] = Field(min_length=1, max_length=20)
    notes: str | None = Field(default=None, max_length=2000)


class SendQuotation(CamelModel):
    channel: Literal["whatsapp", "email"]
    next_follow_up: date


class Decision(CamelModel):
    approve: bool
    note: str | None = Field(default=None, max_length=500)


class TemplateIn(CamelModel):
    name: str = Field(min_length=1, max_length=100)
    intro: str | None = Field(default=None, max_length=1000)
    terms: str | None = Field(default=None, max_length=3000)
    footer: str | None = Field(default=None, max_length=500)
    is_default: bool = False
