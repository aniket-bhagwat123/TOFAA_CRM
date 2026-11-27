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
        (Role.KAM, D("5"), D("5"), "ready"),               # exactly at the limit: allowed
        (Role.KAM, D("5.01"), D("5"), "pending_approval"),  # above: goes to the manager
        (Role.KAM, D("0"), D("0"), "ready"),
        (Role.KAM, D("1"), D("0"), "pending_approval"),     # no limit set means no discount allowed
        (Role.SALES_MANAGER, D("40"), D("0"), "approved"),
        (Role.ADMIN, D("40"), D("0"), "approved"),
    ],
)
def test_discount_status(role, pct, limit, expected):
    assert service.status_for(role, pct, limit) == expected


def test_quote_numbers_are_short_and_versioned():
    assert service.quote_number("abcdef12-0000-0000-0000-000000000000", 3) == "Q-ABCDEF-V3"


def test_package_validation():
    ok = schemas.QuotationCreate.model_validate({
        "packages": [{"name": " CEO-level requirement ", "unitPrice": 10000, "quantity": 100,
                      "items": [{"name": "book", "description": "Leather diary book"}, {"name": "Pen"}], "photos": ["lead-1/a.jpg"]}],
    })
    assert ok.packages[0].name == "CEO-level requirement"
    assert not hasattr(ok, "discount_pct") and not hasattr(ok, "valid_days")  # no discount or validity any more
    assert [i.name for i in ok.packages[0].items] == ["book", "Pen"]
    pkg = {"name": "Gift", "unitPrice": 1, "quantity": 1}
    for bad in (
        {"packages": []},
        {"packages": [{**pkg, "quantity": 0}]},
        {"packages": [{**pkg, "unitPrice": -5}]},
        {"packages": [{**pkg, "name": "   "}]},
        {"packages": [{**pkg, "items": [{"name": ""}]}]},
    ):
        with pytest.raises(ValidationError):
            schemas.QuotationCreate.model_validate(bad)


def test_photos_must_belong_to_the_lead():
    good = schemas.PackageIn(name="A", unit_price=D("1"), quantity=D("1"), photos=["lead-1/x.jpg"])
    service._check_photo_paths("lead-1", [good])
    for path in ("lead-2/x.jpg", "lead-1/../lead-2/x.jpg"):
        with pytest.raises(Exception):
            service._check_photo_paths("lead-1", [schemas.PackageIn(name="A", unit_price=D("1"), quantity=D("1"), photos=[path])])


def test_who_may_decide():
    mgr = Profile(id="m1", role=Role.SALES_MANAGER)
    assert service.can_decide(mgr, "e1") and service.can_decide(mgr, "someone-else")  # managers decide for everyone
    assert service.can_decide(Profile(id="a", role=Role.ADMIN), "anyone")
    assert not service.can_decide(Profile(id="e1", role=Role.KAM), "e1")  # nobody approves their own discount


def test_the_pdf_renders_with_long_text_and_non_latin_characters():
    out = pdf.render(
        number="Q-AB12CD-V1", created=date(2026, 11, 20),
        lead={"company": {"name": "Momentum Tech — Solutions"}, "contact": {"name": "Maya Patel नमस्ते", "phone": "6505550842"}},
        items=[{"description": "Hamper " * 30, "quantity": 200, "unit_price": 2450}, {"description": "Delivery", "quantity": 1, "unit_price": 15000}],
        subtotal=505000, discount_pct=5, discount_amount=25250, total=479750,
        template={"intro": "Thank you.", "terms": "1. Prices in INR.", "footer": "Regards"}, notes="₹ amounts are final",
    )
    assert out.startswith(b"%PDF-") and len(out) > 1500


def test_the_pdf_renders_requirement_packages_with_mockups():
    from io import BytesIO
    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (60, 40), (200, 30, 30)).save(buf, "PNG")
    packages = [
        {"name": "CEO-level requirement", "unit_price": 10000, "quantity": 100, "photo_paths": ["l/a.png", "l/missing.png"],
         "items": [{"name": "book", "description": "Leather diary book"}, {"name": "Pen", "description": None}]},
        {"name": "Staff kit", "unit_price": 500, "quantity": 400, "items": [], "photo_paths": []},
    ]
    out = pdf.render(
        number="Q-AB12CD-V2", created=date(2026, 11, 20), lead={"company": {"name": "Apex"}, "contact": {"name": "Vikram"}},
        items=[], packages=packages, photos={"l/a.png": buf.getvalue()}, subtotal=1200000, discount_pct=0, discount_amount=0, total=1200000,
        template=None, notes=None,
    )
    assert out.startswith(b"%PDF-") and len(out) > 1500
