from src.core.errors import AppError
from src.core.parallel import par
from src.core.timeline import add_activity
from src.modules.activities.schemas import CallLog, CallOutcome
from src.modules.auth.schemas import Profile
from src.modules.leads import service as leads
from src.modules.leads.stages import CLOSED
from src.modules.tasks import service as tasks

NEEDS_DATE = {CallOutcome.CONNECTED, CallOutcome.NO_ANSWER, CallOutcome.CALL_BACK_LATER}
ADVANCES = {CallOutcome.CONNECTED, CallOutcome.CALL_BACK_LATER}  # a person actually picked up


def log_call(user: Profile, lead_id: str, body: CallLog) -> dict:
    """The quick-log sheet: outcome, optional note, next follow-up date. One request does it all."""
    lead = leads.get_lead_row(user, lead_id)
    open_lead = lead["stage"] not in CLOSED
    if open_lead and body.outcome in NEEDS_DATE and not body.next_follow_up:
        raise AppError(
            "Pick the next follow-up date.", {"errors": [{"field": "nextFollowUp", "message": "Required"}]}, 422
        )

    # Timeline entry, the next task and the stage move are independent: they share one round trip.
    steps = [lambda: add_activity(lead_id, user.id, "call", outcome=body.outcome.value, note=body.note)]
    if open_lead:
        if body.next_follow_up:
            steps.append(lambda: tasks.set_next_action(lead_id, lead["owner_id"], body.next_follow_up))
        else:  # not interested / wrong number with no date: close the task, lead shows as "no next action"
            steps.append(lambda: tasks.close_open_tasks(lead_id, body.outcome.value))
        if body.outcome in ADVANCES:
            steps.append(lambda: leads.auto_advance(lead, "connected", user.id, "Call connected"))
    par(*steps)
    return {
        "leadId": lead_id,
        "stage": lead["stage"],
        "suggestMarkLost": body.outcome in {CallOutcome.NOT_INTERESTED, CallOutcome.WRONG_NUMBER},
    }


def add_note(user: Profile, lead_id: str, note: str) -> dict:
    leads.get_lead_row(user, lead_id)
    return add_activity(lead_id, user.id, "note", note=note)
