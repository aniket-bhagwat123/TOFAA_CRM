from datetime import date

import pytest
from pydantic import ValidationError

from src.modules.agreements import pdf, schemas, service

PKG = {"name": "CEO kit", "unitPrice": 10000, "quantity": 100, "items": [{"name": "Diary", "description": "Leather"}]}


def test_commercials_add_transport_then_gst():
    t = service.commercials([{"quantity": 100, "unit_price": 10000}, {"quantity": 400, "unit_price": 500}], 5000, 18)
    assert t["units"] == 500 and t["base"] == 1_200_000 and t["avgRate"] == 2400
    assert t["gst"] == pytest.approx((1_200_000 + 5000) * 0.18) and t["total"] == pytest.approx(1_205_000 * 1.18)
    assert service.commercials([{"quantity": 1, "unit_price": 0}], 0, 0)["total"] == 0


def test_details_validation():
    ok = schemas.AgreementDetails.model_validate({"packages": [PKG], "scope": ["curation_design", "other", "other"], "scopeOther": "Event setup", "gstRate": 12})
    assert ok.scope == ["curation_design", "other"] and ok.gst_rate == 12 and ok.transportation == 0
    for bad in (
        {"packages": []},
        {"packages": [PKG], "scope": ["made_up"]},
        {"packages": [PKG], "gstRate": 7},
        {"packages": [PKG], "transportation": -1},
        {"packages": [PKG], "terms": [{"title": "", "body": "x"}]},
    ):
        with pytest.raises(ValidationError):
            schemas.AgreementDetails.model_validate(bad)


def test_default_terms_are_the_four_clauses():
    assert [t["title"] for t in schemas.DEFAULT_TERMS] == ["Prototype Approval", "Material Fidelity", "Fulfillment & Logistics", "Confidentiality"]


def test_the_agreement_pdf_renders():
    packages = [{"name": "CEO kit", "unit_price": 10000, "quantity": 100, "items": [{"name": "Diary", "description": "Leather"}], "photos": []}]
    details = {
        "packages": packages, "scope": ["curation_design", "custom_packaging", "other"], "scopeOther": "Event setup",
        "terms": schemas.DEFAULT_TERMS, "tofaaSignee": "Aniket", "clientSignee": "Vikram", "remarks": "Delivery in Pune.",
        "totals": service.commercials(packages, 5000, 18),
    }
    out = pdf.render(number="A-AB12CD", created=date(2026, 11, 24), lead={"company": {"name": "Apex"}, "contact": {"name": "Vikram"}},
                     details=details, scope_labels=schemas.SCOPE)
    assert out.startswith(b"%PDF-") and len(out) > 2000
