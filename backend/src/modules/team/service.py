"""The Dashboard: pipeline value, target vs achieved, who has open work, what is overdue and which deals are stuck."""
from datetime import datetime, time, timedelta

import logging
from decimal import Decimal

from src.core import app_settings, cache
from src.core.dates import IST, today_ist
from src.core.errors import ForbiddenError
from src.core.parallel import par
from src.core.supabase import get_service_client
from src.modules.auth.schemas import Profile, Role
from src.modules.leads.stages import CLOSED
from src.modules.leads.value import decimal_value
from src.modules.targets import service as targets

log = logging.getLogger(__name__)


def summary(user: Profile) -> dict:
    if user.role not in (Role.ADMIN, Role.SALES_MANAGER):
        raise ForbiddenError()
    return cache.memo("team-summary", user.id, None, 20, lambda: _summary(user))


def _summary(user: Profile) -> dict:
    if user.role not in (Role.ADMIN, Role.SALES_MANAGER):
        raise ForbiddenError()
    db = get_service_client()
    # Admins can own deals too (and often do early on), so on an admin's dashboard they count like everyone else.
    # Managers see the whole company like the Superadmin; admins can own deals too, so they count like everyone else.
    owner_roles = [Role.SALES_EXECUTIVE.value, Role.SALES_MANAGER.value, Role.ADMIN.value, Role.KAM.value]
    people_q = db.table("profiles").select("id,full_name,role,manager_id").eq("is_active", True).in_("role", owner_roles)
    people = people_q.order("full_name").execute().data
    ids = [p["id"] for p in people]
    if not ids:
        return {"members": [], "overdueLeads": [], "stuckLeads": [], "totals": {"open": 0, "overdue": 0, "noNextAction": 0}, "pipeline": None, "target": None}

    today = today_ist()
    start = datetime.combine(today, time.min, tzinfo=IST)
    leads, meetings = par(
        lambda: (
            db.table("leads").select("id,owner_id,stage,next_follow_up,updated_at,value_band,estimate_amount,quote_amount,paid_amount,company:companies(name),contact:contacts(name)")
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
        "stuckLeads": _stuck(leads, stats),
        "totals": {k: sum(m[k] for m in members) for k in ("open", "overdue", "noNextAction")},
        "pipeline": _pipeline(leads),
        "target": _target(user),
    }


def _pipeline(leads: list[dict]) -> dict:
    """Open deal value, and the same weighted by each stage's probability."""
    probs = targets._stage_probabilities()
    value = weighted = Decimal("0")
    by_stage: dict[str, dict] = {}
    for lead in leads:
        v = decimal_value(lead)
        value += v
        weighted += v * probs.get(lead["stage"], 0) / 100
        row = by_stage.setdefault(lead["stage"], {"stage": lead["stage"], "count": 0, "value": 0.0})
        row["count"] += 1
        row["value"] += float(v)
    return {"value": float(value), "weighted": float(round(weighted, 2)), "count": len(leads), "byStage": list(by_stage.values())}


def _target(user: Profile) -> dict | None:
    """This month's target for the team (sum of the executives' targets) against what they have won."""
    try:
        data = targets.list_settings(user, None)
    except Exception:  # noqa: BLE001 - the dashboard still shows everything else
        log.warning("could not load targets for the dashboard", exc_info=True)
        return None
    target = sum(m["targetAmount"] for m in data["members"])
    won = sum(m["won"] for m in data["members"])
    return {"month": data["month"], "target": target, "won": won, "progress": round(won / target * 100, 1) if target else None, "people": len(data["members"])}


def _stuck(leads: list[dict], stats: dict) -> list[dict]:
    """Open deals with no progress (nothing changed on them) for longer than the stuck-days setting, oldest first."""
    days = int(app_settings.get("stuckDays") or 14)
    cutoff = (datetime.now(IST) - timedelta(days=days)).isoformat()
    stuck = [lead for lead in leads if lead.get("updated_at") and lead["updated_at"] < cutoff]
    stuck.sort(key=lambda lead: lead["updated_at"])
    return [
        {
            "leadId": lead["id"], "companyName": lead["company"]["name"], "contactName": lead["contact"]["name"], "stage": lead["stage"],
            "ownerName": stats[lead["owner_id"]]["fullName"], "since": lead["updated_at"], "value": float(decimal_value(lead)), "days": days,
        }
        for lead in stuck[:30]
    ]
