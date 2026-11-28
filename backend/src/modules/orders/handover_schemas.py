"""Request shapes of the CRM screens (camelCase). The OMS shapes are in oms_schemas.py."""
from datetime import date
from decimal import Decimal
from typing import Annotated

from pydantic import Field, StringConstraints, field_validator

from src.core.schema import CamelModel

Ref = Annotated[str, StringConstraints(strip_whitespace=True, max_length=40, pattern=r"^[A-Za-z0-9_-]*$")]
Short = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
Long = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
Path = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
Whole = Annotated[int, Field(ge=1, le=10_000_000)]


class _Blank(CamelModel):
    @field_validator("*", mode="before")
    @classmethod
    def _blank(cls, v):
        return None if isinstance(v, str) and not v.strip() else v


class FileIn(CamelModel):
    path: Path
    name: Short


class ItemIn(_Blank):
    item_ref: Ref | None = None  # empty for a new item; the server makes one and keeps it for good
    product_id: Short | None = None
    name: Short | None = None
    description: Long | None = None
    quantity_per_kit: Whole | None = None
    is_packaging: bool = False
    photos: list[Path] = Field(default_factory=list, max_length=10)


class LocationIn(_Blank):
    location_ref: Ref | None = None
    line: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None
    city: Short | None = None
    state: Short | None = None
    pincode: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\d{6}$")] | None = None
    contact_name: Short | None = None
    contact_phone: Annotated[str, StringConstraints(strip_whitespace=True, max_length=25)] | None = None
    quantity: Whole | None = None


class SampleIn(_Blank):
    required: bool | None = None
    approver_name: Short | None = None
    approved_on: date | None = None
    evidence: FileIn | None = None


class HandoverIn(_Blank):
    """The whole form. It may be saved incomplete; sending for approval checks it."""

    client_type: Short | None = None
    campaign_name: Short | None = None
    total_kits: Whole | None = None
    expected_delivery: date | None = None
    advance_percent: Annotated[Decimal, Field(ge=0, le=100, decimal_places=2)] | None = None
    design_brief: Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)] | None = None
    reference_files: list[FileIn] = Field(default_factory=list, max_length=20)
    logo_files: list[FileIn] = Field(default_factory=list, max_length=10)
    sample: SampleIn = Field(default_factory=SampleIn)
    items: list[ItemIn] = Field(default_factory=list, max_length=200)
    delivery_locations: list[LocationIn] = Field(default_factory=list, max_length=500)
    instructions: Long | None = None


class Decision(CamelModel):
    approve: bool
    version: int = Field(ge=0, description="The handover version the manager was looking at")
    submitted_at: str = Field(description="When what the manager was looking at was sent")
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None


class Cancel(CamelModel):
    note: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
