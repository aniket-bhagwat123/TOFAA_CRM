"""Dates in India Standard Time. The CRM runs for an Indian sales team; 'today' means IST today."""
from datetime import date, datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))


def now_ist() -> datetime:
    return datetime.now(IST)


def today_ist() -> date:
    return now_ist().date()


def next_business_day(d: date | None = None) -> date:
    """Next Monday-Friday after `d` (default: today)."""
    d = (d or today_ist()) + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d
