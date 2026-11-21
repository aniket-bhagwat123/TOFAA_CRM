from datetime import date
from enum import StrEnum

from pydantic import Field

from src.core.schema import CamelModel


class CallOutcome(StrEnum):
    CONNECTED = "connected"
    NO_ANSWER = "no_answer"
    CALL_BACK_LATER = "call_back_later"
    NOT_INTERESTED = "not_interested"
    WRONG_NUMBER = "wrong_number"


class CallLog(CamelModel):
    outcome: CallOutcome
    note: str | None = Field(default=None, max_length=4000)
    next_follow_up: date | None = None


class NoteCreate(CamelModel):
    note: str = Field(min_length=1, max_length=4000)
