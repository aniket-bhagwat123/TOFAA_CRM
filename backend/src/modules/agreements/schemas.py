from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, field_validator

from src.core.schema import CamelModel
from src.modules.orders.handover_schemas import LocationIn
from src.modules.quotations.schemas import PackageIn, PackageItemIn

Text = Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]

# Scope of work: the fixed choices on the agreement ("other" adds a free text line).
SCOPE = {
    "curation_design": "Curation & Design",
    "custom_branding": "Custom Branding & Logo Embossing",
    "sourcing_manufacturing": "Sourcing & Manufacturing",
    "quality_control": "Quality Control & Assembly",
    "custom_packaging": "Custom Packaging & Gift Boxes",
    "individual_shipping": "Individual Shipping & Doorstep Delivery",
    "bulk_warehousing": "Bulk Warehousing & Logistics",
    "other": "Other",
}
GST_RATES = (0, 5, 12, 18, 28)

DEFAULT_TERMS = [
    {"title": "Prototype Approval", "body": "Mass assembly begins following client sign-off on the sample benchmark or digital proof."},
    {"title": "Material Fidelity", "body": "All deliverables and packaging materials strictly adhere to Schedule A specifications."},
    {"title": "Fulfillment & Logistics", "body": "Shipment coordinated to designated locations with milestone tracking and dispatch verification."},
    {"title": "Confidentiality", "body": "Custom branding and artwork remain the exclusive intellectual property of the Client."},
]


class TermIn(CamelModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


class AgreementItemIn(PackageItemIn):
    """An item of a package, with what the OMS handover also needs about it. All optional."""

    quantity_per_kit: int | None = Field(default=None, ge=1, le=10_000_000)
    is_packaging: bool = False
    product_id: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    photos: list[str] = Field(default_factory=list, max_length=10)


class AgreementPackageIn(PackageIn):
    items: list[AgreementItemIn] = Field(default_factory=list, max_length=50)


class DeliveryDetailsIn(CamelModel):
    """Taken once, with the agreement, and carried into the OMS handover. Anything not known yet is left empty."""

    expected_delivery: date | None = None
    advance_percent: Decimal | None = Field(default=None, ge=0, le=100, decimal_places=2)
    campaign_name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    client_type: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    instructions: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] | None = None
    design_brief: Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)] | None = None
    sample_required: bool | None = None
    delivery_locations: list[LocationIn] = Field(default_factory=list, max_length=500)


class AgreementDetails(CamelModel):
    packages: list[AgreementPackageIn] = Field(min_length=1, max_length=20)
    handover: DeliveryDetailsIn | None = None  # left out: the saved delivery details stay
    scope: list[str] = Field(default_factory=list, max_length=len(SCOPE))
    scope_other: Text | None = None
    transportation: Decimal = Field(default=Decimal("0"), ge=0, le=Decimal("10000000000"))
    gst_rate: Literal[0, 5, 12, 18, 28] = 18
    terms: list[TermIn] = Field(default_factory=list, max_length=20)
    tofaa_signee: Text | None = None
    client_signee: Text | None = None
    remarks: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] | None = None

    @field_validator("scope")
    @classmethod
    def _scope(cls, v: list[str]) -> list[str]:
        unknown = [s for s in v if s not in SCOPE]
        if unknown:
            raise ValueError("Pick the scope of work from the list.")
        return list(dict.fromkeys(v))
