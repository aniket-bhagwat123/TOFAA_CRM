from datetime import date, datetime, timedelta

from src.core.dates import IST
from src.modules.tasks.service import bucket_for

TODAY = date(2026, 11, 18)
NOON = datetime(2026, 11, 18, 12, 0, tzinfo=IST)


def test_columns_by_due_date():
    assert bucket_for(TODAY - timedelta(days=3), TODAY) == "overdue"
    assert bucket_for(TODAY, TODAY) == "today"
    assert bucket_for(TODAY + timedelta(days=1), TODAY) == "tomorrow"
    assert bucket_for(TODAY + timedelta(days=2), TODAY) == "this_week"
    assert bucket_for(TODAY + timedelta(days=7), TODAY) == "this_week"
    assert bucket_for(TODAY + timedelta(days=8), TODAY) is None


def test_meeting_earlier_today_is_missed():
    assert bucket_for(TODAY, TODAY, NOON - timedelta(hours=2), NOON) == "overdue"
    assert bucket_for(TODAY, TODAY, NOON + timedelta(hours=2), NOON) == "today"


def test_lost_from_reads_the_latest_move_into_lost():
    from src.modules.leads.stages import lost_from

    timeline = [
        {"kind": "note", "meta": {}},
        {"kind": "stage_change", "meta": {"from": "connected", "to": "closed_lost"}},
        {"kind": "stage_change", "meta": {"from": "closed_lost", "to": "quotation_sent"}},
        {"kind": "stage_change", "meta": {"from": "quotation_sent", "to": "closed_lost"}},
    ]
    assert lost_from(timeline) == "connected"
    assert lost_from([{"kind": "note", "meta": {}}]) is None
