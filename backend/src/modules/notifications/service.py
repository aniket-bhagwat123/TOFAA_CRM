"""In-app reminders. Generated when the app polls, de-duplicated per user by dedupe_key.

Covers: meeting starting soon, morning summary, overdue follow-ups, end-of-day check.
Background push (app closed) needs a scheduler plus web-push keys and is not part of this slice.
"""
from datetime import date, timedelta

from src.core import cache
from src.core.dates import now_ist, today_ist
from src.core.parallel import par
from src.core.supabase import get_service_client
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
    if user.role not in (Role.SALES_EXECUTIVE, Role.SALES_MANAGER, Role.ADMIN):
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
        rows.append(_row(user.id, f"summary:{today}", "Today's work", f"{len(todays)} due today, {len(overdue)} overdue.", "/today"))
    if now.hour >= EVENING_HOUR and due:
        rows.append(_row(user.id, f"eod:{today}", "End-of-day check", f"{len(due)} follow-ups still open. Reschedule or close them.", "/today?eod=1"))
    rows += _escalations(user)
    if rows:  # one batched write instead of one per reminder
        db.table("notifications").upsert(rows, on_conflict="user_id,dedupe_key", ignore_duplicates=True).execute()


def _escalations(manager: Profile) -> list[dict]:
    """Follow-ups of the manager's team that are 3+ days overdue: one reminder per follow-up, to the manager.
    (Overdue by 1 day already shows in red to the executive on the Follow-ups board and the Today screen.)"""
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


def mark_read(user: Profile, ids: list[str]) -> None:
    if ids:
        get_service_client().table("notifications").update({"read_at": now_ist().isoformat()}).eq("user_id", user.id).in_("id", ids).execute()
