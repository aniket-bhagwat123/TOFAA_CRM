from typing import Literal

from pydantic import Field

from src.core.schema import CamelModel


class SendMessage(CamelModel):
    body: str = Field(min_length=1, max_length=4000)
    template: str | None = Field(default=None, max_length=100)  # approved template name (API mode only)


class TemplateCreate(CamelModel):
    name: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9_]+$")
    purpose: Literal["first_contact", "meeting_reminder", "follow_up", "quotation_sent", "payment_reminder", "other"]
    body: str = Field(min_length=1, max_length=1024)
    approved: bool = False


class TemplateUpdate(CamelModel):
    approved: bool | None = None
    body: str | None = Field(default=None, min_length=1, max_length=1024)
