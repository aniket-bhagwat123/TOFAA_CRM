from datetime import date, time
from enum import StrEnum

from pydantic import Field

from src.core.schema import CamelModel
from src.modules.meetings.schemas import MeetingCreate


class CallOutcome(StrEnum):
    NOT_REACHABLE = "not_reachable"                          # stays; attempt count +1; next call date
    CALL_BACK_LATER = "call_back_later"                      # stays; dated follow-up, client requested
    FUTURE_REQUIREMENT = "future_requirement"                # New Lead -> Connected; tagged Nurture
    INTERESTED = "interested"                                # -> Connected -> Meeting Scheduled (with a meeting)
    NOT_INTERESTED = "not_interested"                        # -> Closed Lost, with a reason
    WRONG_CONTACT = "wrong_contact"                          # -> Closed Lost (Invalid contact), unless a new contact is given


class CallLog(CamelModel):
    outcome: CallOutcome
    note: str | None = Field(default=None, max_length=4000)
    next_follow_up: date | None = None
    next_follow_up_time: time | None = None  # optional: the time the client asked to be called back
    task_id: str | None = None  # logged from a follow-up card: that follow-up is finished with this outcome
    # Only with "Wrong number": the right number. It becomes the main phone; the old one is kept as the second number.
    new_phone: str | None = Field(default=None, max_length=20)
    new_name: str | None = Field(default=None, max_length=120)  # the right person's full name, with the new number
    meeting: MeetingCreate | None = None  # only with "Interested": the meeting to schedule
    lost_reason: str | None = Field(default=None, max_length=60)  # only with "Not interested"


class NoteCreate(CamelModel):
    note: str = Field(min_length=1, max_length=4000)
