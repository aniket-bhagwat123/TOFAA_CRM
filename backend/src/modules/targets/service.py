"""Monthly targets, discount limits, and the progress card a KAM sees on the Today screen."""
import math
from datetime import date, datetime, time
from decimal import Decimal

from src.core import cache
from src.core.dates import IST, today_ist
from src.core.errors import AppError, ForbiddenError, NotFoundError
from src.core.audit import write_audit
from src.core.money import to_money
from src.core.parallel import par
from src.core.supabase import get_service_client
from src.core.soft_delete import live
from src.modules.auth.schemas import KAM_VALUES, Profile, Role
from src.modules.leads.stages import CLOSED
from src.modules.leads.value import decimal_value
from src.modules.targets.schemas import TargetSet

HEALTHY_COVER = Decimal("3")  # an unweighted pipeline of about 3x the gap counts as healthy (PRD 8.1)


def month_start(d: date | None = None) -> date:
    d = d or today_ist()
    return d.replace(day=1)


def next_month(d: date) -> date:
    return date(d.year + (d.month == 12), 1 if d.month == 12 else d.month + 1, 1)


def parse_month(text: str | None) -> date:
    if not text:
        return month_start()
    try:
        y, m = text.split("-")
        return date(int(y), int(m), 1)
    except (ValueError, TypeError) as exc:
        raise AppError("Use the format YYYY-MM for the month.", status_code=422) from exc


def _bounds(month: date) -> tuple[str, str]:
    start = datetime.combine(month, time.min, tzinfo=IST)
    end = datetime.combine(next_month(month), time.min, tzinfo=IST)
    return start.isoformat(), end.isoformat()


# --- the card: pure arithmetic, easy to test --------------------------------------------------------------

def build_card(
    target: Decimal,
    won: Decimal,
    open_deals: list[tuple[Decimal, int]],  # (deal value, stage probability %)
    win_amounts: list[Decimal],
    lost_count: int,
) -> dict:
    gap = max(target - won, Decimal("0"))
    weighted = sum((v * p / 100 for v, p in open_deals), Decimal("0"))
    unweighted = sum((v for v, _ in open_deals), Decimal("0"))
    shortfall = max(gap - weighted, Decimal("0"))
    healthy = gap == 0 or unweighted >= HEALTHY_COVER * gap
    wins = len(win_amounts)
    avg_deal = (sum(win_amounts, Decimal("0")) / wins) if wins else None
    win_rate = wins / (wins + lost_count) if wins + lost_count else None

    deals_needed = leads_needed = None
    if target == 0:
        suggestion = "No target is set for this month yet. Your manager sets it in Team > Targets."
    elif gap == 0:
        suggestion = "Target reached. Anything more is a bonus."
    elif shortfall == 0:
        suggestion = "Your pipeline covers the gap if it closes as expected. Keep every deal moving."
    elif avg_deal and win_rate:
        deals_needed = math.ceil(shortfall / avg_deal)
        leads_needed = math.ceil(deals_needed / win_rate)
        suggestion = (
            f"About {deals_needed} more {'deal' if deals_needed == 1 else 'deals'} needed. "
            f"At your {round(win_rate * 100)}% win rate that is around {leads_needed} more {'lead' if leads_needed == 1 else 'leads'}."
        )
    else:
        suggestion = "Close your first deals and this will tell you how many more leads you need."

    f = lambda d: float(to_money(d))  # noqa: E731
    return {
        "target": f(target), "won": f(won), "gap": f(gap), "weighted": f(weighted), "unweighted": f(unweighted),
        "shortfall": f(shortfall), "healthy": healthy, "progress": float(min(won / target, 1)) if target > 0 else 0.0,
        "avgDeal": f(avg_deal) if avg_deal else None, "winRate": round(win_rate, 3) if win_rate is not None else None,
        "dealsNeeded": deals_needed, "leadsNeeded": leads_needed, "suggestion": suggestion,
    }


# --- settings ------------------------------------------------------------------------------------------------

def effective_settings(user_id: str, month: date) -> dict:
    """This month's row, or the latest earlier one (a target carries forward until someone changes it)."""
    rows = (
        get_service_client().table("executive_settings").select("*").eq("user_id", user_id)
        .lte("month", month.isoformat()).order("month", desc=True).limit(1).execute().data
    )
    r = rows[0] if rows else {}
    return {"target_amount": Decimal(str(r.get("target_amount") or 0)), "discount_limit": Decimal(str(r.get("discount_limit") or 0))}


def discount_limit_for(user_id: str) -> Decimal:
    return effective_settings(user_id, month_start())["discount_limit"]


def _stage_probabilities() -> dict[str, int]:
    def load() -> dict[str, int]:
        rows = get_service_client().table("stage_config").select("stage,probability").execute().data
        return {r["stage"]: r["probability"] for r in rows}

    return cache.reference("stages", "probabilities", 300, load)


def target_card(user: Profile) -> dict:
    return cache.memo("target-card", user.id, None, 20, lambda: _target_card(user))


def _target_card(user: Profile) -> dict:
    db = get_service_client()
    month = month_start()
    start, end = _bounds(month)

    settings, won_rows, open_rows, wins_all, lost = par(
        lambda: effective_settings(user.id, month),
        lambda: live(db.table("leads").select("paid_amount")).eq("owner_id", user.id).eq("stage", "closed_won")
        .gte("closed_at", start).lt("closed_at", end).execute().data,
        lambda: live(db.table("leads").select("stage,value_band,estimate_amount,quote_amount,paid_amount")).eq("owner_id", user.id)
        .not_.in_("stage", list(CLOSED)).limit(2000).execute().data,
        lambda: live(db.table("leads").select("paid_amount")).eq("owner_id", user.id).eq("stage", "closed_won").limit(2000).execute().data,
        lambda: live(db.table("leads").select("id", count="exact")).eq("owner_id", user.id).eq("stage", "closed_lost").limit(1).execute().count or 0,
    )
    probs = _stage_probabilities()
    won = sum((to_money(r["paid_amount"]) for r in won_rows if r.get("paid_amount")), Decimal("0"))
    pipeline = [(decimal_value(r), probs.get(r["stage"], 0)) for r in open_rows]
    pipeline = [(v, p) for v, p in pipeline if v > 0]
    wins = [to_money(r["paid_amount"]) for r in wins_all if r.get("paid_amount")]
    card = build_card(settings["target_amount"], won, pipeline, wins, lost)
    return {**card, "month": month.isoformat()[:7], "discountLimit": float(settings["discount_limit"])}


# --- managing targets (Manager for the team, Admin for everyone) ---------------------------------------------------

def _may_manage(actor: Profile) -> list[str] | None:
    """Ids the actor may set targets for; None means everyone."""
    if actor.role == Role.ADMIN:
        return None
    if actor.role == Role.SALES_MANAGER:
        return None  # managers set targets for every KAM, like admins
    raise ForbiddenError("Only managers and admins set targets.")


def list_settings(actor: Profile, month_text: str | None) -> dict:
    month = parse_month(month_text)
    scope = _may_manage(actor)
    db = get_service_client()
    q = db.table("profiles").select("id,full_name,role,avatar_path").eq("is_active", True).in_("role", list(KAM_VALUES))
    if scope is not None:
        q = q.in_("id", scope)
    people = q.order("full_name").execute().data
    ids = [p["id"] for p in people]
    if not ids:
        return {"month": month.isoformat()[:7], "members": []}
    start, end = _bounds(month)
    rows, won = par(
        lambda: db.table("executive_settings").select("*").in_("user_id", ids).lte("month", month.isoformat()).order("month", desc=True).execute().data,
        lambda: live(db.table("leads").select("owner_id,paid_amount")).in_("owner_id", ids).eq("stage", "closed_won")
        .gte("closed_at", start).lt("closed_at", end).limit(5000).execute().data,
    )
    latest: dict[str, dict] = {}
    for r in rows:  # newest first, so the first row seen per person is the one in force
        latest.setdefault(r["user_id"], r)
    won_by: dict[str, Decimal] = {}
    for r in won:
        if r.get("paid_amount"):
            won_by[r["owner_id"]] = won_by.get(r["owner_id"], Decimal("0")) + to_money(r["paid_amount"])
    members = [
        {
            "userId": p["id"], "fullName": p["full_name"],
            "targetAmount": float(latest.get(p["id"], {}).get("target_amount") or 0),
            "discountLimit": float(latest.get(p["id"], {}).get("discount_limit") or 0),
            "setForThisMonth": latest.get(p["id"], {}).get("month") == month.isoformat(),
            "won": float(won_by.get(p["id"], 0)),
        }
        for p in people
    ]
    return {"month": month.isoformat()[:7], "members": members}


def set_settings(actor: Profile, body: TargetSet) -> dict:
    scope = _may_manage(actor)
    if scope is not None and body.user_id not in scope:
        raise ForbiddenError("You can only set targets for your own team.")
    db = get_service_client()
    person = db.table("profiles").select("id,role").eq("id", body.user_id).limit(1).execute().data
    if not person:
        raise NotFoundError("User not found.")
    if person[0]["role"] not in KAM_VALUES:
        raise AppError("Targets are set for KAMs.", status_code=422)
    month = parse_month(body.month)
    row = {
        "user_id": body.user_id, "month": month.isoformat(), "target_amount": float(to_money(body.target_amount)),
        "discount_limit": float(body.discount_limit), "updated_by": actor.id,
    }
    db.table("executive_settings").upsert(row, on_conflict="user_id,month").execute()
    write_audit(actor.id, "update", "executive_settings", body.user_id, {"month": body.month, "target": row["target_amount"], "discount": row["discount_limit"]})
    return {"saved": True}
