from datetime import date, datetime

from src.core.dates import IST
from src.modules.tasks.service import _sort_time, bucket_for, is_client_requested

TODAY = date(2026, 11, 24)
NOW = datetime(2026, 11, 24, 15, 0, tzinfo=IST)


def test_client_requested_from_flag_or_old_title():
    assert is_client_requested({"client_requested": True})
    assert is_client_requested({"title": "Call back (client requested)"})
    assert not is_client_requested({"title": "Call again"})


def test_due_time_passed_today_is_missed():
    assert bucket_for(TODAY, TODAY, datetime(2026, 11, 24, 14, 0, tzinfo=IST), NOW) == "overdue"
    assert bucket_for(TODAY, TODAY, datetime(2026, 11, 24, 16, 0, tzinfo=IST), NOW) == "today"
    assert bucket_for(TODAY, TODAY) == "today"  # no time: due any time today


def test_client_requested_sorted_first_then_by_time():
    items = [
        {"client_requested": False, "due_date": "2026-11-24", "due_at": "2026-11-24T10:00:00+05:30"},
        {"client_requested": True, "due_date": "2026-11-24", "due_at": None},
        {"client_requested": False, "due_date": "2026-11-24", "due_at": None},
        {"client_requested": True, "due_date": "2026-11-24", "due_at": "2026-11-24T09:00:00+05:30"},
    ]
    items.sort(key=lambda t: (not t["client_requested"], _sort_time(t)))
    assert [(t["client_requested"], t["due_at"]) for t in items] == [
        (True, "2026-11-24T09:00:00+05:30"), (True, None), (False, "2026-11-24T10:00:00+05:30"), (False, None),
    ]
