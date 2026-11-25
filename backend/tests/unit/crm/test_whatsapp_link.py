"""The quotation on WhatsApp: a message with a "View quotation" button that opens the PDF link."""
from datetime import timedelta
from types import SimpleNamespace

import pytest

from src.core.dates import now_ist
from src.core.errors import AppError
from src.modules.whatsapp import service as wa

BASE = "https://crm.tofaa.in/s/"
LINK = BASE + "AB12CD34"
VALUES = ["Sarah", "Q-1", "Horizon", "Rs. 10"]
USER = SimpleNamespace(id="u1")


def test_inside_window_is_an_interactive_button_message():
    p = wa.link_payload("Hello", LINK, in_window=True, template="", language="en", values=VALUES, base=BASE)
    assert p["type"] == "interactive" and p["interactive"]["type"] == "cta_url"
    assert p["interactive"]["body"]["text"] == "Hello"
    assert p["interactive"]["action"]["parameters"] == {"display_text": "View quotation", "url": LINK}


def test_outside_window_uses_template_with_link_code_on_the_button():
    p = wa.link_payload("Hello", LINK, in_window=False, template="quotation_link", language="en", values=VALUES, base=BASE)
    assert p["template"]["name"] == "quotation_link"
    body, button = p["template"]["components"]
    assert [x["text"] for x in body["parameters"]] == VALUES
    assert button == {"type": "button", "sub_type": "url", "index": "0", "parameters": [{"type": "text", "text": "AB12CD34"}]}


@pytest.mark.parametrize("template,link", [("", LINK), ("quotation_link", "https://storage.example/file.pdf?sig=1")])
def test_outside_window_needs_template_and_a_short_link(template, link):
    with pytest.raises(AppError) as e:
        wa.link_payload("Hello", link, in_window=False, template=template, language="en", values=VALUES, base=BASE)
    assert e.value.data["code"] == "template_required"


def test_quotation_text_has_everything():
    t = wa.quotation_text("Sarah", "Q-1", "Horizon Retail", "Rs. 10")
    assert "Hello Sarah" in t and "Q-1" in t and "Horizon Retail" in t and "Total: Rs. 10" in t and "button below" in t


class _Res:
    def __init__(self, body):
        self.status_code, self._body, self.text = 200, body, str(body)

    def json(self):
        return self._body


class _DB:
    def __init__(self):
        self.rows = []

    def table(self, _):
        return self

    def insert(self, row):
        self.rows.append(row)
        return self

    def execute(self):
        return self


def test_send_link_message_posts_and_saves(monkeypatch):
    calls, db = [], _DB()
    monkeypatch.setattr(wa.settings, "WHATSAPP_TOKEN", "t")
    monkeypatch.setattr(wa.settings, "WHATSAPP_PHONE_NUMBER_ID", "123")
    monkeypatch.setattr(wa.leads, "get_lead_row", lambda u, lid: {"company_id": "c1", "contact": {"phone": "9822063914"}})
    monkeypatch.setattr(wa, "get_service_client", lambda: db)
    monkeypatch.setattr(wa, "add_activity", lambda *a, **k: None)
    monkeypatch.setattr(wa, "_last_inbound", lambda lid: now_ist() - timedelta(hours=1))
    monkeypatch.setattr(wa.httpx, "post", lambda url, **kw: calls.append((url, kw)) or _Res({"messages": [{"id": "wamid.1"}]}))
    out = wa.send_link_message(USER, "L1", text="Hello", link=LINK, values=VALUES, base=BASE)
    assert out == {"mode": "api", "url": None, "button": True}
    assert calls[0][0].endswith("/123/messages") and calls[0][1]["json"]["type"] == "interactive"
    assert db.rows[0]["provider_id"] == "wamid.1" and LINK in db.rows[0]["body"]
