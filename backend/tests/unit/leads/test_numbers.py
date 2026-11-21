import pytest

from src.modules.leads.service import _positive_number
from src.modules.leads.stages import NUMERIC_INPUTS, REQUIRED_INPUTS


@pytest.mark.parametrize("value", [1, 250, 0.5, "12", "1500.75", 3.0])
def test_positive_numbers_are_accepted(value):
    assert _positive_number(value)


@pytest.mark.parametrize("value", [0, -3, "-3", "0", "abc", "", None, float("nan"), float("inf"), "1e999", [], {}])
def test_zero_negative_and_non_numbers_are_rejected(value):
    assert not _positive_number(value)


def test_the_amount_fields_are_the_ones_checked():
    needed = {f for fields in REQUIRED_INPUTS.values() for f in fields}
    assert NUMERIC_INPUTS <= needed
