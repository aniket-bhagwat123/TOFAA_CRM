"""In-app reminders. Generated when the app polls, de-duplicated per user by dedupe_key.

Covers: meeting starting soon, morning summary, overdue follow-ups, end-of-day check.
Background push (app closed) needs a scheduler plus web-push keys and is not part of this slice.
"""
from datetime import date, datetime, time, timedelta

from src.modules.gifting_requests import service as gifting_requests
from src.core import cache
from src.core.dates import IST, now_ist, today_ist
from src.core.parallel import par
from src.core.supabase import get_service_client
from src.core.soft_delete import live
from src.modules.auth.schemas import Profile, Role

ESCALATE_AFTER_DAYS = 3  # a follow-up this many days overdue is escalated to the owner's manager
MORNING_HOUR = 8
EVENING_HOUR = 18
GENERATE_EVERY = 45  # seconds: the app polls once a minute, there is no need to recompute more often


def _row(user_id: str, key: str, title: str, body: str | None, link: str | None) -> dict:
    return {"user_id": user_id, "dedupe_key": key, "title": title, "body": body, "link": link}


def notify(user_id: str, key: str, title: str, body: str | None = None, link: str | None = None) -> None:
    """Used by other modules (e.g. a WhatsApp reply tells the lead owner)."""
    get_service_client().table("notifications").upsert(
        _row(user_id, key, title, body, link), on_conflict="user_id,dedupe_key", ignore_duplicates=True
    ).execute()


def generate(user: Profile) -> None:
    gifting_requests.raise_alerts_in_background(user)  # KAMs: new gift requests from their clients
    if user.role not in (Role.KAM, Role.SALES_MANAGER, Role.ADMIN):
        return
    db = get_service_client()
    now, today = now_ist(), today_ist().isoformat()

    soon, due = par(
        lambda: db.table("meetings").select("id,starts_at,lead_id,lead:leads(company:companies(name))")
        .eq("owner_id", user.id).eq("status", "scheduled")
        .gte("starts_at", now.isoformat()).lte("starts_at", (now + timedelta(minutes=45)).isoformat()).execute().data,
        lambda: db.table("tasks").select("id,due_date").eq("owner_id", user.id).is_("done_at", "null").lte("due_date", today).execute().data,
    )
    rows = []
    for m in soon:
        name = ((m.get("lead") or {}).get("company") or {}).get("name", "a client")
        rows.append(_row(user.id, f"meeting:{m['id']}", "Meeting starting soon", f"Meeting with {name}", f"/leads/{m['lead_id']}"))
    overdue = [t for t in due if t["due_date"] < today]
    todays = [t for t in due if t["due_date"] == today]
    if now.hour >= MORNING_HOUR and (due or soon):
        rows.append(_row(user.id, f"summary:{today}", "Today's work", f"{len(todays)} due today, {len(overdue)} overdue.", "/dashboard"))
    if now.hour >= EVENING_HOUR and due:
        rows.append(_row(user.id, f"eod:{today}", "End-of-day check", f"{len(due)} follow-ups still open. Reschedule or close them.", "/dashboard?eod=1"))
    rows += _escalations(user)
    if rows:  # one batched write instead of one per reminder
        db.table("notifications").upsert(rows, on_conflict="user_id,dedupe_key", ignore_duplicates=True).execute()


def _escalations(manager: Profile) -> list[dict]:
    """Follow-ups of the manager's team that are 3+ days overdue: one reminder per follow-up, to the manager.
    (Overdue by 1 day already shows in red to the KAM on the Follow-ups board and in Today on the Dashboard.)"""
    db = get_service_client()
    team = db.table("profiles").select("id,full_name").eq("manager_id", manager.id).neq("id", manager.id).execute().data
    if not team:
        return []
    names = {p["id"]: p["full_name"] for p in team}
    cutoff = (today_ist() - timedelta(days=ESCALATE_AFTER_DAYS)).isoformat()
    late = (
        db.table("tasks").select("id,owner_id,due_date,lead:leads(stage,company:companies(name)),company:companies(name)")
        .in_("owner_id", list(names)).is_("done_at", "null").lte("due_date", cutoff).limit(200).execute().data
    )
    out = []
    for t in late:
        lead = t.get("lead") or {}
        if lead.get("stage") in ("closed_won", "closed_lost"):
            continue
        company = ((lead.get("company") or t.get("company")) or {}).get("name") or "a client"
        days = (today_ist() - date.fromisoformat(t["due_date"])).days
        out.append(_row(
            manager.id, f"escalate:{t['id']}:{t['due_date']}", "Follow-up overdue 3+ days",
            f"{names.get(t['owner_id'], 'A team member')}'s follow-up with {company} is {days} days overdue.", "/follow-ups",
        ))
    return out


def list_unread(user: Profile) -> list[dict]:
    def load() -> list[dict]:
        cache.reference("notif-gen", user.id, GENERATE_EVERY, lambda: generate(user) or True)
        return (
            get_service_client().table("notifications").select("*").eq("user_id", user.id).is_("read_at", "null")
            .order("created_at", desc=True).limit(30).execute().data
        )

    return cache.memo("notifications", user.id, None, 20, load)


# --- notification centre (the bell in the top bar) ----------------------------------------------------------------

ALERT_DAYS = 7          # alerts stay in the list (read or not) this long
NEW_LEAD_DAYS = 3       # "New leads for you": assigned to you in the last 3 days, not yet called
MEETING_HOURS = 48      # upcoming meetings shown this far ahead


def center(user: Profile) -> dict:
    """Everything the bell shows, in one request: alerts, your follow-ups (overdue, today, tomorrow), meetings in the
    next 48 hours, new leads assigned to you, and leads with no next action. Counts drive the red number on the bell."""
    from src.modules.tasks.service import CLOSED, TASK_SELECT, _flatten_task, leads_without_next_action  # local: tasks imports this module

    def load() -> dict:
        cache.reference("notif-gen", user.id, GENERATE_EVERY, lambda: generate(user) or True)
        db = get_service_client()
        now, today = now_ist(), today_ist()
        end_tomorrow = datetime.combine(today + timedelta(days=1), time.max, tzinfo=IST)
        alerts, tasks, meetings, new_leads, no_action = par(
            lambda: db.table("notifications").select("*").eq("user_id", user.id)
            .gte("created_at", (now - timedelta(days=ALERT_DAYS)).isoformat()).order("created_at", desc=True).limit(40).execute().data,
            lambda: db.table("tasks").select(TASK_SELECT).eq("owner_id", user.id).is_("done_at", "null")
            .lte("due_date", (today + timedelta(days=1)).isoformat()).order("due_date").limit(200).execute().data,
            lambda: db.table("meetings").select("id,lead_id,starts_at,kind,location,lead:leads(company:companies(name),contact:contacts(name))")
            .eq("owner_id", user.id).eq("status", "scheduled").gte("starts_at", now.isoformat())
            .lte("starts_at", (now + timedelta(hours=MEETING_HOURS)).isoformat()).order("starts_at").limit(20).execute().data,
            lambda: live(db.table("leads").select("id,stage,pipeline,project_title,created_at,company:companies(name),contact:contacts(name,phone)"))
            .eq("owner_id", user.id).eq("stage", "new_lead").is_("last_call_outcome", "null")
            .gte("created_at", (now - timedelta(days=NEW_LEAD_DAYS)).isoformat()).order("created_at", desc=True).limit(20).execute().data,
            lambda: leads_without_next_action(user),
        )
        items = [_flatten_task(t) for t in tasks if (t.get("lead") or {}).get("stage") not in CLOSED]
        for t in items:
            at = datetime.fromisoformat(t["due_at"]) if t.get("due_at") else datetime.combine(date.fromisoformat(t["due_date"]), time(23, 59), tzinfo=IST)
            t["when"] = "overdue" if at < now else "today" if at.astimezone(IST).date() == today else "tomorrow"
        items.sort(key=lambda t: (t.get("due_at") or f"{t['due_date']}T23:59"))
        overdue = [t for t in items if t["when"] == "overdue"]
        due_today = [t for t in items if t["when"] == "today"]
        tomorrow = [t for t in items if t["when"] == "tomorrow"]
        flat_meetings = [
            {"id": m["id"], "lead_id": m["lead_id"], "starts_at": m["starts_at"], "kind": m["kind"], "location": m.get("location"),
             "company_name": ((m.get("lead") or {}).get("company") or {}).get("name"), "contact_name": ((m.get("lead") or {}).get("contact") or {}).get("name")}
            for m in meetings
        ]
        flat_leads = [
            {"lead_id": l["id"], "stage": l["stage"], "project_title": l.get("project_title"), "created_at": l["created_at"],
             "company_name": (l.get("company") or {}).get("name"), "contact_name": (l.get("contact") or {}).get("name"), "phone": (l.get("contact") or {}).get("phone")}
            for l in new_leads
        ]
        unread = sum(1 for a in alerts if not a.get("read_at"))
        return {
            "alerts": alerts,
            "overdue": overdue[:20], "today": due_today[:20], "tomorrow": tomorrow[:20],
            "meetings": flat_meetings, "newLeads": flat_leads, "noNextAction": no_action[:5],
            "counts": {
                "unread": unread, "overdue": len(overdue), "today": len(due_today), "tomorrow": len(tomorrow),
                "meetings": len(flat_meetings), "newLeads": len(flat_leads), "noNextAction": len(no_action),
                # The red number on the bell: what needs you now (new alerts, overdue, still due today).
                "badge": unread + len(overdue) + len(due_today),
            },
        }

    return cache.memo("notif-center", user.id, None, 20, load)


def mark_all_read(user: Profile) -> None:
    get_service_client().table("notifications").update({"read_at": now_ist().isoformat()}).eq("user_id", user.id).is_("read_at", "null").execute()


def mark_read(user: Profile, ids: list[str]) -> None:
    if ids:
        get_service_client().table("notifications").update({"read_at": now_ist().isoformat()}).eq("user_id", user.id).in_("id", ids).execute()
