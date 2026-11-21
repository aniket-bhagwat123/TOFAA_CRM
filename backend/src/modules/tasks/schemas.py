from datetime import date

from pydantic import Field

from src.core.schema import CamelModel


class TaskCreate(CamelModel):
    lead_id: str
    due_date: date
    title: str | None = Field(default=None, max_length=200)


class TaskComplete(CamelModel):
    next_follow_up: date | None = None
    outcome: str | None = Field(default=None, max_length=200)
