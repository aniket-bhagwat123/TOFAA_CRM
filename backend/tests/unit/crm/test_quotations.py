from datetime import date
from decimal import Decimal as D

import pytest
from pydantic import ValidationError

from src.modules.auth.schemas import Profile, Role
from src.modules.quotations import pdf, schemas, service


def test_totals_round_to_paise_and_apply_the_discount():
    sub, disc, total = service.totals([(D("200"), D("2450")), (D("1"), D("15000"))], D("5"))
    assert (sub, disc, total) == (D("505000.00"), D("25250.00"), D("479750.00"))
    sub, disc, total = service.totals([(D("3"), D("33.33"))], D("10"))
    assert sub == D("99.99") and disc == D("10.00") and total == D("89.99")


def test_no_discount_means_total_equals_subtotal():
    assert service.totals([(D("2"), D("100"))], D("0")) == (D("200.00"), D("0.00"), D("200.00"))


@pytest.mark.parametrize(
    "role,pct,limit,expected",
    [
        (Role.SALES_EXECUTIVE, D("5"), D("5"), "ready"),               # exactly at the limit: allowed
        (Role.SALES_EXECUTIVE, D("5.01"), D("5"), "pending_approval"),  # above: goes to the manager
        (Role.SALES_EXECUTIVE, D("0"), D("0"), "ready"),
        (Role.SALES_EXECUTIVE, D("1"), D("0"), "pending_approval"),     # no limit set means no discount allowed
        (Role.SALES_MANAGER, D("40"), D("0"), "approved"),
        (Role.ADMIN, D("40"), D("0"), "approved"),
    ],
)
def test_discount_status(role, pct, limit, expected):
    assert service.status_for(role, pct, limit) == expected


def test_quote_numbers_are_short_and_versioned():
    assert service.quote_number("abcdef12-0000-0000-0000-000000000000", 3) == "Q-ABCDEF-V3"


def test_item_validation():
    ok = schemas.QuotationCreate.model_validate({"items": [{"description": "Hamper", "quantity": 10, "unitPrice": 250}], "discountPct": 5})
    assert ok.discount_pct == D("5")
    for bad in (
        {"items": []},
        {"items": [{"description": "x", "quantity": 0, "unitPrice": 1}]},
        {"items": [{"description": "x", "quantity": 1, "unitPrice": -5}]},
        {"items": [{"description": "x", "quantity": 1, "unitPrice": 1}], "discountPct": 101},
        {"items": [{"description": " ", "quantity": 1, "unitPrice": 1}]} if False else {"items": [{"description": "", "quantity": 1, "unitPrice": 1}]},
    ):
        with pytest.raises(ValidationError):
            schemas.QuotationCreate.model_validate(bad)


def test_who_may_decide(monkeypatch):
    mgr = Profile(id="m1", role=Role.SALES_MANAGER)
    monkeypatch.setattr(service, "team_ids", lambda actor: ["m1", "e1"])
    assert service.can_decide(mgr, "e1") and not service.can_decide(mgr, "someone-else")
    assert service.can_decide(Profile(id="a", role=Role.ADMIN), "anyone")
    assert not service.can_decide(Profile(id="e1", role=Role.SALES_EXECUTIVE), "e1")  # nobody approves their own discount


def test_the_pdf_renders_with_long_text_and_non_latin_characters():
    out = pdf.render(
        number="Q-AB12CD-V1", created=date(2026, 11, 20), valid_days=15,
        lead={"company": {"name": "Momentum Tech — Solutions"}, "contact": {"name": "Maya Patel नमस्ते", "phone": "6505550842"}},
        items=[{"description": "Hamper " * 30, "quantity": 200, "unit_price": 2450}, {"description": "Delivery", "quantity": 1, "unit_price": 15000}],
        subtotal=505000, discount_pct=5, discount_amount=25250, total=479750,
        template={"intro": "Thank you.", "terms": "1. Prices in INR.", "footer": "Regards"}, notes="₹ amounts are final",
    )
    assert out.startswith(b"%PDF-") and len(out) > 1500
