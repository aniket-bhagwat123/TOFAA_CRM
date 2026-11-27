from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, field_validator

from src.core.schema import CamelModel

Status = Literal["new", "ready", "accepted", "rejected", "production", "quality_check", "packed", "dispatched", "delivered", "on_hold", "cancelled"]
Short = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
Long = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
Money = Annotated[Decimal, Field(ge=0, le=Decimal("10000000000"))]
GstRate = Literal[0, 5, 12, 18, 28]


class ItemDetail(CamelModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    description: Long | None = None


class Item(CamelModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    quantity: Annotated[Decimal, Field(gt=0, le=Decimal("10000000"))]
    unit_price: Money
    details: list[ItemDetail] = Field(default_factory=list, max_length=50)


class Details(CamelModel):
    expected_delivery: date | None = None
    delivery_address: Long | None = None
    receiver_name: Short | None = None
    receiver_phone: Short | None = None
    instructions: Long | None = None
    billing_name: Short | None = None
    billing_gstin: Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^([A-Za-z0-9]{15})?$")] | None = None
    notes: Long | None = None

    @field_validator("*", mode="before")
    @classmethod
    def _blank(cls, v):
        return None if isinstance(v, str) and not v.strip() else v


class OrderCreate(Details):
    company_id: str
    items: list[Item] = Field(min_length=1, max_length=100)
    transportation: Money = Decimal("0")
    gst_rate: GstRate = 18


class OrderUpdate(Details):
    items: list[Item] | None = Field(default=None, min_length=1, max_length=100)
    transportation: Money | None = None
    gst_rate: GstRate | None = None
    courier: Short | None = None
    tracking_number: Short | None = None
    tracking_url: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500, pattern=r"^(https?://\S+)?$")] | None = None
    oms_reference: Short | None = None


class StatusChange(CamelModel):
    status: Status
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None
