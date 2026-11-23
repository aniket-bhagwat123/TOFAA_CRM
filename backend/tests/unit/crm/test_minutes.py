from src.modules.minutes.service import validate


def errors(**over):
    base = dict(note="Agreed on 200 hampers", quantity="200", budget="500000")
    return {e["field"] for e in validate(**{**base, **over})}


def test_a_complete_form_has_no_problems():
    assert errors() == set()


def test_the_summary_is_required():
    assert errors(note="  ") == {"note"}
    assert errors(note=None) == {"note"}


def test_the_requirement_is_optional():
    assert errors(quantity=None, budget=None) == set()
    assert errors(quantity="", budget=" ") == set()


def test_quantity_and_budget_must_be_positive_when_given():
    assert errors(quantity="0") == {"quantity"}
    assert errors(quantity="-4") == {"quantity"}
    assert errors(budget="abc") == {"budget"}


def test_everything_missing_reports_only_the_summary():
    assert errors(note=None, quantity=None, budget=None) == {"note"}
