"""Working hours: a follow-up never lands at night or on a weekend. One that would is moved to the next working morning.

Default Monday-Friday, 09:30-18:30 IST (the same business days as next_business_day). Admins can change it with the
"workingHours" setting: {"start": "09:30", "end": "18:30", "days": [0, 1, 2, 3, 4]} (0 = Monday).
"""
from datetime import date, datetime, time, timedelta

from src.core import app_settings
from src.core.dates import IST, now_ist

DEFAULT = {"start": "09:30", "end": "18:30", "days": [0, 1, 2, 3, 4]}


def _hours() -> tuple[time, time, set[int]]:
    cfg = {**DEFAULT, **(app_settings.get("workingHours") or {})}
    try:
        start, end = time.fromisoformat(cfg["start"]), time.fromisoformat(cfg["end"])
        days = {int(d) for d in cfg["days"]} or set(DEFAULT["days"])
    except (TypeError, ValueError, KeyError):
        start, end, days = time(9, 30), time(18, 30), set(DEFAULT["days"])
    return start, end, days


def is_working(at: datetime, hours: tuple[time, time, set[int]] | None = None) -> bool:
    start, end, days = hours or _hours()
    local = at.astimezone(IST)
    return local.weekday() in days and start <= local.time() < end


def next_working_morning(at: datetime, hours: tuple[time, time, set[int]] | None = None) -> datetime:
    """The start of the next working day at or after `at` (the same day when `at` is before opening on a working day)."""
    start, end, days = hours or _hours()
    local = at.astimezone(IST)
    d = local.date()
    if local.time() >= start:  # opening time has passed today: try tomorrow
        d += timedelta(days=1)
    while d.weekday() not in days:
        d += timedelta(days=1)
    return datetime.combine(d, start, tzinfo=IST)


def schedule(due: date, due_at: datetime | None, now: datetime | None = None) -> tuple[date, datetime | None]:
    """Where a new or moved follow-up really goes.

    - A time outside working hours moves to the next working morning ("In 2 hrs" at 5:30 PM -> 9:30 AM next working day).
    - A follow-up for today with no time, created after hours (or on a day off), moves to the next working morning.
    Anything else is kept as asked.
    """
    hours = _hours()
    now = now or now_ist()
    if due_at:
        if is_working(due_at, hours):
            return due, due_at
        at = next_working_morning(due_at, hours)
        return at.date(), at
    if due <= now.date() and not is_working(now, hours) and now.astimezone(IST).time() >= hours[0]:
        at = next_working_morning(now, hours)
        return at.date(), at
    if due <= now.date() and now.astimezone(IST).weekday() not in hours[2]:
        at = next_working_morning(now, hours)
        return at.date(), at
    return due, None
