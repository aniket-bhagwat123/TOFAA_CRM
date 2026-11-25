"""Reports: KPIs against the previous period, trends over time (leads, wins, revenue), pipeline by stage, weighted
forecast, conversion funnel, team leaderboard, lost reasons and lead sources, for a date range."""
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
from src.core.soft_delete import live
from src.modules.auth.schemas import Profile, Role
from src.modules.leads.stages import CLIENT_STAGES, CLOSED, STAGES
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


def granularity(frm: date, to: date) -> str:
    """Trend buckets: days for a month or less, weeks up to ~4 months, months beyond."""
    days = (to - frm).days + 1
    return "day" if days <= 31 else "week" if days <= 120 else "month"


def bucket_start(d: date, gran: str, frm: date) -> date:
    """The bucket a date falls in (its first day, never before the range start)."""
    if gran == "week":
        d = d - timedelta(days=d.weekday())  # weeks start on Monday
    elif gran == "month":
        d = d.replace(day=1)
    return max(d, frm)


def buckets(frm: date, to: date, gran: str) -> list[date]:
    out, d = [], frm
    while d <= to:
        out.append(d)
        d = (d - timedelta(days=d.weekday()) + timedelta(days=7)) if gran == "week" else (
            (d.replace(day=1) + timedelta(days=32)).replace(day=1) if gran == "month" else d + timedelta(days=1))
    return out


def _local_day(ts: str | None) -> date | None:
    return datetime.fromisoformat(ts).astimezone(IST).date() if ts else None


def _summary(leads: list[dict], frm: date, to: date) -> dict:
    """Created / won / lost / won value / win rate for leads in a date range."""
    created = sum(1 for l in leads if (d := _local_day(l.get("created_at"))) and frm <= d <= to)
    won = [l for l in leads if l["stage"] == "closed_won" and (d := _local_day(l.get("closed_at"))) and frm <= d <= to]
    lost = sum(1 for l in leads if l["stage"] == "closed_lost" and (d := _local_day(l.get("closed_at"))) and frm <= d <= to)
    value = sum((to_money(l.get("paid_amount") or 0) for l in won), Decimal("0"))
    closed = len(won) + lost
    return {"created": created, "won": len(won), "lost": lost, "wonValue": float(value), "winRate": round(len(won) / closed * 100, 1) if closed else None}


def trend(leads: list[dict], frm: date, to: date) -> dict:
    """Per bucket: leads created, deals won, deals lost, revenue won. Every bucket is present, empty ones as zero."""
    gran = granularity(frm, to)
    rows = {b: {"start": b.isoformat(), "created": 0, "won": 0, "lost": 0, "wonValue": Decimal("0")} for b in buckets(frm, to, gran)}
    for l in leads:
        c = _local_day(l.get("created_at"))
        if c and frm <= c <= to:
            rows[bucket_start(c, gran, frm)]["created"] += 1
        e = _local_day(l.get("closed_at"))
        if e and frm <= e <= to and l["stage"] in CLOSED:
            r = rows[bucket_start(e, gran, frm)]
            if l["stage"] == "closed_won":
                r["won"] += 1
                r["wonValue"] += to_money(l.get("paid_amount") or 0)
            else:
                r["lost"] += 1
    return {"granularity": gran, "points": [{**r, "wonValue": float(r["wonValue"])} for r in rows.values()]}


def team(leads: list[dict], frm: date, to: date, names: dict[str, str]) -> list[dict]:
    """One row per salesperson: leads created, won (count and value), lost, win rate, and open pipeline today."""
    out: dict[str, dict] = {}
    for l in leads:
        oid = l.get("owner_id")
        if not oid:
            continue
        r = out.setdefault(oid, {"ownerId": oid, "name": names.get(oid) or "Unknown", "created": 0, "won": 0, "lost": 0,
                                 "wonValue": Decimal("0"), "openValue": Decimal("0"), "open": 0})
        c, e = _local_day(l.get("created_at")), _local_day(l.get("closed_at"))
        if c and frm <= c <= to:
            r["created"] += 1
        if l["stage"] == "closed_won" and e and frm <= e <= to:
            r["won"] += 1
            r["wonValue"] += to_money(l.get("paid_amount") or 0)
        elif l["stage"] == "closed_lost" and e and frm <= e <= to:
            r["lost"] += 1
        elif l["stage"] not in CLOSED:
            r["open"] += 1
            r["openValue"] += decimal_value(l)
    rows = []
    for r in out.values():
        closed = r["won"] + r["lost"]
        rows.append({**r, "wonValue": float(r["wonValue"]), "openValue": float(to_money(r["openValue"])),
                     "winRate": round(r["won"] / closed * 100, 1) if closed else None})
    return sorted(rows, key=lambda r: (-r["wonValue"], -r["won"], -r["created"], r["name"]))


def build(leads: list[dict], stage_moves: list[dict], probs: dict[str, int], frm: date, to: date, names: dict[str, str] | None = None) -> dict:
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
        pipe = "client" if lead["stage"] in CLIENT_STAGES else "new_business"  # which pipeline the stage belongs to
        row = by_stage.setdefault(lead["stage"], {"stage": lead["stage"], "pipeline": pipe, "count": 0, "valued": 0, "value": Decimal("0"), "weighted": Decimal("0"), "probability": p})
        row["count"] += 1
        row["valued"] += 1 if v > 0 else 0  # deals with a value (the rest are counted but add nothing)
        row["value"] += v
        row["weighted"] += v * p / 100
        unweighted += v
        weighted += v * p / 100
    pipeline = [
        {**r, "value": float(to_money(r["value"])), "weighted": float(to_money(r["weighted"]))}
        # new business first, in its stage order, then client projects in theirs
        for r in sorted(by_stage.values(), key=lambda r: (r["pipeline"] == "client", (STAGES + CLIENT_STAGES + list(by_stage)).index(r["stage"])))
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
    # A funnel only narrows: a lead that reached a later stage also passed every earlier one (Sampling is optional,
    # so a lead that went straight to Agreement still counts at Sampling). Count "reached this stage or further".
    furthest: dict[str, int] = {}
    for i, s_ in enumerate(FUNNEL):
        for lid in reached[s_]:
            furthest[lid] = max(furthest.get(lid, -1), i)
    funnel = [{"stage": s_, "count": sum(1 for f in furthest.values() if f >= i)} for i, s_ in enumerate(FUNNEL)]

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
    span = (to - frm).days + 1
    prev_to = frm - timedelta(days=1)
    prev_frm = prev_to - timedelta(days=span - 1)
    return {
        "from": frm.isoformat(), "to": to.isoformat(),
        # the same figures for the equal-length period just before, for the deltas on the KPI tiles
        "previous": {"from": prev_frm.isoformat(), "to": prev_to.isoformat(), **_summary(leads, prev_frm, prev_to)},
        "trend": trend(leads, frm, to),
        "team": team(leads, frm, to, names or {}),
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
        q = live(db.table("leads").select(LEAD_FIELDS))
        if owners is not None:
            q = q.in_("owner_id", owners or ["00000000-0000-0000-0000-000000000000"])
        lo = datetime.combine(frm, time.min, tzinfo=IST).isoformat()
        hi = datetime.combine(to + timedelta(days=1), time.min, tzinfo=IST).isoformat()
        leads, moves = par(
            lambda: q.limit(10000).execute().data,
            lambda: db.table("activities").select("lead_id,meta").eq("kind", "stage_change").gte("created_at", lo).lt("created_at", hi).limit(20000).execute().data,
        )
        ids = {lead["id"] for lead in leads}
        owner_ids = list({lead["owner_id"] for lead in leads if lead.get("owner_id")})
        names = {p["id"]: p["full_name"] for p in db.table("profiles").select("id,full_name").in_("id", owner_ids).execute().data} if owner_ids else {}
        return build(leads, [m for m in moves if m["lead_id"] in ids], _stage_probabilities(), frm, to, names)

    return cache.memo("reports", user.id, {"f": frm.isoformat(), "t": to.isoformat(), "o": owner_id}, 60, load)
