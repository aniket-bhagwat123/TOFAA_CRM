"""The Activity module: everything that happened across the leads and clients a person can see, newest first.

Two sources are merged: entries on a deal (lead or client project) and entries on a client itself (occasion calls,
new contacts ...). Paging uses a time cursor ("older than this"), so new entries never shift what was already loaded.
"""
from src.core import cache
from src.core.access import require_lead_role, visible_owner_ids
from src.core.errors import ForbiddenError
from src.core.parallel import par
from src.core.supabase import get_service_client
from src.modules.auth.schemas import Profile, Role

PAGE = 30
KINDS = {"call", "whatsapp", "meeting", "note", "stage_change", "reassign", "task", "created", "import", "mom", "quotation", "agreement", "payment", "client", "campaign", "sample", "order"}
LEAD_EMBED = "lead:leads!inner(id,owner_id,pipeline,project_title,company_id,company:companies(name))"
COMPANY_EMBED = "company:companies!inner(id,name,account_owner_id)"


def merge(a: list[dict], b: list[dict], limit: int) -> list[dict]:
    """Newest first across both lists, at most `limit`."""
    return sorted([*a, *b], key=lambda r: r["created_at"], reverse=True)[:limit]


def feed(user: Profile, *, before: str | None, kind: str | None, owner_id: str | None, lead_id: str | None, company_id: str | None) -> dict:
    require_lead_role(user)
    if user.role in (Role.SALES_EXECUTIVE, Role.KAM):
        # Role rules: executives and KAMs never see Activity (their own lead pages still show each lead's timeline).
        raise ForbiddenError("Activity is for managers and admins.")
    params = {"b": before, "k": kind, "o": owner_id, "l": lead_id, "c": company_id}
    return cache.memo("activity-feed", user.id, params, 15, lambda: _feed(user, before, kind, owner_id, lead_id, company_id))


def _feed(user, before, kind, owner_id, lead_id, company_id) -> dict:
    scope = visible_owner_ids(user)
    if owner_id:
        if scope is not None and owner_id not in scope:
            raise ForbiddenError()
        scope = [owner_id]
    db = get_service_client()

    def on_deals() -> list[dict]:
        q = db.table("activities").select(f"*, actor:profiles!actor_id(full_name), {LEAD_EMBED}").not_.is_("lead_id", "null")
        if scope is not None:
            q = q.in_("lead.owner_id", scope)
        if lead_id:
            q = q.eq("lead_id", lead_id)
        if company_id:
            q = q.eq("lead.company_id", company_id)
        if kind in KINDS:
            q = q.eq("kind", kind)
        if before:
            q = q.lt("created_at", before)
        return q.order("created_at", desc=True).limit(PAGE).execute().data

    def on_clients() -> list[dict]:
        if lead_id:  # a single deal's history has no client-level entries
            return []
        q = db.table("activities").select(f"*, actor:profiles!actor_id(full_name), {COMPANY_EMBED}").is_("lead_id", "null")
        if scope is not None:
            q = q.in_("company.account_owner_id", scope)
        if company_id:
            q = q.eq("company_id", company_id)
        if kind in KINDS:
            q = q.eq("kind", kind)
        if before:
            q = q.lt("created_at", before)
        return q.order("created_at", desc=True).limit(PAGE).execute().data

    deals, clients = par(on_deals, on_clients)
    rows = merge(deals, clients, PAGE)
    items = []
    for r in rows:
        lead = r.pop("lead", None)
        company = r.pop("company", None)
        if lead:
            r["subject"] = {"type": "lead", "id": lead["id"], "name": (lead.get("company") or {}).get("name"), "project_title": lead.get("project_title"), "pipeline": lead.get("pipeline")}
        else:
            r["subject"] = {"type": "client", "id": (company or {}).get("id") or r.get("company_id"), "name": (company or {}).get("name")}
        items.append(r)
    more = len(deals) == PAGE or len(clients) == PAGE
    return {"items": items, "next_before": items[-1]["created_at"] if items and more else None}
