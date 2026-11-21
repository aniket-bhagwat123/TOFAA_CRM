from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator

from src.core.schema import CamelModel


class MeetingCreate(CamelModel):
    starts_at: datetime
    kind: Literal["physical", "online"]
    location: str | None = Field(default=None, max_length=300)
    link: str | None = Field(default=None, max_length=500)
    remind_client: bool = False

    @field_validator("starts_at")
    @classmethod
    def _tz(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("Send the time with a timezone offset.")
        return v


class MeetingUpdate(CamelModel):
    starts_at: datetime | None = None
    status: Literal["scheduled", "done", "cancelled"] | None = None
    location: str | None = None
    link: str | None = None
