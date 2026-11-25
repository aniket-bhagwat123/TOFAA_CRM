from datetime import date, datetime

import pytest

from src.core import app_settings
from src.core.dates import IST
from src.core.working_hours import schedule, with_time


@pytest.fixture(autouse=True)
def default_hours(monkeypatch):
    monkeypatch.setattr(app_settings, "get", lambda key: None)


def at(y, m, d, h, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=IST)


TUE = date(2026, 11, 24)  # a Tuesday


def test_time_inside_hours_is_kept():
    assert schedule(TUE, at(2026, 11, 24, 16), at(2026, 11, 24, 14)) == (TUE, at(2026, 11, 24, 16))


def test_evening_time_moves_to_next_morning():
    assert schedule(TUE, at(2026, 11, 24, 19, 30), at(2026, 11, 24, 17, 30)) == (date(2026, 11, 25), at(2026, 11, 25, 9, 30))


def test_early_morning_time_moves_to_opening_same_day():
    assert schedule(TUE, at(2026, 11, 24, 7), at(2026, 11, 24, 6)) == (TUE, at(2026, 11, 24, 9, 30))


def test_friday_night_goes_to_monday():
    assert schedule(date(2026, 11, 27), at(2026, 11, 27, 21), at(2026, 11, 27, 20)) == (date(2026, 11, 30), at(2026, 11, 30, 9, 30))


def test_today_without_time_created_after_hours_moves():
    assert schedule(TUE, None, at(2026, 11, 24, 20)) == (date(2026, 11, 25), at(2026, 11, 25, 9, 30))


def test_today_without_time_created_before_opening_stays_today():
    assert schedule(TUE, None, at(2026, 11, 24, 8)) == (TUE, None)


def test_future_day_without_time_is_kept():
    assert schedule(date(2026, 11, 26), None, at(2026, 11, 24, 22)) == (date(2026, 11, 26), None)


def test_today_on_a_sunday_moves_to_monday():
    assert schedule(date(2026, 11, 29), None, at(2026, 11, 29, 12)) == (date(2026, 11, 30), at(2026, 11, 30, 9, 30))


def test_day_only_gets_ten_am():
    assert with_time(date(2026, 11, 26), None, at(2026, 11, 24, 15)) == (date(2026, 11, 26), at(2026, 11, 26, 10))


def test_today_after_ten_gets_next_half_hour():
    assert with_time(TUE, None, at(2026, 11, 24, 14, 10)) == (TUE, at(2026, 11, 24, 15))


def test_today_late_evening_goes_to_next_morning():
    assert with_time(TUE, None, at(2026, 11, 24, 18, 20)) == (date(2026, 11, 25), at(2026, 11, 25, 9, 30))


def test_given_time_is_kept():
    assert with_time(TUE, at(2026, 11, 24, 16), at(2026, 11, 24, 14)) == (TUE, at(2026, 11, 24, 16))
