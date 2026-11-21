from datetime import date
from decimal import Decimal as D

from src.modules.targets import service
from src.modules.leads.value import deal_value, value_source


def card(target, won, pipeline=(), wins=(), lost=0):
    return service.build_card(D(target), D(won), [(D(v), p) for v, p in pipeline], [D(w) for w in wins], lost)


def test_gap_weighted_pipeline_and_shortfall():
    c = card(1_000_000, 400_000, pipeline=[(500_000, 50), (200_000, 90)])  # weighted 250k + 180k = 430k
    assert c["gap"] == 600_000 and c["weighted"] == 430_000 and c["shortfall"] == 170_000
    assert c["progress"] == 0.4


def test_healthy_means_unweighted_pipeline_is_about_three_times_the_gap():
    assert card(1_000_000, 0, pipeline=[(3_000_000, 10)])["healthy"] is True
    assert card(1_000_000, 0, pipeline=[(2_900_000, 90)])["healthy"] is False
    assert card(1_000_000, 1_200_000)["healthy"] is True  # target reached: nothing to cover


def test_suggestion_uses_the_executives_own_average_deal_and_win_rate():
    c = card(1_000_000, 0, pipeline=[], wins=[200_000, 300_000, 250_000], lost=7)  # avg 250k, win rate 30%
    assert c["dealsNeeded"] == 4 and c["leadsNeeded"] == 14 and "30%" in c["suggestion"]
    assert c["avgDeal"] == 250_000 and c["winRate"] == 0.3


def test_suggestions_for_the_special_cases():
    assert "No target" in card(0, 0)["suggestion"]
    assert "Target reached" in card(100, 150)["suggestion"]
    assert "covers the gap" in card(100, 0, pipeline=[(1000, 90)])["suggestion"]
    assert "first deals" in card(1_000_000, 0)["suggestion"]  # no history yet: honest, not invented


def test_progress_never_passes_one_and_a_zero_target_is_zero():
    assert card(100, 500)["progress"] == 1.0 and card(0, 500)["progress"] == 0.0


def test_months():
    assert service.next_month(date(2026, 12, 15)) == date(2027, 1, 1)
    assert service.parse_month("2026-11") == date(2026, 11, 1)
    import pytest
    from src.core.errors import AppError
    with pytest.raises(AppError):
        service.parse_month("nov")


def test_deal_value_uses_the_best_figure_we_have():
    base = {"value_band": "1_5l"}
    assert deal_value(base) == 300_000 and value_source(base) == "rough band"
    assert deal_value({**base, "estimate_amount": 450_000}) == 450_000
    assert deal_value({**base, "estimate_amount": 450_000, "quote_amount": 420_000}) == 420_000
    assert deal_value({**base, "quote_amount": 420_000, "paid_amount": 400_000}) == 400_000
    assert value_source({**base, "quote_amount": 1}) == "quoted"
    assert deal_value({}) is None
