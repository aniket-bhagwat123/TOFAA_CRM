import logging
from datetime import datetime

from src.core import app_settings
from src.core.dates import IST, now_ist
from src.core.errors import AppError
from src.core.keys import normalize_phone10, phone_key
from src.core.parallel import par
from src.core.supabase import get_service_client
from src.core.timeline import add_activity
from src.modules.activities.schemas import CallLog, CallOutcome
from src.modules.auth.schemas import Profile
from src.modules.leads import service as leads
from src.modules.leads.schemas import StageMove
from src.modules.leads.stages import CLOSED
from src.modules.meetings import service as meetings
from src.modules.tasks import service as tasks

log = logging.getLogger(__name__)

O = CallOutcome
# A next call / follow-up date is required for these (the lead stays open and someone must come back to it).
NEEDS_DATE = {O.NOT_REACHABLE, O.CALL_BACK_LATER, O.FUTURE_REQUIREMENT}
# These move a New Lead to Connected ("Interested" then goes on to Meeting Scheduled with its meeting).
ADVANCES = {O.FUTURE_REQUIREMENT, O.INTERESTED}
# Tags that belong to an outcome: the lead carries them only while its latest call is that outcome.
TAGS = {O.FUTURE_REQUIREMENT: {"nurture"}}
OUTCOME_TAGS = set().union(*TAGS.values())
# The task each outcome leaves behind (title, kind).
TASK = {O.NOT_REACHABLE: ("Call again", "call"), O.CALL_BACK_LATER: ("Call back (client requested)", "call")}
INVALID_CONTACT = "Invalid contact"


def check(body: CallLog, open_lead: bool) -> list[dict]:
    """Field problems for this outcome, before anything is written."""
    if not open_lead:
        return []  # a call on a closed lead is only recorded
    errors = []
    if body.outcome in NEEDS_DATE and not body.next_follow_up:
        errors.append({"field": "nextFollowUp", "message": "Pick the next follow-up date."})
    if body.outcome == O.INTERESTED and not body.meeting:
        errors.append({"field": "meeting", "message": "Pick the meeting date and time."})
    if body.outcome == O.NOT_INTERESTED:
        if not body.lost_reason:
            errors.append({"field": "lostReason", "message": "Pick a reason."})
        elif body.lost_reason not in app_settings.lost_reasons():
            errors.append({"field": "lostReason", "message": "Pick a reason from the list."})
    if body.outcome == O.WRONG_CONTACT and (body.new_name or "").strip() and not (body.new_phone or "").strip():
        errors.append({"field": "newPhone", "message": "Enter the new number for this person"})
    return errors


def lead_patch(lead: dict, outcome: CallOutcome, swapped: bool, open_lead: bool) -> dict:
    """What the call changes on the lead row: the call status, the attempt count and tags."""
    patch: dict = {"last_call_outcome": None if swapped else outcome.value, "last_call_at": None if swapped else now_ist().isoformat()}
    if outcome == O.NOT_REACHABLE:
        patch["call_attempts"] = int(lead.get("call_attempts") or 0) + 1
    # Swap the outcome tags for this outcome's (none for most): Nurture stays only while the status is Future requirement.
    current = set(lead.get("tags") or [])
    wanted = (current - OUTCOME_TAGS) | (TAGS.get(outcome, set()) if open_lead and not swapped else set())
    if wanted != current:
        patch["tags"] = sorted(wanted)
    return patch


def log_call(user: Profile, lead_id: str, body: CallLog) -> dict:
    """The call sheet: what happened, a note, the next date, and what that outcome does to the lead. One request."""
    lead = leads.get_lead_row(user, lead_id)
    open_lead = lead["stage"] not in CLOSED
    o = body.outcome
    errors = check(body, open_lead)
    if errors:
        raise AppError("Some details are missing.", {"errors": errors}, 422)

    wrong = o == O.WRONG_CONTACT
    swapped = _switch_number(lead, body) if wrong and (body.new_phone or "").strip() else None
    meta = {"newPhone": swapped[0], "oldPhone": swapped[1], "newName": swapped[2], "oldName": swapped[3]} if swapped else {}
    note = body.note
    if swapped:
        change = f"Number changed to {swapped[0]}" + (f" (old {swapped[1]} kept as second number)" if swapped[1] else "")
        if swapped[2]:
            change += f". Contact changed to {swapped[2]}" + (f" (was {swapped[3]})" if swapped[3] else "")
        note = f"{change}. {note}" if note else change
    patch = lead_patch(lead, o, bool(swapped), open_lead)
    if "call_attempts" in patch:
        meta["attempt"] = patch["call_attempts"]

    # What closes the lead: "Not interested", or a wrong contact with no new one given.
    close_reason = (body.lost_reason if o == O.NOT_INTERESTED else INVALID_CONTACT if wrong and not swapped else None) if open_lead else None

    steps = [
        lambda: add_activity(lead_id, user.id, "call", outcome=o.value, note=note, meta=meta or None),
        lambda: _update_lead(lead_id, patch),
    ]
    if open_lead and not close_reason and o != O.INTERESTED:  # closing clears the tasks; a meeting sets its own
        if body.next_follow_up:
            title, kind = TASK.get(o, (None, "follow_up"))
            due_at = datetime.combine(body.next_follow_up, body.next_follow_up_time, tzinfo=IST) if body.next_follow_up_time else None
            steps.append(lambda: tasks.set_next_action(
                lead_id, lead["owner_id"], body.next_follow_up, title, kind=kind, due_at=due_at, client_requested=o == O.CALL_BACK_LATER,
            ))
        else:
            steps.append(lambda: tasks.close_open_tasks(lead_id, o.value))
    status_saved = par(*steps)[1]

    if open_lead:
        # In order: Connected first, so the meeting then carries the lead on to Meeting Scheduled.
        if o in ADVANCES:
            leads.auto_advance(lead, "connected", user.id, f"Call: {o.value.replace('_', ' ')}")
        if o == O.INTERESTED and body.meeting:
            meetings.create_meeting(user, lead_id, body.meeting)
        if close_reason:
            leads.move_stage(user, lead_id, StageMove(stage="closed_lost", lost_reason=close_reason))
    if body.task_id:  # last: the steps above close open tasks as "superseded" / "closed"
        tasks.finish_task(lead_id, body.task_id, o.value)

    stage = leads.get_lead_row(user, lead_id)["stage"] if open_lead else lead["stage"]
    return {
        "leadId": lead_id,
        "stage": stage,
        "closed": bool(close_reason),
        # False when the database could not take this status yet (migration 20260112000000_call_outcomes_v2.sql).
        "statusSaved": status_saved,
        "attempts": patch.get("call_attempts"),
        "suggestMarkLost": False,  # closing is now part of the outcome itself
        "phone": swapped[0] if swapped else None,
        "altPhone": swapped[1] if swapped else None,
        "name": swapped[2] if swapped else None,
    }


def _update_lead(lead_id: str, patch: dict) -> bool:
    """Save the call status (and attempts / tags). Before migration 20260112000000_call_outcomes_v2.sql the new
    columns and outcome names are refused: keep what can be saved, never fail the call, and say whether it worked."""
    db = get_service_client()
    try:
        db.table("leads").update(patch).eq("id", lead_id).execute()
        return True
    except Exception:  # noqa: BLE001
        log.warning("could not save the call status on the lead (is migration 20260112000000_call_outcomes_v2.sql applied?)", exc_info=True)
        basic = {k: v for k, v in patch.items() if k in ("last_call_outcome", "last_call_at")}
        try:
            db.table("leads").update(basic).eq("id", lead_id).execute()
        except Exception:  # noqa: BLE001
            log.warning("could not save the last call outcome either", exc_info=True)
            return False
        return False  # the status went in, the attempt count / tags did not


ALT_NOT_READY = "Saving a second phone number is not set up yet. An admin needs to apply the database migration 20260108000000_contact_alt_phone.sql, then try again."


def _switch_number(lead: dict, body: CallLog) -> tuple[str, str | None, str | None, str | None]:
    """Make the new number the contact's main phone and keep the old one as the second number; with a full
    name, the contact becomes that person. Returns (new phone, old phone, new name, old name).
    Done before anything else is written, so a bad number stops the whole save."""
    new = normalize_phone10(body.new_phone)
    if not new:
        raise AppError("Enter a 10-digit mobile number.", {"errors": [{"field": "newPhone", "message": "Enter a 10-digit mobile number"}]}, 422)
    contact = lead.get("contact") or {}
    old = contact.get("phone")
    if phone_key(old) == phone_key(new):
        raise AppError("That is the number already saved.", {"errors": [{"field": "newPhone", "message": "This is the current number"}]}, 422)
    patch = {"phone": new, "phone_key": phone_key(new), "alt_phone": old or contact.get("alt_phone"), "alt_phone_key": phone_key(old) or contact.get("alt_phone_key")}
    name = " ".join((body.new_name or "").split())
    old_name = contact.get("name")
    if name and name != old_name:
        patch["name"] = name
    else:
        name = None
    if old:
        patch["alt_name"] = old_name  # whose the second number is
    db = get_service_client()
    try:
        db.table("contacts").update(patch).eq("id", lead["contact_id"]).execute()
    except Exception as exc:
        text = str(exc)
        if "alt_name" in text and "alt_phone" not in text:
            # Before migration 20260109000000_contact_alt_name.sql: save the rest; the old name stays in the call history.
            log.warning("contacts.alt_name missing: second number saved without its name")
            db.table("contacts").update({k: v for k, v in patch.items() if k != "alt_name"}).eq("id", lead["contact_id"]).execute()
        elif "alt_phone" in text:
            raise AppError(ALT_NOT_READY, status_code=503) from exc
        else:
            raise
    return new, patch["alt_phone"], name, old_name if name else None


def add_note(user: Profile, lead_id: str, note: str) -> dict:
    leads.get_lead_row(user, lead_id)
    return add_activity(lead_id, user.id, "note", note=note)
