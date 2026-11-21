from datetime import timedelta

from src.core import cache
from src.core.access import require_lead_role, visible_owner_ids
from src.core.audit import write_audit
from src.core.dates import IST, now_ist
from src.core.errors import AppError, ForbiddenError, NotFoundError
from src.core.parallel import par
from src.core.supabase import get_service_client
from src.core.timeline import add_activity
from src.modules.auth.schemas import Profile
from src.modules.leads import service as leads
from src.modules.leads.stages import CLOSED
from src.modules.meetings.schemas import MeetingCreate, MeetingUpdate
from src.modules.tasks import service as tasks


def create_meeting(user: Profile, lead_id: str, body: MeetingCreate) -> dict:
    lead = leads.get_lead_row(user, lead_id)
    if lead["stage"] in CLOSED:
        raise AppError("This lead is closed.")
    row = (
        get_service_client().table("meetings")
        .insert(
            {
                "lead_id": lead_id, "owner_id": lead["owner_id"], "starts_at": body.starts_at.isoformat(),
                "kind": body.kind, "location": body.location, "link": body.link, "remind_client": body.remind_client,
            }
        )
        .execute().data[0]
    )
    when = body.starts_at.astimezone(IST)
    # Timeline, stage move and the meeting day as the next action: one round trip together.
    par(
        lambda: add_activity(
            lead_id, user.id, "meeting", outcome="scheduled",
            note=f"{body.kind.capitalize()} meeting on {when:%d %b %Y, %I:%M %p}", meta={"meetingId": row["id"]},
        ),
        lambda: leads.auto_advance(lead, "meeting_scheduled", user.id, "Meeting created"),
        lambda: tasks.set_next_action(lead_id, lead["owner_id"], when.date(), "Meeting", kind="meeting"),
    )
    return row


def _get_meeting(user: Profile, meeting_id: str) -> dict:
    require_lead_role(user)
    rows = get_service_client().table("meetings").select("*").eq("id", meeting_id).limit(1).execute().data
    if not rows:
        raise NotFoundError("Meeting not found.")
    visible = visible_owner_ids(user)
    if visible is not None and rows[0]["owner_id"] not in visible:
        raise ForbiddenError()
    return rows[0]


def update_meeting(user: Profile, meeting_id: str, body: MeetingUpdate) -> dict:
    meeting = _get_meeting(user, meeting_id)
    patch = body.model_dump(exclude_none=True)
    if "starts_at" in patch:
        patch["starts_at"] = body.starts_at.isoformat()
    if not patch:
        raise AppError("Nothing to update.")
    db = get_service_client()
    label = body.status or "rescheduled"
    needs_next_action = body.status in ("done", "cancelled") and meeting["status"] == "scheduled"

    row, lead_rows, _ = par(
        lambda: db.table("meetings").update(patch).eq("id", meeting_id).execute().data[0],
        lambda: db.table("leads").select("id,owner_id,stage").eq("id", meeting["lead_id"]).execute().data if needs_next_action else [],
        lambda: add_activity(meeting["lead_id"], user.id, "meeting", outcome=label, note=f"Meeting {label}"),
    )
    write_audit(user.id, "update", "meetings", meeting_id, patch)
    if needs_next_action and lead_rows and lead_rows[0]["stage"] not in CLOSED:
        # The meeting no longer drives the next action: make sure the lead still has one.
        tasks.set_next_action(lead_rows[0]["id"], lead_rows[0]["owner_id"], (now_ist() + timedelta(days=1)).date(), "Follow up after meeting")
    return row


def list_upcoming(user: Profile, days: int = 14) -> list[dict]:
    require_lead_role(user)
    return cache.memo("meetings", user.id, days, 20, lambda: _upcoming(user, days))


def _upcoming(user: Profile, days: int) -> list[dict]:
    owners = visible_owner_ids(user)
    q = (
        get_service_client().table("meetings")
        .select("*, lead:leads(id,company:companies(name),contact:contacts(name)), owner:profiles!owner_id(full_name)")
        .eq("status", "scheduled")
        .gte("starts_at", now_ist().isoformat()).lte("starts_at", (now_ist() + timedelta(days=days)).isoformat())
    )
    if owners is not None:
        q = q.in_("owner_id", owners)
    rows = q.order("starts_at").limit(200).execute().data
    for m in rows:
        lead = m.pop("lead", None) or {}
        m["lead_id"] = lead.get("id")
        m["company_name"] = (lead.get("company") or {}).get("name")
        m["contact_name"] = (lead.get("contact") or {}).get("name")
    return rows
