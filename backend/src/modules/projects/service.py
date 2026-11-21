"""Projects: a client's deals (leads with pipeline = 'client'), seen on their own.

The rows and the flow are the leads module's; this adds what a projects screen needs on top: the summary strip and the
filter choices."""
from datetime import date

from src.core import cache
from src.core.access import require_lead_role
from src.core.dates import today_ist
from src.core.supabase import get_service_client
from src.modules.auth.schemas import Profile
from src.modules.leads.service import _lead_filters
from src.modules.leads.stages import CLIENT_STAGES, CLOSED
from src.modules.leads.value import deal_value

TTL = 20
ACTIVE_STAGES = [s for s in CLIENT_STAGES if s not in CLOSED]


def summarize(rows: list[dict], today: date) -> dict:
    """The numbers at the top of the Projects screen. Pure, so it is easy to test."""
    month_start = today.replace(day=1).isoformat()
    active = [r for r in rows if r.get("stage") not in CLOSED]
    won = [r for r in rows if r.get("stage") == "closed_won" and (r.get("closed_at") or "")[:10] >= month_start]
    lost = [r for r in rows if r.get("stage") == "closed_lost" and (r.get("closed_at") or "")[:10] >= month_start]
    return {
        "active": len(active),
        # a list, not a dict: stage keys have underscores and the response camel-cases dict keys
        "by_stage": [{"stage": s, "count": sum(1 for r in active if r.get("stage") == s)} for s in ACTIVE_STAGES],
        "open_value": round(sum(deal_value(r) or 0 for r in active), 2),
        "overdue": sum(1 for r in active if r.get("next_follow_up") and r["next_follow_up"] < today.isoformat()),
        "won_this_month": {"count": len(won), "value": round(sum(deal_value(r) or 0 for r in won), 2)},
        "lost_this_month": len(lost),
    }


def summary(user: Profile, *, owner_id=None, company_id=None, occasion=None, origin=None, search=None) -> dict:
    require_lead_role(user)

    def load() -> dict:
        q = get_service_client().table("leads").select("*")
        q = _lead_filters(q, user, stage=None, overdue=False, source=None, owner_id=owner_id, search=search, pipeline="client",
                          company_id=company_id, occasion=occasion, origin=origin)
        return summarize(q.limit(3000).execute().data, today_ist())

    key = {"w": owner_id, "c": company_id, "oc": occasion, "or": origin, "q": search}
    return cache.memo("projects_summary", user.id, key, TTL, load)


def filters(user: Profile) -> dict:
    """Clients that have projects you can see, and the occasions in use, for the filter menus."""
    require_lead_role(user)

    def load() -> dict:
        q = get_service_client().table("leads").select("company_id,occasion,company:companies(name)")
        q = _lead_filters(q, user, stage=None, overdue=False, source=None, owner_id=None, search=None, pipeline="client")
        rows = q.limit(5000).execute().data
        clients = {r["company_id"]: (r.get("company") or {}).get("name") or "Client" for r in rows if r.get("company_id")}
        occasions = sorted({r["occasion"] for r in rows if r.get("occasion")}, key=str.lower)
        return {
            "clients": sorted(({"id": k, "name": v} for k, v in clients.items()), key=lambda c: c["name"].lower()),
            "occasions": occasions,
        }

    return cache.memo("projects_filters", user.id, None, TTL, load)
