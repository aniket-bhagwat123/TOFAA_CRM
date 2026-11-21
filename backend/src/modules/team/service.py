"""Basic manager view (Phase 1): who has how much open work, and what is overdue."""
from datetime import datetime, time, timedelta

from src.core import cache
from src.core.access import team_ids
from src.core.dates import IST, today_ist
from src.core.errors import ForbiddenError
from src.core.parallel import par
from src.core.supabase import get_service_client
from src.modules.auth.schemas import Profile, Role
from src.modules.leads.stages import CLOSED


def summary(user: Profile) -> dict:
    if user.role not in (Role.ADMIN, Role.SALES_MANAGER):
        raise ForbiddenError()
    return cache.memo("team-summary", user.id, None, 20, lambda: _summary(user))


def _summary(user: Profile) -> dict:
    if user.role not in (Role.ADMIN, Role.SALES_MANAGER):
        raise ForbiddenError()
    db = get_service_client()
    people_q = db.table("profiles").select("id,full_name,role,manager_id").eq("is_active", True).in_(
        "role", [Role.SALES_EXECUTIVE.value, Role.SALES_MANAGER.value]
    )
    if user.role == Role.SALES_MANAGER:
        people_q = people_q.in_("id", team_ids(user))
    people = people_q.order("full_name").execute().data
    ids = [p["id"] for p in people]
    if not ids:
        return {"members": [], "overdueLeads": [], "totals": {"open": 0, "overdue": 0, "noNextAction": 0}}

    today = today_ist()
    start = datetime.combine(today, time.min, tzinfo=IST)
    leads, meetings = par(
        lambda: (
            db.table("leads").select("id,owner_id,stage,next_follow_up,company:companies(name),contact:contacts(name)")
        .in_("owner_id", ids).not_.in_("stage", list(CLOSED)).limit(5000).execute().data
        ),
        lambda: (
            db.table("meetings").select("owner_id").in_("owner_id", ids).eq("status", "scheduled")
        .gte("starts_at", start.isoformat()).lt("starts_at", (start + timedelta(days=1)).isoformat()).execute().data
        ),
    )

    stats = {p["id"]: {"id": p["id"], "fullName": p["full_name"], "role": p["role"], "open": 0, "overdue": 0, "noNextAction": 0, "meetingsToday": 0} for p in people}
    overdue_leads = []
    for lead in leads:
        s = stats[lead["owner_id"]]
        s["open"] += 1
        if not lead["next_follow_up"]:
            s["noNextAction"] += 1
        elif lead["next_follow_up"] < today.isoformat():
            s["overdue"] += 1
            overdue_leads.append(
                {
                    "leadId": lead["id"], "ownerId": lead["owner_id"], "ownerName": stats[lead["owner_id"]]["fullName"],
                    "companyName": lead["company"]["name"], "contactName": lead["contact"]["name"],
                    "stage": lead["stage"], "nextFollowUp": lead["next_follow_up"],
                }
            )
    for m in meetings:
        stats[m["owner_id"]]["meetingsToday"] += 1
    overdue_leads.sort(key=lambda x: x["nextFollowUp"])
    members = list(stats.values())
    return {
        "members": members,
        "overdueLeads": overdue_leads[:30],
        "totals": {k: sum(m[k] for m in members) for k in ("open", "overdue", "noNextAction")},
    }
