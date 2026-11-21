from datetime import date

from src.modules.minutes.service import validate


def errors(**over):
    base = dict(note="Agreed on 200 hampers", has_file=False, occasion="Diwali", quantity="200", budget="500000", delivery_date="2026-12-01", next_follow_up=date(2026, 11, 25))
    return {e["field"] for e in validate(**{**base, **over})}


def test_a_complete_form_has_no_problems():
    assert errors() == set()


def test_minutes_need_text_or_a_file():
    assert errors(note="  ") == {"note"}
    assert errors(note=None, has_file=True) == set()


def test_requirement_inputs_must_be_present_and_positive():
    assert errors(occasion=" ") == {"occasion"}
    assert errors(quantity="0") == {"quantity"}
    assert errors(quantity="-4") == {"quantity"}
    assert errors(budget="abc") == {"budget"}
    assert errors(delivery_date=None) == {"deliveryDate"}
    assert errors(next_follow_up=None) == {"nextFollowUp"}


def test_everything_missing_reports_every_field_at_once():
    assert errors(note=None, occasion=None, quantity=None, budget=None, delivery_date=None, next_follow_up=None) == {
        "note", "occasion", "quantity", "budget", "deliveryDate", "nextFollowUp",
    }
