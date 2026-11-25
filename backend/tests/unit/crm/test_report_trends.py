from datetime import date

from src.modules.reports import service as r


def test_granularity_by_range_length():
    assert r.granularity(date(2026, 11, 1), date(2026, 11, 30)) == "day"
    assert r.granularity(date(2026, 9, 1), date(2026, 11, 30)) == "week"
    assert r.granularity(date(2026, 4, 1), date(2026, 11, 30)) == "month"


def test_buckets_cover_the_range_without_gaps():
    assert len(r.buckets(date(2026, 11, 1), date(2026, 11, 30), "day")) == 30
    weeks = r.buckets(date(2026, 11, 4), date(2026, 11, 30), "week")  # a Wednesday start
    assert weeks[0] == date(2026, 11, 4) and weeks[1] == date(2026, 11, 9) and weeks[-1] == date(2026, 11, 30)
    months = r.buckets(date(2026, 4, 15), date(2026, 11, 30), "month")
    assert months[0] == date(2026, 4, 15) and months[1] == date(2026, 5, 1) and len(months) == 8


def lead(i, stage, created, closed=None, paid=None, owner="o1", **kw):
    return {"id": i, "owner_id": owner, "stage": stage, "pipeline": "new_business", "source": None, "lost_reason": None,
            "created_at": f"{created}T10:00:00+05:30", "closed_at": f"{closed}T10:00:00+05:30" if closed else None,
            "paid_amount": paid, "value_band": None, "estimate_amount": kw.get("estimate"), "quote_amount": None}


LEADS = [
    lead("a", "closed_won", "2026-11-02", "2026-11-10", 50000, owner="o1"),
    lead("b", "closed_lost", "2026-11-03", "2026-11-12", owner="o2"),
    lead("c", "new_lead", "2026-11-10", owner="o2", estimate=20000),
    lead("d", "closed_won", "2026-10-05", "2026-10-20", 30000, owner="o1"),  # previous month
]


def test_trend_puts_each_event_in_its_day():
    t = r.trend(LEADS, date(2026, 11, 1), date(2026, 11, 30))
    by_day = {p["start"]: p for p in t["points"]}
    assert t["granularity"] == "day" and len(t["points"]) == 30
    assert by_day["2026-11-10"]["won"] == 1 and by_day["2026-11-10"]["wonValue"] == 50000.0 and by_day["2026-11-10"]["created"] == 1
    assert by_day["2026-11-12"]["lost"] == 1
    assert sum(p["created"] for p in t["points"]) == 3


def test_previous_period_and_team():
    out = r.build(LEADS, [], {}, date(2026, 11, 1), date(2026, 11, 30), {"o1": "Asha", "o2": "Ravi"})
    assert out["previous"]["from"] == "2026-10-02" and out["previous"]["to"] == "2026-10-31"
    assert out["previous"]["won"] == 1 and out["previous"]["wonValue"] == 30000.0
    team = {t["name"]: t for t in out["team"]}
    assert out["team"][0]["name"] == "Asha"  # most revenue first
    assert team["Asha"]["won"] == 1 and team["Asha"]["winRate"] == 100.0
    assert team["Ravi"]["lost"] == 1 and team["Ravi"]["open"] == 1 and team["Ravi"]["openValue"] == 20000.0
