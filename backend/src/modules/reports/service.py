"""Reports: pipeline by stage, weighted forecast, conversion funnel, lost reasons and lead sources, for a date range."""
from collections import Counter
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from src.core import cache
from src.core.access import visible_owner_ids
from src.core.dates import IST, today_ist
from src.core.errors import AppError, ForbiddenError
from src.core.money import to_money
from src.core.parallel import par
from src.core.supabase import get_service_client
from src.modules.auth.schemas import Profile, Role
from src.modules.leads.stages import CLOSED, STAGES
from src.modules.leads.value import decimal_value
from src.modules.targets.service import _stage_probabilities

FUNNEL = [s for s in STAGES if s not in CLOSED] + ["closed_won"]
LEAD_FIELDS = "id,owner_id,stage,pipeline,source,lost_reason,created_at,closed_at,value_band,estimate_amount,quote_amount,paid_amount"


def _range(start: str | None, end: str | None) -> tuple[date, date]:
    try:
        to = date.fromisoformat(end) if end else today_ist()
        frm = date.fromisoformat(start) if start else to.replace(day=1)
    except ValueError as exc:
        raise AppError("Dates must look like 2026-11-01.", status_code=422) from exc
    if frm > to:
        raise AppError("The start date is after the end date.", status_code=422)
    if (to - frm).days > 731:
        raise AppError("Pick a range of two years or less.", status_code=422)
    return frm, to


def build(leads: list[dict], stage_moves: list[dict], probs: dict[str, int], frm: date, to: date) -> dict:
    """Pure: the report from the rows (tested without a database)."""
    lo = datetime.combine(frm, time.min, tzinfo=IST).isoformat()
    hi = datetime.combine(to + timedelta(days=1), time.min, tzinfo=IST).isoformat()

    def within(ts: str | None) -> bool:
        return bool(ts) and lo <= datetime.fromisoformat(ts).astimezone(IST).isoformat() < hi

    # pipeline now (open deals, whatever the dates)
    by_stage: dict[str, dict] = {}
    unweighted = weighted = Decimal("0")
    for lead in leads:
        if lead["stage"] in CLOSED:
            continue
        v = decimal_value(lead)
        p = probs.get(lead["stage"], 0)
        row = by_stage.setdefault(lead["stage"], {"stage": lead["stage"], "count": 0, "value": Decimal("0"), "weighted": Decimal("0"), "probability": p})
        row["count"] += 1
        row["value"] += v
        row["weighted"] += v * p / 100
        unweighted += v
        weighted += v * p / 100
    pipeline = [
        {**r, "value": float(to_money(r["value"])), "weighted": float(to_money(r["weighted"]))}
        for r in sorted(by_stage.values(), key=lambda r: (STAGES + list(by_stage)).index(r["stage"]))
    ]

    # what happened in the range
    created = [lead for lead in leads if within(lead.get("created_at"))]
    won = [lead for lead in leads if lead["stage"] == "closed_won" and within(lead.get("closed_at"))]
    lost = [lead for lead in leads if lead["stage"] == "closed_lost" and within(lead.get("closed_at"))]
    reached: dict[str, set] = {s: set() for s in FUNNEL}
    reached["new_lead"] |= {lead["id"] for lead in created if (lead.get("pipeline") or "new_business") == "new_business"}
    for m in stage_moves:
        to_stage = (m.get("meta") or {}).get("to")
        if to_stage in reached:
            reached[to_stage].add(m["lead_id"])
    funnel = [{"stage": s, "count": len(reached[s])} for s in FUNNEL]

    reasons = Counter((lead.get("lost_reason") or "Not given") for lead in lost)
    sources: dict[str, dict] = {}
    for lead in created:
        s = sources.setdefault(lead.get("source") or "Not given", {"source": lead.get("source") or "Not given", "leads": 0, "won": 0, "wonValue": Decimal("0")})
        s["leads"] += 1
        if lead["stage"] == "closed_won":
            s["won"] += 1
            s["wonValue"] += to_money(lead.get("paid_amount") or 0)
    won_value = sum((to_money(lead.get("paid_amount") or 0) for lead in won), Decimal("0"))
    closed = len(won) + len(lost)
    return {
        "from": frm.isoformat(), "to": to.isoformat(),
        "pipeline": pipeline,
        "forecast": {"open": sum(r["count"] for r in pipeline), "unweighted": float(to_money(unweighted)), "weighted": float(to_money(weighted))},
        "conversion": {"created": len(created), "won": len(won), "lost": len(lost), "wonValue": float(won_value), "winRate": round(len(won) / closed * 100, 1) if closed else None},
        "funnel": funnel,
        "lostReasons": [{"reason": r, "count": n} for r, n in reasons.most_common()],
        "sources": sorted(({**s, "wonValue": float(s["wonValue"])} for s in sources.values()), key=lambda s: -s["leads"]),
    }


def report(user: Profile, start: str | None, end: str | None, owner_id: str | None) -> dict:
    if user.role not in (Role.ADMIN, Role.SALES_MANAGER):
        raise ForbiddenError("Reports are for managers and admins.")
    frm, to = _range(start, end)
    owners = visible_owner_ids(user)
    if owner_id:
        if owners is not None and owner_id not in owners:
            raise ForbiddenError("That person is not in your team.")
        owners = [owner_id]

    def load() -> dict:
        db = get_service_client()
        q = db.table("leads").select(LEAD_FIELDS)
        if owners is not None:
            q = q.in_("owner_id", owners or ["00000000-0000-0000-0000-000000000000"])
        lo = datetime.combine(frm, time.min, tzinfo=IST).isoformat()
        hi = datetime.combine(to + timedelta(days=1), time.min, tzinfo=IST).isoformat()
        leads, moves = par(
            lambda: q.limit(10000).execute().data,
            lambda: db.table("activities").select("lead_id,meta").eq("kind", "stage_change").gte("created_at", lo).lt("created_at", hi).limit(20000).execute().data,
        )
        ids = {lead["id"] for lead in leads}
        return build(leads, [m for m in moves if m["lead_id"] in ids], _stage_probabilities(), frm, to)

    return cache.memo("reports", user.id, {"f": frm.isoformat(), "t": to.isoformat(), "o": owner_id}, 60, load)
