from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, model_validator

from src.core.schema import CamelModel

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Detail = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]


class PackageItemIn(CamelModel):
    """One gifting item inside a requirement package. Not priced on its own: the package carries the price."""
    name: Name
    description: Detail | None = None
    # Only when items are priced one by one: the rate of one piece. Empty on every item = one price for the requirement.
    unit_price: Decimal | None = Field(default=None, ge=0, le=Decimal("10000000000"))


class PackageIn(CamelModel):
    """A client requirement: its own name, rate per unit, quantity, items and mockup photos."""
    name: Name
    unit_price: Decimal = Field(ge=0, le=Decimal("10000000000"))
    quantity: Decimal = Field(gt=0, le=10_000_000)
    items: list[PackageItemIn] = Field(default_factory=list, max_length=50)
    photos: list[str] = Field(default_factory=list, max_length=10)  # storage paths from POST /leads/{id}/quotation-photos

    @model_validator(mode="after")
    def _item_prices(self):
        """Items are priced all or none. When priced, the requirement's rate is what one set of them costs."""
        priced = [i for i in self.items if i.unit_price is not None]
        if not priced:
            return self
        if len(priced) != len(self.items):
            raise ValueError("Give every item a rate, or none of them.")
        self.unit_price = sum((i.unit_price * (getattr(i, "quantity_per_kit", None) or 1) for i in self.items), Decimal("0"))
        return self


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
