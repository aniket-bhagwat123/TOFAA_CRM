"""The OMS contract as Swagger shows it (snake_case, dates YYYY-MM-DD, times UTC ISO 8601, whole quantities)."""
from datetime import date
from typing import Annotated, Generic, Literal, TypeVar

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, model_validator

Stage = Literal["accepted", "design_and_procurement", "warehouse_ready", "packing", "dispatched", "delivered", "on_hold", "cancelled"]
HandoverStatus = Literal["approved", "cancelled"]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
T = TypeVar("T")


class Envelope(BaseModel, Generic[T]):
    data: T
    message: str = "OK"


class ErrorResponse(BaseModel):
    data: dict | None = Field(None, description="For 422: {errors: [{field, message}]}")
    message: str


# --- what OMS reads ---------------------------------------------------------------------------------------------------

class Client(BaseModel):
    client_id: str
    company_name: str = Field(max_length=200)
    client_type: str | None = Field(None, examples=["Key Account"])


class SalesOwner(BaseModel):
    name: str
    email: str


class DesignBrief(BaseModel):
    text: str | None = None
    reference_file_urls: list[str] = Field(description="Signed links, valid for at least 10 minutes: download, do not store")
    logo_file_urls: list[str]


class SampleApproval(BaseModel):
    approver_name: str
    approved_on: date
    evidence_url: str | None = Field(description="Signed link; null if the file could not be signed (read again)")


class Sample(BaseModel):
    required: bool
    approval: SampleApproval | None = Field(None, description="null until the client approved the sample")


class Item(BaseModel):
    item_ref: str = Field(description="CRM line ID; stays the same across versions")
    product_id: str | None = Field(None, description="Blank for custom items; OMS Procurement links it later")
    name: str
    description: str | None = None
    quantity_per_kit: int = Field(ge=1)
    is_packaging: bool
    photo_urls: list[str]


class Address(BaseModel):
    line: str
    city: str
    state: str
    pincode: str = Field(examples=["411001"])


class DeliveryLocation(BaseModel):
    location_ref: str = Field(description="CRM ID; send it back with shipments")
    address: Address
    contact_name: str
    contact_phone: str
    quantity: int | None = Field(None, description="Kits for this location, when decided")


class Handover(BaseModel):
    handover_number: str = Field(description="Unique, never reused. Use it to stop duplicates.", examples=["HO-2027-0001"])
    deal_number: str | None = Field(None, examples=["DEAL-2027-0001"])
    deal_id: str
    version: int = Field(ge=1, description="+1 on every approved edit and on cancel")
    status: HandoverStatus
    updated_at: str = Field(description="UTC; poll with updated_since", examples=["2027-01-05T10:30:00Z"])
    client: Client
    sales_owner: SalesOwner
    campaign_name: str | None = Field(None, examples=["Diwali 2027"])
    total_kits: int = Field(ge=1)
    delivery_deadline: date = Field(description="Requested date; OMS Ops confirms it (confirmed_delivery_deadline)")
    advance_percent: float | None = Field(None, ge=0, le=100, description="Optional (null when not set). OMS shows it; Finance confirms payment in OMS")
    design_brief: DesignBrief
    sample: Sample
    items: list[Item]
    delivery_locations: list[DeliveryLocation]
    client_instructions: str | None = None


class HandoverPage(BaseModel):
    items: list[Handover]
    page: int
    limit: int
    total: int


# --- what OMS sends -----------------------------------------------------------------------------------------------------

class ShipmentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    location_ref: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
    kits: int | None = Field(None, ge=1, le=10_000_000, description="Kits in this shipment; required when dispatching")
    transporter: Text | None = None
    tracking_number: Text | None = Field(None, description="Tells two shipments to one location apart")
    dispatched_at: AwareDatetime | None = Field(None, description="Defaults to changed_at when stage is dispatched")
    delivered_at: AwareDatetime | None = Field(None, description="Defaults to changed_at when stage is delivered")


class StatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", json_schema_extra={"examples": [{
        "oms_order_id": "6f1c2a", "oms_order_number": "TOF-ORD-2027-00001", "stage": "dispatched",
        "changed_at": "2027-01-20T09:15:00Z", "note": "First lot",
        "locations": [{"location_ref": "LOC-1a2b3c4d5e", "kits": 60, "transporter": "BlueDart", "tracking_number": "BD123",
                       "dispatched_at": "2027-01-20T09:00:00Z"}]}]})

    oms_order_id: Text
    oms_order_number: str = Field(pattern=r"^TOF-ORD-\d{4}-\d{5}$", examples=["TOF-ORD-2027-00001"])
    stage: Stage
    changed_at: AwareDatetime = Field(description="When the change happened in OMS, with a time zone")
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = Field(
        None, description="Required for on_hold and cancelled")
    confirmed_delivery_deadline: date | None = Field(None, description="The date OMS Ops confirmed")
    locations: list[ShipmentIn] = Field(default_factory=list, max_length=500, description="For dispatched and delivered")

    @model_validator(mode="after")
    def _needed(self):
        if self.stage in ("on_hold", "cancelled") and not self.note:
            raise ValueError("note is required for on_hold and cancelled")
        if self.stage in ("dispatched", "delivered") and not self.locations:
            raise ValueError("locations are required for dispatched and delivered")
        if self.stage == "dispatched" and any(x.kits is None for x in self.locations):
            raise ValueError("kits are required for each location when dispatching")
        return self


class PaymentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", json_schema_extra={"examples": [
        {"payment_status": "success", "changed_at": "2027-01-06T09:00:00Z"}]})

    payment_status: Literal["pending", "success"] = Field(description="What OMS Finance says about the payment")
    changed_at: AwareDatetime = Field(description="When it changed in OMS, with a time zone")


class PaymentResult(BaseModel):
    handover_number: str
    applied: bool = Field(description="false: the message was not newer than the last one and changed nothing")
    payment_status: Literal["pending", "success"]


class StatusResult(BaseModel):
    handover_number: str
    applied: bool = Field(description="false: the message was not newer than the last one and changed nothing")
    crm_status: str = Field(examples=["production"])
    oms_stage: str | None
    recorded_steps: list[str] = Field(description="CRM statuses recorded by this message, oldest first")
