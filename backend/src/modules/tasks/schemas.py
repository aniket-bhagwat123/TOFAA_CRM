from datetime import date, datetime
from typing import Literal

from pydantic import Field

from src.core.schema import CamelModel


class TaskCreate(CamelModel):
    lead_id: str
    due_date: date
    title: str | None = Field(default=None, max_length=200)
    kind: Literal["follow_up", "call", "whatsapp", "other"] = "follow_up"
    due_at: datetime | None = None  # the "+" button asks for a time


class TaskComplete(CamelModel):
    next_follow_up: date | None = None
    outcome: str | None = Field(default=None, max_length=200)


class TaskSnooze(CamelModel):
    due_date: date
    due_at: datetime | None = None  # "In 2 hrs": the exact time; the other chips move only the day
    note: str | None = Field(default=None, max_length=500)  # required when the client asked for the callback
    reason: Literal["snooze", "reschedule"] = "snooze"  # reschedule: dragged to another column
    exact: bool = False  # the person picked this date and time: keep it, working hours or not
