from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import Field

from src.core.schema import CamelModel


class ItemIn(CamelModel):
    description: str = Field(min_length=1, max_length=300)
    quantity: Decimal = Field(gt=0, le=10_000_000)
    unit_price: Decimal = Field(ge=0, le=Decimal("10000000000"))


class QuotationCreate(CamelModel):
    template_id: str | None = None
    items: list[ItemIn] = Field(min_length=1, max_length=50)
    discount_pct: Decimal = Field(default=Decimal("0"), ge=0, le=100)
    valid_days: int = Field(default=15, ge=1, le=365)
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
