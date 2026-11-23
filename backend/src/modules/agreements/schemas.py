from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, field_validator

from src.core.schema import CamelModel
from src.modules.quotations.schemas import PackageIn

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


class AgreementDetails(CamelModel):
    packages: list[PackageIn] = Field(min_length=1, max_length=20)
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
