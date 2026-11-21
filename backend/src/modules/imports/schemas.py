from typing import Literal

from pydantic import Field

from src.core.schema import CamelModel

MAX_ROWS = 2000


class ImportRow(CamelModel):
    """One spreadsheet row after the user mapped columns to CRM fields."""

    company_name: str | None = None
    contact_name: str | None = None
    phone: str | None = None
    email: str | None = None
    source: str | None = None
    designation: str | None = None
    city: str | None = None
    value_band: str | None = None
    notes: str | None = None


class ImportRequest(CamelModel):
    rows: list[ImportRow] = Field(max_length=MAX_ROWS)
    owner_id: str | None = None


class CommitRequest(ImportRequest):
    on_duplicate: Literal["skip", "merge"] = "skip"
