import hashlib
import hmac
from decimal import Decimal as D

import pytest
from fastapi.testclient import TestClient

from src.core.errors import AppError, ForbiddenError
from src.main import app
from src.modules.auth.schemas import Profile, Role
from src.modules.payments import service


def test_paid_in_full_confirms_and_less_is_partial():
    assert service.decide_status(D("1000"), D("1000")) == "confirmed"
    assert service.decide_status(D("1000"), D("1200")) == "confirmed"  # overpaid still closes the deal
    assert service.decide_status(D("1000"), D("999.99")) == "partial"


def test_erp_signature(monkeypatch):
    monkeypatch.setattr(service.settings, "ERP_WEBHOOK_SECRET", "s3cret")
    raw = b'{"invoiceNumber": "INV-1", "status": "paid"}'
    good = "sha256=" + hmac.new(b"s3cret", raw, hashlib.sha256).hexdigest()
    assert service.valid_signature(raw, good)
    assert not service.valid_signature(raw + b" ", good) and not service.valid_signature(raw, "sha256=00") and not service.valid_signature(raw, None)
    monkeypatch.setattr(service.settings, "ERP_WEBHOOK_SECRET", "")
    assert not service.valid_signature(raw, good)  # no secret configured: accept nothing


@pytest.fixture
def erp(monkeypatch):
    applied = []
    req = {"id": "r1", "amount": 1000, "amount_paid": 0, "status": "requested", "invoice_number": "INV-1", "lead": {"id": "l1"}}
    monkeypatch.setattr(service, "_load", lambda request_id=None, invoice=None: req)
    monkeypatch.setattr(service, "apply_payment", lambda r, paid, source, actor: applied.append((paid, source, actor)) or {"status": "x"})
    return req, applied


def test_erp_paid_closes_with_the_full_invoice_amount(erp):
    _, applied = erp
    service.handle_erp({"invoiceNumber": "INV-1", "status": "paid"})
    assert applied == [(D("1000.00"), "erp", None)]


def test_erp_paid_never_records_less_than_the_invoice(erp):
    _, applied = erp
    service.handle_erp({"invoiceNumber": "INV-1", "status": "paid", "amountPaid": 400})
    assert applied[0][0] == D("1000.00")


def test_erp_partial_records_what_arrived(erp):
    _, applied = erp
    service.handle_erp({"invoiceNumber": "INV-1", "status": "partial", "amountPaid": 400})
    assert applied[0][0] == D("400.00")


def test_erp_repeat_is_harmless(erp):
    req, applied = erp
    req["status"] = "confirmed"
    assert service.handle_erp({"invoiceNumber": "INV-1", "status": "paid"})["note"] == "already confirmed"
    assert applied == []


@pytest.mark.parametrize("payload", [{}, {"invoiceNumber": "INV-1"}, {"invoiceNumber": "INV-1", "status": "refunded"}, {"invoiceNumber": "INV-1", "status": "partial", "amountPaid": -5}])
def test_erp_bad_payloads_are_rejected(erp, payload):
    with pytest.raises(AppError):
        service.handle_erp(payload)


def test_only_finance_or_admin_can_confirm(monkeypatch):
    monkeypatch.setattr(service.settings, "PAYMENT_FALLBACK_ENABLED", True)
    for role in (Role.KAM, Role.SALES_MANAGER, Role.KAM):
        with pytest.raises(ForbiddenError):
            service.confirm(Profile(id="x", role=role), "r1", None)


def test_the_fallback_button_can_be_switched_off(monkeypatch):
    monkeypatch.setattr(service.settings, "PAYMENT_FALLBACK_ENABLED", False)
    with pytest.raises(ForbiddenError):
        service.confirm(Profile(id="f", role=Role.FINANCE), "r1", None)


def test_only_finance_or_admin_see_payments():
    for role in (Role.KAM, Role.SALES_MANAGER):
        with pytest.raises(ForbiddenError):
            service.list_requests(Profile(id="x", role=role), None)


client = TestClient(app)


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/v1/targets/card"), ("get", "/api/v1/targets"), ("put", "/api/v1/targets"), ("get", "/api/v1/approvals"),
        ("get", "/api/v1/payments"), ("post", "/api/v1/payments/x/confirm"), ("get", "/api/v1/quotation-templates"),
        ("get", "/api/v1/leads/x/deal"), ("post", "/api/v1/leads/x/quotations"), ("post", "/api/v1/leads/x/minutes"),
        ("put", "/api/v1/leads/x/agreement/details"), ("get", "/api/v1/leads/x/agreement/pdf"), ("post", "/api/v1/leads/x/payment-request"), ("get", "/api/v1/quotations/x/pdf"),
    ],
)
def test_phase2_routes_require_sign_in(method, path):
    assert getattr(client, method)(path).status_code in (401, 422)  # 422: no token and no body, either way not served


def test_erp_webhook_rejects_unsigned_calls():
    assert client.post("/api/v1/payments/erp-webhook", json={"invoiceNumber": "INV-1", "status": "paid"}).status_code == 403


@pytest.mark.parametrize("path", ["/api/v1/clients", "/api/v1/clients/x", "/api/v1/campaigns", "/api/v1/occasion-calendar"])
def test_client_routes_require_sign_in(path):
    assert client.get(path).status_code == 401
