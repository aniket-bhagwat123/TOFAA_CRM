from datetime import date

from src.modules.projects.service import summarize

TODAY = date(2026, 11, 21)


def test_summary_counts_active_value_overdue_and_this_month():
    rows = [
        {"stage": "project_follow_up", "estimate_amount": 1000, "next_follow_up": "2026-11-20"},
        {"stage": "project_negotiation", "quote_amount": 5000, "next_follow_up": "2026-11-25"},
        {"stage": "closed_won", "paid_amount": 7000, "closed_at": "2026-11-05T10:00:00+05:30"},
        {"stage": "closed_won", "paid_amount": 9000, "closed_at": "2026-10-30T10:00:00+05:30"},  # last month
        {"stage": "closed_lost", "closed_at": "2026-11-02T10:00:00+05:30"},
    ]
    s = summarize(rows, TODAY)
    assert s["active"] == 2
    assert s["open_value"] == 6000
    assert s["overdue"] == 1
    assert s["won_this_month"] == {"count": 1, "value": 7000}
    assert s["lost_this_month"] == 1
    assert {b["stage"]: b["count"] for b in s["by_stage"]}["project_negotiation"] == 1
