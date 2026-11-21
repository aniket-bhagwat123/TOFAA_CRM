"""Everything is a dated task. A lead with no open task shows up as 'no next action'."""
from datetime import date, datetime, time, timedelta
from uuid import uuid4

from src.core import cache
from src.core.access import can_access_owner, require_lead_role
from src.core.dates import IST, now_ist, today_ist
from src.core.errors import AppError, ForbiddenError, NotFoundError
from src.core.parallel import par
from src.core.supabase import get_service_client
from src.core.timeline import add_activity
from src.modules.auth.schemas import Profile
from src.modules.leads.stages import CLOSED

TASK_SELECT = (
    "*, lead:leads(id,stage,pipeline,project_title,company:companies(name),contact:contacts(name,phone,email)),"
    " company:companies(id,name,contacts(name,phone,email))"  # client follow-ups have a company and no deal
)
LEAD_BRIEF = "id,stage,pipeline,project_title,next_follow_up,owner_id,company:companies(name),contact:contacts(name,phone,email)"
VIEW_TTL = 20  # seconds, and any write by anyone on this server clears it at once


def _flatten_task(row: dict) -> dict:
    lead = row.pop("lead", None) or {}
    company = row.pop("company", None) or {}
    if lead:  # a deal (lead or client project)
        contact = lead.get("contact") or {}
        row["lead_id"] = row.get("lead_id") or lead.get("id")
        row["stage"] = lead.get("stage")
        row["pipeline"] = lead.get("pipeline") or "new_business"
        row["project_title"] = lead.get("project_title")
        row["company_name"] = (lead.get("company") or {}).get("name")
    else:  # a client follow-up (occasion call, check-in): reach the first contact
        contact = (company.get("contacts") or [{}])[0]
        row["stage"] = None
        row["pipeline"] = "client"
        row["company_name"] = company.get("name")
    row["is_client_task"] = not lead
    row["contact_name"] = contact.get("name")
    row["phone"] = contact.get("phone")
    row["email"] = contact.get("email")
    return row



def set_next_action(
    lead_id: str, owner_id: str | None, due: date, title: str | None = None, kind: str = "follow_up", keep: tuple[str, ...] = ()
) -> dict:
    """Replace the lead's open follow-up with a new dated one and keep leads.next_follow_up in sync.

    One round trip: the new task gets its id up front, so closing the old ones can say "everything
    except this one" while the insert and the lead update run alongside.
    """
    db = get_service_client()
    task_id = str(uuid4())
    row = {"id": task_id, "lead_id": lead_id, "owner_id": owner_id, "kind": kind, "title": title, "due_date": due.isoformat()}
    _, task, _ = par(
        lambda: db.table("tasks").update({"done_at": now_ist().isoformat(), "outcome": "superseded"})
        .eq("lead_id", lead_id).not_.in_("id", [task_id, *keep]).is_("done_at", "null").execute(),
        lambda: db.table("tasks").insert(row).execute().data[0],
        lambda: db.table("leads").update({"next_follow_up": due.isoformat()}).eq("id", lead_id).execute(),
    )
    return task


def close_open_tasks(lead_id: str, outcome: str) -> None:
    db = get_service_client()
    par(
        lambda: db.table("tasks").update({"done_at": now_ist().isoformat(), "outcome": outcome}).eq("lead_id", lead_id).is_("done_at", "null").execute(),
        lambda: db.table("leads").update({"next_follow_up": None}).eq("id", lead_id).execute(),
    )


def complete_task(user: Profile, task_id: str, nxt: date | None, outcome: str | None) -> dict:
    db = get_service_client()
    rows = db.table("tasks").select("*, lead:leads(id,owner_id,stage)").eq("id", task_id).limit(1).execute().data
    if not rows:
        raise NotFoundError("Task not found.")
    task = rows[0]
    lead = task.pop("lead")
    if not lead:
        raise AppError("This is a client follow-up. Finish it from the client card or the Today screen.", status_code=409)
    if not can_access_owner(user, task.get("owner_id")):
        raise ForbiddenError()
    if task.get("done_at"):
        raise AppError("This task is already done.")
    if lead["stage"] not in CLOSED and not nxt:
        raise AppError("Pick the next follow-up date.", {"errors": [{"field": "nextFollowUp", "message": "Required"}]}, 422)
    steps = [
        lambda: db.table("tasks").update({"done_at": now_ist().isoformat(), "outcome": outcome or "done"}).eq("id", task_id).execute(),
        lambda: add_activity(lead["id"], user.id, "task", outcome=outcome or "done", note=task.get("title") or "Follow-up completed"),
    ]
    if nxt and lead["stage"] not in CLOSED:
        steps.append(lambda: set_next_action(lead["id"], lead["owner_id"], nxt, keep=(task_id,)))
    par(*steps)
    return {"id": task_id, "done": True}


def create_task(user: Profile, lead_id: str, due: date, title: str | None) -> dict:
    from src.modules.leads import service as leads

    lead = leads.get_lead_row(user, lead_id)
    if lead["stage"] in CLOSED:
        raise AppError("This lead is closed.")
    return set_next_action(lead_id, lead["owner_id"], due, title)


def today_view(user: Profile) -> dict:
    """Calls and follow-ups due, overdue, meetings today, and leads with no next action (in that order)."""
    require_lead_role(user)
    return cache.memo("today", user.id, None, VIEW_TTL, lambda: _build_today(user))


def _build_today(user: Profile) -> dict:
    from src.modules.clients.service import ensure_occasion_reminders  # local: clients imports tasks

    ensure_occasion_reminders(user)  # occasion calls due soon become dated tasks before we read them
    db = get_service_client()
    today = today_ist()
    start = datetime.combine(today, time.min, tzinfo=IST)

    # Three independent reads, one round trip.
    open_tasks, meetings, no_action = par(
        lambda: db.table("tasks").select(TASK_SELECT).eq("owner_id", user.id).is_("done_at", "null")
        .lte("due_date", today.isoformat()).order("due_date").execute().data,
        lambda: db.table("meetings")
        .select("*, lead:leads(id,company:companies(name),contact:contacts(name,phone))")
        .eq("owner_id", user.id).eq("status", "scheduled")
        .gte("starts_at", start.isoformat()).lt("starts_at", (start + timedelta(days=1)).isoformat())
        .order("starts_at").execute().data,
        lambda: leads_without_next_action(user),
    )

    open_tasks = [_flatten_task(t) for t in open_tasks if (t.get("lead") or {}).get("stage") not in CLOSED]
    # Meeting tasks due today are shown in the meetings section instead.
    due_today = [t for t in open_tasks if t["due_date"] == today.isoformat() and t["kind"] != "meeting"]
    overdue = [t for t in open_tasks if t["due_date"] < today.isoformat()]
    for m in meetings:
        lead = m.pop("lead", None) or {}
        m["company_name"] = (lead.get("company") or {}).get("name")
        m["contact_name"] = (lead.get("contact") or {}).get("name")
        m["phone"] = (lead.get("contact") or {}).get("phone")

    return {
        "date": today.isoformat(),
        "dueToday": due_today,
        "overdue": overdue,
        "meetings": meetings,
        "noNextAction": no_action,
        "counts": {"dueToday": len(due_today), "overdue": len(overdue), "meetings": len(meetings)},
    }


def leads_without_next_action(user: Profile) -> list[dict]:
    rows = (
        get_service_client().table("leads").select(LEAD_BRIEF).eq("owner_id", user.id).is_("next_follow_up", "null")
        .not_.in_("stage", list(CLOSED)).order("created_at").limit(100).execute().data
    )
    return [
        {
            "leadId": r["id"], "stage": r["stage"], "pipeline": r.get("pipeline") or "new_business", "projectTitle": r.get("project_title"),
            "companyName": (r.get("company") or {}).get("name"),
            "contactName": (r.get("contact") or {}).get("name"),
            "phone": (r.get("contact") or {}).get("phone"),
        }
        for r in rows
    ]


def end_of_day(user: Profile) -> dict:
    """The ~1 minute check: incomplete tasks and deals with no next action, to reschedule or close."""
    view = today_view(user)  # same cached result as the Today screen
    return {"incomplete": [*view["overdue"], *view["dueToday"]], "noNextAction": view["noNextAction"]}


# --- follow-ups board -----------------------------------------------------------------------------------

BUCKETS = ("overdue", "today", "tomorrow", "this_week")
WEEK_DAYS = 7  # "This week" is the rest of the next seven days


def bucket_for(due: date, today: date, starts_at: datetime | None = None, now: datetime | None = None) -> str | None:
    """Which column a follow-up belongs in. A meeting earlier today that is still open counts as missed."""
    if due < today or (starts_at and now and due == today and starts_at < now):
        return "overdue"
    if due == today:
        return "today"
    if due == today + timedelta(days=1):
        return "tomorrow"
    if due <= today + timedelta(days=WEEK_DAYS):
        return "this_week"
    return None


def follow_ups(user: Profile, owner_id: str | None = None) -> dict:
    """Every open follow-up up to a week ahead, in four columns: overdue or missed, today, tomorrow, this week."""
    from src.core.access import visible_owner_ids

    ids = visible_owner_ids(user)
    if owner_id:
        if ids is not None and owner_id not in ids:
            raise ForbiddenError()
        ids = [owner_id]
    return cache.memo("follow_ups", user.id, owner_id, VIEW_TTL, lambda: _build_follow_ups(ids))


def _build_follow_ups(owner_ids: list[str] | None) -> dict:
    db = get_service_client()
    today = today_ist()
    now = now_ist()
    q = db.table("tasks").select(TASK_SELECT).is_("done_at", "null").lte("due_date", (today + timedelta(days=WEEK_DAYS)).isoformat())
    if owner_ids is not None:
        q = q.in_("owner_id", owner_ids or ["00000000-0000-0000-0000-000000000000"])
    rows = q.order("due_date").limit(1000).execute().data
    rows = [r for r in rows if (r.get("lead") or {}).get("stage") not in CLOSED]

    # Meeting follow-ups carry the meeting's time, so the card can say "Meeting · 3:30 PM".
    meeting_leads = list({r["lead_id"] for r in rows if r.get("kind") == "meeting" and r.get("lead_id")})
    starts: dict[str, dict] = {}
    if meeting_leads:
        meetings = (
            db.table("meetings").select("id,lead_id,starts_at,kind,location,link").in_("lead_id", meeting_leads)
            .eq("status", "scheduled").order("starts_at").execute().data
        )
        for m in meetings:
            starts.setdefault(m["lead_id"], m)

    out: dict[str, list] = {b: [] for b in BUCKETS}
    for r in rows:
        t = _flatten_task(r)
        meeting = starts.get(t["lead_id"]) if t.get("kind") == "meeting" else None
        when = datetime.fromisoformat(meeting["starts_at"]).astimezone(IST) if meeting else None
        if meeting:
            t["meeting"] = {"id": meeting["id"], "starts_at": meeting["starts_at"], "kind": meeting["kind"], "location": meeting.get("location"), "link": meeting.get("link")}
        due = when.date() if when else date.fromisoformat(t["due_date"])
        b = bucket_for(due, today, when, now)
        if b:
            out[b].append(t)
    for items in out.values():
        items.sort(key=lambda t: ((t.get("meeting") or {}).get("starts_at") or t["due_date"] + "T23:59"))
    return {
        "date": today.isoformat(),
        "overdue": out["overdue"], "today": out["today"], "tomorrow": out["tomorrow"], "thisWeek": out["this_week"],
    }
