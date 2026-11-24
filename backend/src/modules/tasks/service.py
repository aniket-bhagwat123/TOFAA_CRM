"""Everything is a dated task. A lead with no open task shows up as 'no next action'."""
from datetime import date, datetime, time, timedelta
from uuid import uuid4

from src.core import app_settings, cache
from src.core.access import can_access_owner, require_lead_role
from src.core.dates import IST, now_ist, today_ist
from src.core.errors import AppError, ForbiddenError, NotFoundError
from src.core.parallel import par
from src.core.supabase import get_service_client
from src.core.timeline import add_activity
from src.core.working_hours import schedule
from src.core.storage import AVATARS, signed_urls
from src.modules.auth.schemas import Profile
from src.modules.leads.value import deal_value
from src.modules.leads.stages import CLOSED

TASK_SELECT = (
    "*, lead:leads(id,stage,pipeline,project_title,company:companies(name),contact:contacts(name,phone,email)),"
    " company:companies(id,name,contacts(name,phone,email))"  # client follow-ups have a company and no deal
)
# The follow-ups board also shows who owns it and the lead's info line: attempts, Warm / Cold, Nurture, value.
BOARD_SELECT = (
    "*, lead:leads(id,stage,pipeline,project_title,call_attempts,last_call_outcome,tags,value_band,estimate_amount,quote_amount,paid_amount,"
    "company:companies(name,kind),contact:contacts(name,phone,email)),"
    " company:companies(id,name,kind,contacts(name,phone,email)), owner:profiles(id,full_name,avatar_path)"
)
LEAD_BRIEF = "id,stage,pipeline,project_title,next_follow_up,owner_id,company:companies(name),contact:contacts(name,phone,email)"
NO_ACTION_BRIEF = LEAD_BRIEF.replace("company:companies(name)", "company:companies(name,kind)") + ",owner:profiles!owner_id(full_name)"
VIEW_TTL = 20  # seconds, and any write by anyone on this server clears it at once


def _flatten_task(row: dict, max_attempts: int = 5) -> dict:
    lead = row.pop("lead", None) or {}
    company = row.pop("company", None) or {}
    owner = row.pop("owner", None) or {}
    if owner:
        row["owner_name"] = owner.get("full_name")
        row["owner_avatar_path"] = owner.get("avatar_path")
    if lead and "call_attempts" in lead:  # the board's info line
        attempts = int(lead.get("call_attempts") or 0)
        cold = lead.get("last_call_outcome") == "not_reachable" and attempts >= max_attempts
        row["call_attempts"] = attempts
        row["max_attempts"] = max_attempts
        row["temperature"] = "cold" if cold else "warm"
        row["nurture"] = "nurture" in (lead.get("tags") or [])
        row["deal_value"] = deal_value(lead)
    if lead:  # a deal (lead or client project)
        contact = lead.get("contact") or {}
        row["lead_id"] = row.get("lead_id") or lead.get("id")
        row["stage"] = lead.get("stage")
        row["pipeline"] = lead.get("pipeline") or "new_business"
        row["project_title"] = lead.get("project_title")
        row["company_name"] = (lead.get("company") or {}).get("name")
        row["company_kind"] = (lead.get("company") or {}).get("kind")
    else:  # a client follow-up (occasion call, check-in): reach the first contact
        contact = (company.get("contacts") or [{}])[0]
        row["stage"] = None
        row["pipeline"] = "client"
        row["company_name"] = company.get("name")
        row["company_kind"] = company.get("kind")  # Direct or OS, shown instead of a stage
    row["is_client_task"] = not lead
    row["client_requested"] = is_client_requested(row)
    row["snooze_count"] = int(row.get("snooze_count") or 0)
    row["contact_name"] = contact.get("name")
    row["phone"] = contact.get("phone")
    row["email"] = contact.get("email")
    return row



def is_client_requested(task: dict) -> bool:
    """The client asked for this callback. Tasks made before migration 20260117000000 carry it only in the title."""
    return bool(task.get("client_requested")) or "client requested" in (task.get("title") or "").lower()


def set_next_action(
    lead_id: str, owner_id: str | None, due: date, title: str | None = None, kind: str = "follow_up", keep: tuple[str, ...] = (),
    due_at: datetime | None = None, client_requested: bool = False,
) -> dict:
    """Replace the lead's open follow-up with a new dated one and keep leads.next_follow_up in sync.

    One round trip: the new task gets its id up front, so closing the old ones can say "everything
    except this one" while the insert and the lead update run alongside.
    """
    db = get_service_client()
    due, due_at = schedule(due, due_at)  # never at night or on a day off: the next working morning instead
    task_id = str(uuid4())
    row = {"id": task_id, "lead_id": lead_id, "owner_id": owner_id, "kind": kind, "title": title, "due_date": due.isoformat()}
    # Only when set, so the insert still works on a database without migration 20260117000000_followup_snooze.sql.
    if due_at:
        row["due_at"] = due_at.isoformat()
    if client_requested:
        row["client_requested"] = True
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


# Outcomes that end the conversation: no next follow-up date is asked for.
NO_NEXT_DATE = {"not_interested", "wrong_contact", "won", "lost", "closed_won", "closed_lost"}


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
    outcome = (outcome or "").strip()
    if not outcome:
        raise AppError("Say what happened.", {"errors": [{"field": "outcome", "message": "Required"}]}, 422)
    if lead["stage"] not in CLOSED and outcome not in NO_NEXT_DATE and not nxt:
        raise AppError("Pick the next follow-up date.", {"errors": [{"field": "nextFollowUp", "message": "Required"}]}, 422)
    steps = [
        lambda: db.table("tasks").update({"done_at": now_ist().isoformat(), "outcome": outcome}).eq("id", task_id).execute(),
        lambda: add_activity(lead["id"], user.id, "task", outcome=outcome, note=task.get("title") or "Follow-up completed"),
    ]
    if nxt and lead["stage"] not in CLOSED:
        steps.append(lambda: set_next_action(lead["id"], lead["owner_id"], nxt, keep=(task_id,)))
    par(*steps)
    return {"id": task_id, "done": True}


def finish_task(lead_id: str, task_id: str, outcome: str) -> None:
    """Record what came of this follow-up (the call outcome logged from its card). Runs after the call has set the
    next follow-up, which closes the old one as "superseded"; this puts the real outcome on it."""
    get_service_client().table("tasks").update({"done_at": now_ist().isoformat(), "outcome": outcome}).eq("id", task_id).eq("lead_id", lead_id).execute()


# --- snooze -----------------------------------------------------------------------------------------------

REPEAT_LIMIT = 3  # snoozes before the follow-up is flagged "Repeatedly postponed" to the manager


def snooze_task(user: Profile, task_id: str, due: date, due_at: datetime | None, note: str | None, reason: str = "snooze") -> dict:
    """Push a follow-up to later (Snooze), or move it to another day (dragged to another column: "reschedule").
    A callback the client asked for needs a note. Every move to a later time counts; the third tells the manager."""
    from src.modules.notifications.service import notify  # local: keeps the import graph flat

    db = get_service_client()
    rows = db.table("tasks").select(TASK_SELECT).eq("id", task_id).limit(1).execute().data
    if not rows:
        raise NotFoundError("Follow-up not found.")
    task = rows[0]
    if not can_access_owner(user, task.get("owner_id")):
        raise ForbiddenError()
    if task.get("done_at"):
        raise AppError("This follow-up is already done.")
    note = (note or "").strip() or None
    errors = []
    if is_client_requested(task) and not note:
        errors.append({"field": "note", "message": "The client asked for this callback. Add a note on why it moves."})
    if due < today_ist():
        errors.append({"field": "dueDate", "message": "Pick today or a later date."})
    if errors:
        raise AppError("Some details are missing.", {"errors": errors}, 422)
    due, due_at = schedule(due, due_at)  # "In 2 hrs" late in the day lands on the next working morning

    old_at = task.get("due_at") or f"{task['due_date']}T23:59:59+05:30"
    new_at = due_at.isoformat() if due_at else f"{due.isoformat()}T23:59:59+05:30"
    later = datetime.fromisoformat(new_at) > datetime.fromisoformat(old_at)
    count = int(task.get("snooze_count") or 0) + (1 if later else 0)
    verb = "snoozed" if reason == "snooze" else "rescheduled"
    lead_id = task.get("lead_id")
    item = _flatten_task(dict(task))
    when = f"{due.strftime('%d %b')}" + (f", {due_at.astimezone(IST).strftime('%I:%M %p').lstrip('0')}" if due_at else "")
    steps = [lambda: db.table("tasks").update(
        {"due_date": due.isoformat(), "due_at": due_at.isoformat() if due_at else None, "snooze_count": count}
    ).eq("id", task_id).execute()]
    if lead_id:
        steps += [
            lambda: db.table("leads").update({"next_follow_up": due.isoformat()}).eq("id", lead_id).execute(),
            lambda: add_activity(lead_id, user.id, "task", outcome=verb, note=f"Follow-up {verb} to {when}" + (f". {note}" if note else "")),
        ]
    par(*steps)

    if later and count == REPEAT_LIMIT and task.get("owner_id"):
        owner = (db.table("profiles").select("full_name,manager_id").eq("id", task["owner_id"]).limit(1).execute().data or [{}])[0]
        if owner.get("manager_id"):
            notify(
                owner["manager_id"], f"postponed:{task_id}", "Repeatedly postponed",
                f"{owner.get('full_name') or 'A team member'} has snoozed the follow-up with {item.get('company_name') or 'a client'} {count} times.",
                "/follow-ups",
            )
    return {"id": task_id, "dueDate": due.isoformat(), "dueAt": due_at.isoformat() if due_at else None, "snoozeCount": count}


def create_task(user: Profile, lead_id: str, due: date, title: str | None, kind: str = "follow_up", due_at: datetime | None = None) -> dict:
    from src.modules.leads import service as leads

    lead = leads.get_lead_row(user, lead_id)
    if lead["stage"] in CLOSED:
        raise AppError("This lead is closed.")
    return set_next_action(lead_id, lead["owner_id"], due, title, kind=kind, due_at=due_at)


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


def leads_without_next_action(user: Profile, owner_ids: list[str] | None = None, with_owner: bool = False) -> list[dict]:
    """Open leads with no open task. Today screen: the user's own. Follow-ups board: everyone the viewer can see."""
    q = get_service_client().table("leads").select(NO_ACTION_BRIEF if with_owner else LEAD_BRIEF).is_("next_follow_up", "null").not_.in_("stage", list(CLOSED))
    if owner_ids is None and not with_owner:
        owner_ids = [user.id]
    if owner_ids is not None:
        q = q.in_("owner_id", owner_ids or ["00000000-0000-0000-0000-000000000000"])
    rows = q.order("created_at").limit(200 if with_owner else 100).execute().data
    return [
        {
            "leadId": r["id"], "stage": r["stage"], "pipeline": r.get("pipeline") or "new_business", "projectTitle": r.get("project_title"),
            "companyName": (r.get("company") or {}).get("name"),
            "contactName": (r.get("contact") or {}).get("name"),
            "phone": (r.get("contact") or {}).get("phone"),
            **({"ownerName": (r.get("owner") or {}).get("full_name"), "companyKind": (r.get("company") or {}).get("kind")} if with_owner else {}),
        }
        for r in rows
    ]


def end_of_day(user: Profile) -> dict:
    """The ~1 minute check: incomplete tasks and deals with no next action, to reschedule or close."""
    view = today_view(user)  # same cached result as the Today screen
    return {"incomplete": [*view["overdue"], *view["dueToday"]], "noNextAction": view["noNextAction"]}


# --- follow-ups board -----------------------------------------------------------------------------------

# Closed without being worked: replaced by a newer follow-up, or cancelled because the lead was won or lost.
NOT_DONE = ("superseded", "closed", "won", "cancelled")
BUCKETS = ("overdue", "today", "tomorrow", "later_this_week", "later")
WEEK_DAYS = 7  # "Later this week" is the rest of the next seven days; "Later" is beyond (Nurture touches and so on)


def bucket_for(due: date, today: date, starts_at: datetime | None = None, now: datetime | None = None) -> str:
    """Which column a follow-up belongs in. A meeting earlier today that is still open counts as missed."""
    if due < today or (starts_at and now and due == today and starts_at < now):
        return "overdue"
    if due == today:
        return "today"
    if due == today + timedelta(days=1):
        return "tomorrow"
    if due <= today + timedelta(days=WEEK_DAYS):
        return "later_this_week"
    return "later"


def follow_ups(user: Profile, owner_id: str | None = None) -> dict:
    """Every open follow-up up to a week ahead, in four columns: overdue or missed, today, tomorrow, this week."""
    from src.core.access import visible_owner_ids

    ids = visible_owner_ids(user)
    if owner_id:
        if ids is not None and owner_id not in ids:
            raise ForbiddenError()
        ids = [owner_id]
    return cache.memo("follow_ups", user.id, owner_id, VIEW_TTL, lambda: _build_follow_ups(ids, user))


def _sort_time(t: dict) -> str:
    at = (t.get("meeting") or {}).get("starts_at") or t.get("due_at")
    return datetime.fromisoformat(at).astimezone(IST).isoformat() if at else f"{t['due_date']}T23:59"


REMINDER_LOOKBACK = timedelta(hours=2)  # a reminder that came due while the app was closed still rings, up to 2 hours late


def reminders(user: Profile) -> list[dict]:
    """The user's own follow-ups whose due time has come (a time was set: a snooze, a callback time, a task's time).
    The app rings for each one until it is dismissed. Not cached: it is polled and must be on time."""
    now = now_ist()
    rows = (
        get_service_client().table("tasks").select(TASK_SELECT).eq("owner_id", user.id).is_("done_at", "null")
        .gte("due_at", (now - REMINDER_LOOKBACK).isoformat()).lte("due_at", (now + timedelta(seconds=30)).isoformat())
        .order("due_at").limit(20).execute().data
    )
    return [_flatten_task(r) for r in rows if (r.get("lead") or {}).get("stage") not in CLOSED]


def follow_up_counts(user: Profile) -> dict:
    """The sidebar badge: overdue follow-ups in the same default view as the Follow-ups screen (cached with it)."""
    try:
        return follow_ups(user)["counts"]
    except ForbiddenError:
        return {"open": 0, "week": 0, "overdue": 0, "noNextAction": 0}


def _build_follow_ups(owner_ids: list[str] | None, user: Profile) -> dict:
    db = get_service_client()
    today = today_ist()
    now = now_ist()
    owners = owner_ids or ["00000000-0000-0000-0000-000000000000"]
    q = db.table("tasks").select(BOARD_SELECT).is_("done_at", "null")  # every open follow-up, however far ahead
    # Done view: what was finished today (a follow-up replaced by a newer one is not "done").
    dq = db.table("tasks").select(BOARD_SELECT).gte("done_at", datetime.combine(today, time.min, tzinfo=IST).isoformat()).not_.in_("outcome", list(NOT_DONE))
    if owner_ids is not None:
        q, dq = q.in_("owner_id", owners), dq.in_("owner_id", owners)
    rows, done_rows, no_action = par(
        lambda: q.order("due_date").limit(2000).execute().data,
        lambda: dq.order("done_at", desc=True).limit(300).execute().data,
        lambda: leads_without_next_action(user, owner_ids, with_owner=True),
    )
    max_attempts = int((app_settings.get("retry") or {}).get("maxAttempts") or 5)
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
        t = _flatten_task(r, max_attempts)
        meeting = starts.get(t["lead_id"]) if t.get("kind") == "meeting" else None
        # A due time (the meeting's, or one set on the task) makes it "missed" as soon as the time has passed.
        at = meeting["starts_at"] if meeting else t.get("due_at")
        when = datetime.fromisoformat(at).astimezone(IST) if at else None
        if meeting:
            t["meeting"] = {"id": meeting["id"], "starts_at": meeting["starts_at"], "kind": meeting["kind"], "location": meeting.get("location"), "link": meeting.get("link")}
        due = when.date() if when else date.fromisoformat(t["due_date"])
        out[bucket_for(due, today, when, now)].append(t)
    for items in out.values():
        # Callbacks the client asked for come first, then by when they are due (no time = end of that day).
        items.sort(key=lambda t: (
            not t["client_requested"],
            _sort_time(t),
        ))
    done = [_flatten_task(r, max_attempts) for r in done_rows]
    _sign_owner_avatars([*rows_flat(out), *done])
    return {
        "date": today.isoformat(),
        "overdue": out["overdue"], "today": out["today"], "tomorrow": out["tomorrow"],
        "laterThisWeek": out["later_this_week"], "later": out["later"],
        "doneToday": done,
        "noNextAction": no_action,  # open leads with no open task: they need a next step
        # Open = every column; week = due from today to 7 days ahead (Today + Tomorrow + Later this week).
        "counts": {
            "open": sum(len(v) for v in out.values()),
            "week": len(out["today"]) + len(out["tomorrow"]) + len(out["later_this_week"]),
            "overdue": len(out["overdue"]),
            "noNextAction": len(no_action),
        },
    }


def rows_flat(out: dict[str, list]) -> list[dict]:
    return [t for items in out.values() for t in items]


def _sign_owner_avatars(items: list[dict]) -> None:
    """Owner photos for the cards: one batched signing request."""
    urls = signed_urls(AVATARS, list({t.get("owner_avatar_path") for t in items if t.get("owner_avatar_path")}))
    for t in items:
        t["owner_avatar_url"] = urls.get(t.pop("owner_avatar_path", None) or "")
