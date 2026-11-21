import hashlib
import hmac
from datetime import date

import pytest

from src.core import schema
from src.core.dates import next_business_day
from src.core.errors import AppError
from src.core.keys import company_key, email_key, phone_key
from src.modules.auth.service import normalize_identifier
from src.modules.imports import service as imports
from src.modules.imports.schemas import ImportRow
from src.modules.leads.stages import POSITION, REQUIRED_INPUTS, moves_forward
from src.modules.whatsapp import service as wa


def test_phone_key_matches_formats():
    assert phone_key("+91 98765 43210") == phone_key("09876543210") == phone_key("9876543210") == "9876543210"
    assert phone_key("12") is None and phone_key(None) is None


def test_email_and_company_keys():
    assert email_key(" A@B.Co ") == "a@b.co" and email_key("") is None
    assert company_key("Tata Sons Pvt. Ltd.") == company_key("tata sons pvt ltd")


@pytest.mark.parametrize(
    "d,expected",
    [(date(2026, 11, 19), date(2026, 11, 20)), (date(2026, 11, 20), date(2026, 11, 23)), (date(2026, 11, 22), date(2026, 11, 23))],
)
def test_next_business_day_skips_weekend(d, expected):
    assert next_business_day(d) == expected


def test_camelize_keeps_camel_keys():
    out = schema.camelize({"due_today": 1, "dueToday": 2, "rows": [{"lead_id": 3}]})
    assert out == {"dueToday": 2, "rows": [{"leadId": 3}]}


def test_normalize_identifier():
    assert normalize_identifier(" A@B.co ") == ("email", "a@b.co")
    assert normalize_identifier("98765 43210") == ("phone", "+919876543210")
    assert normalize_identifier("+91-98765-43210") == ("phone", "+919876543210")
    with pytest.raises(AppError):
        normalize_identifier("12345")


def test_auto_advance_only_moves_forward_and_never_when_closed():
    assert moves_forward("new_lead", "connected")
    assert not moves_forward("meeting_scheduled", "connected")
    assert not moves_forward("connected", "connected")
    assert not moves_forward("closed_lost", "connected")
    assert not moves_forward("quotation_sent", "closed_won")


def test_stage_order_and_required_inputs():
    assert POSITION["new_lead"] < POSITION["connected"] < POSITION["closed_won"]
    assert "deliveryDate" in REQUIRED_INPUTS["requirement_received"]


def test_webhook_signature(monkeypatch):
    monkeypatch.setattr(wa.settings, "WHATSAPP_APP_SECRET", "s3cret")
    raw = b'{"entry": []}'
    good = "sha256=" + hmac.new(b"s3cret", raw, hashlib.sha256).hexdigest()
    assert wa.valid_signature(raw, good)
    assert not wa.valid_signature(raw, "sha256=deadbeef")
    assert not wa.valid_signature(raw, None)
    monkeypatch.setattr(wa.settings, "WHATSAPP_APP_SECRET", "")
    assert not wa.valid_signature(raw, good)  # no secret configured: accept nothing


# --- import ------------------------------------------------------------------------------------

def test_parse_csv_with_blank_and_duplicate_headers():
    csv_bytes = "Company,Name,Name\nAcme,Asha,x\n,,\nZen,Raj,y\n".encode()
    out = imports.parse_file("leads.csv", csv_bytes)
    assert out["headers"] == ["Company", "Name", "Name (2)"] and out["total"] == 2
    assert out["rows"][1]["Company"] == "Zen"


def test_parse_rejects_other_types():
    with pytest.raises(AppError):
        imports.parse_file("leads.pdf", b"x")


def test_parse_xlsx():
    from io import BytesIO

    from openpyxl import Workbook

    wb = Workbook()
    wb.active.append(["Company", "Phone"])
    wb.active.append(["Acme", 9876543210])
    buf = BytesIO()
    wb.save(buf)
    out = imports.parse_file("a.xlsx", buf.getvalue())
    assert out["rows"] == [{"Company": "Acme", "Phone": "9876543210"}]


def test_row_validation():
    ok_row, errs = imports._normalise(ImportRow(company_name="Acme", contact_name="Asha", phone="98765 43210", value_band="₹1–5L"))
    assert not errs and ok_row["value_band"] == "1_5l"
    _, errs = imports._normalise(ImportRow(company_name="Acme"))
    assert "Contact name is missing" in errs and "Phone or email is needed" in errs
    _, errs = imports._normalise(ImportRow(company_name="A", contact_name="B", email="nope"))
    assert "Email looks wrong" in errs
    _, errs = imports._normalise(ImportRow(company_name="A", contact_name="B", phone="12"))
    assert "Mobile number must be 10 digits" in errs
