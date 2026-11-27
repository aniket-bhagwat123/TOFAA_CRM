"""The Dashboard: one per role, built only from the data that role's modules show.

KAM: their own pipeline, target, follow-ups, call statuses, quotations and meetings.
Sales Manager:   the whole company: pipeline, target vs achieved, overdue and stuck deals, people, approvals.
Superadmin:      the manager's view plus payments waiting and orders by delivery step.
Finance:         payments: waiting, partial, confirmed this month, and the ERP connection.
                 They also get their accounts, upcoming occasions, open projects, their accounts' orders and their follow-ups.
"""
import logging
from datetime import datetime, time, timedelta
from decimal import Decimal

from src.core import cache
from src.core.dates import IST, today_ist
from src.core.errors import ForbiddenError
from src.core.parallel import par
from src.core.supabase import get_service_client
from src.core.soft_delete import live
from src.modules.orders import flow as order_flow
from src.modules.auth.schemas import Profile, Role
from src.modules.leads.stages import CLOSED
from src.modules.leads.value import decimal_value
from src.modules.targets import service as targets

log = logging.getLogger(__name__)
NOWHERE = "00000000-0000-0000-0000-000000000000"
ORDER_STEPS = ["new", "production", "quality_check", "dispatched", "delivered"]


def dashboard(user: Profile) -> dict:
    builders = {
        Role.SALES_MANAGER: _manager, Role.ADMIN: _admin,
        Role.FINANCE: _finance, Role.KAM: _kam,
    }
    build = builders.get(user.role)
    if not build:
        raise ForbiddenError()
    return cache.memo("dashboard", user.id, None, 20, lambda: {"role": user.role.value, **build(user)})


def _safe(fn, default):
    """A dashboard section that fails (for example before a migration) shows empty instead of breaking the page."""
    try:
        return fn()
    except Exception:  # noqa: BLE001
        log.warning("dashboard section failed", exc_info=True)
        return default


def _follow_up_counts(owner_ids: list[str]) -> dict:
    today = today_ist().isoformat()
    rows = (
        get_service_client().table("tasks").select("due_date").in_("owner_id", owner_ids or [NOWHERE]).is_("done_at", "null")
        .lte("due_date", today).limit(5000).execute().data
    )
    return {"overdue": sum(1 for r in rows if r["due_date"] < today), "today": sum(1 for r in rows if r["due_date"] == today)}


def _order_counts(company_ids: list[str] | None) -> dict:
    q = get_service_client().table("orders").select("status")
    if order_flow.upgraded():
        q = q.is_("deleted_at", "null")
    if company_ids is not None:
        q = q.in_("company_id", company_ids or [NOWHERE])
    counts = {s: 0 for s in ORDER_STEPS}
    for r in q.limit(5000).execute().data:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return counts


# --- KAM: own sales -----------------------------------------------------------------------------------------------------

def _executive(user: Profile) -> dict:
    db = get_service_client()
    now = datetime.now(IST)
    month_start = datetime.combine(today_ist().replace(day=1), time.min, tzinfo=IST).isoformat()
    leads, quotes, meetings = par(
        lambda: live(db.table("leads").select("id,stage,last_call_outcome,value_band,estimate_amount,quote_amount,paid_amount"))
        .eq("owner_id", user.id).not_.in_("stage", list(CLOSED)).limit(2000).execute().data,
        lambda: _safe(lambda: db.table("quotations").select("id,lead_id,version,status,total,created_at,sent_at,lead:leads!inner(owner_id,company:companies(name))")
                      .eq("lead.owner_id", user.id).order("created_at", desc=True).limit(500).execute().data, []),
        lambda: db.table("meetings").select("id,lead_id,starts_at,kind,location,lead:leads(company:companies(name),contact:contacts(name))")
        .eq("owner_id", user.id).eq("status", "scheduled").gte("starts_at", now.isoformat()).lt("starts_at", (now + timedelta(days=7)).isoformat())
        .order("starts_at").limit(6).execute().data,
    )
    probs = targets._stage_probabilities()
    by_stage: dict[str, dict] = {}
    value = weighted = Decimal("0")
    calls: dict[str, int] = {}
    for lead in leads:
        v = decimal_value(lead)
        value += v
        weighted += v * probs.get(lead["stage"], 0) / 100
        row = by_stage.setdefault(lead["stage"], {"stage": lead["stage"], "count": 0, "value": 0.0})
        row["count"] += 1
        row["value"] += float(v)
        if lead["stage"] in ("new_lead", "connected"):
            key = lead.get("last_call_outcome") or "none"
            calls[key] = calls.get(key, 0) + 1

    sent_month = [q for q in quotes if q["status"] == "sent" and (q.get("sent_at") or "") >= month_start]
    return {
        "pipeline": {"count": len(leads), "value": float(value), "weighted": float(round(weighted, 2)), "byStage": list(by_stage.values())},
        "target": _safe(lambda: targets.target_card(user), None),
        "followUps": _follow_up_counts([user.id]),
        "callStatus": [{"outcome": k, "count": n} for k, n in sorted(calls.items(), key=lambda x: -x[1])],
        "quotations": {
            "toSend": sum(1 for q in quotes if q["status"] in ("ready", "approved")),
            "waitingApproval": sum(1 for q in quotes if q["status"] == "pending_approval"),
            "sentThisMonth": len(sent_month), "sentValueThisMonth": float(sum(Decimal(str(q["total"] or 0)) for q in sent_month)),
            "recent": [
                {"id": q["id"], "leadId": q["lead_id"], "version": q["version"], "status": q["status"], "total": q["total"],
                 "createdAt": q["created_at"], "companyName": ((q.get("lead") or {}).get("company") or {}).get("name")}
                for q in quotes[:5]
            ],
        },
        "meetings": [
            {"id": m["id"], "leadId": m["lead_id"], "startsAt": m["starts_at"], "kind": m["kind"], "location": m.get("location"),
             "companyName": ((m.get("lead") or {}).get("company") or {}).get("name"), "contactName": ((m.get("lead") or {}).get("contact") or {}).get("name")}
            for m in meetings
        ],
    }


# --- Sales Manager / Superadmin -----------------------------------------------------------------------------------------------

def _manager(user: Profile) -> dict:
    from src.modules.agreements import service as agreements
    from src.modules.quotations import service as quotations
    from src.modules.team import service as team

    summary, discounts, terms = par(
        lambda: team.summary(user),
        lambda: _safe(lambda: quotations.pending_approvals(user), []),
        lambda: _safe(lambda: agreements.pending_terms(user), []),
    )
    return {**summary, "approvals": len(discounts) + len(terms)}


def _admin(user: Profile) -> dict:
    out, payments, orders = par(
        lambda: _manager(user),
        lambda: _safe(lambda: _payment_totals(), None),
        lambda: _safe(lambda: _order_counts(None), None),
    )
    return {**out, "payments": payments, "orders": orders}


# --- Finance ------------------------------------------------------------------------------------------------------------------

def _payment_totals() -> dict:
    rows = get_service_client().table("payment_requests").select("status,amount,amount_paid,confirmed_at").limit(5000).execute().data
    month_start = datetime.combine(today_ist().replace(day=1), time.min, tzinfo=IST).isoformat()
    waiting = [r for r in rows if r["status"] == "requested"]
    partial = [r for r in rows if r["status"] == "partial"]
    confirmed = [r for r in rows if r["status"] == "confirmed" and (r.get("confirmed_at") or "") >= month_start]
    money = lambda rs, key: float(sum(Decimal(str(r.get(key) or 0)) for r in rs))  # noqa: E731
    return {
        "waiting": {"count": len(waiting), "amount": money(waiting, "amount")},
        "partial": {"count": len(partial), "outstanding": money(partial, "amount") - money(partial, "amount_paid")},
        "confirmedThisMonth": {"count": len(confirmed), "amount": money(confirmed, "amount_paid")},
    }


def _finance(user: Profile) -> dict:
    from src.modules.app_config.router import erp_status

    db = get_service_client()
    totals, recent = par(
        _payment_totals,
        lambda: db.table("payment_requests").select("id,invoice_number,amount,amount_paid,status,requested_at,lead:leads(company:companies(name))")
        .in_("status", ["requested", "partial"]).order("requested_at").limit(8).execute().data,
    )
    return {
        **totals,
        "waitingList": [
            {"id": r["id"], "invoiceNumber": r["invoice_number"], "amount": r["amount"], "amountPaid": r["amount_paid"], "status": r["status"],
             "requestedAt": r["requested_at"], "companyName": ((r.get("lead") or {}).get("company") or {}).get("name")}
            for r in recent
        ],
        "erp": _safe(erp_status, None),
    }


# --- KAM -------------------------------------------------------------------------------------------------------------------------

def _kam(user: Profile) -> dict:
    """A KAM's own sales (pipeline, target, quotations, meetings) and the accounts they look after."""
    return {**_executive(user), **_kam_accounts(user)}


def _kam_accounts(user: Profile) -> dict:
    from src.modules.clients import service as clients

    accounts = clients.list_clients(user, search=None, tier=None, status=None, owner_id=None, occasion_soon=False)
    company_ids = [a["id"] for a in accounts]
    soon = sorted((a for a in accounts if a.get("next_occasion") and a["next_occasion"]["days_away"] <= 30), key=lambda a: a["next_occasion"]["days_away"])
    top = sorted(accounts, key=lambda a: -(a.get("lifetime_value") or 0))[:5]
    return {
        "accounts": {
            "count": len(accounts), "lifetime": sum(a.get("lifetime_value") or 0 for a in accounts),
            "revenue12m": sum(a.get("revenue_12m") or 0 for a in accounts), "openProjects": sum(a.get("open_projects") or 0 for a in accounts),
        },
        "occasions": [{"id": a["id"], "name": a["name"], "occasion": a["next_occasion"]["name"], "date": a["next_occasion"]["date"], "daysAway": a["next_occasion"]["days_away"]} for a in soon[:6]],
        "topAccounts": [{"id": a["id"], "name": a["name"], "tier": a.get("tier"), "lifetime": a.get("lifetime_value"), "openProjects": a.get("open_projects")} for a in top],
        "orders": _safe(lambda: _order_counts(company_ids), None),
        "followUps": _follow_up_counts([user.id]),
    }
