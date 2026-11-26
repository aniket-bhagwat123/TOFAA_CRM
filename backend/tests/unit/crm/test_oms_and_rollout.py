"""OMS handoff, the pilot list and client set-up. Every outside call is faked: nothing leaves the test."""
import hashlib
import hmac
import json

import pytest
from fastapi.testclient import TestClient

from src.core.config import settings
from src.core.errors import AppError, ConflictError, ForbiddenError
from src.main import app
from src.modules.auth.schemas import Profile, Role
from src.modules.gifting_requests import clients, oms, service

LINKED = {"t-1": {"id": "c-1", "name": "Wendy"}}
KAM = Profile.model_construct(id="u-1", email="kam@example.com", full_name="Asha", role=Role.KAM)
RID = "22222222-2222-2222-2222-222222222222"
SECRET = "s" * 40


@pytest.fixture
def gifting(monkeypatch):
    """A confirmed request in a faked Gifting OS; returns what the CRM asked it to do."""
    state = {"status": "CONFIRMED", "calls": []}

    def fake_call(path, body, base=None):
        state["calls"].append((path, body))
        allowed = ["start_fulfilment"] if state["status"] == "CONFIRMED" else []
        return {"request": {"id": RID, "tenantId": "t-1", "status": state["status"]}, "history": [],
                "actionsEnabled": True, "allowedActions": allowed}

    monkeypatch.setattr(service, "accounts", lambda user: LINKED)
    monkeypatch.setattr(service, "_call", fake_call)
    monkeypatch.setattr(settings, "GIFTING_PILOT_EMAILS", "")
    monkeypatch.setattr(settings, "OMS_API_URL", "http://oms.test")
    monkeypatch.setattr(settings, "OMS_API_KEY", "key")
    return state


def _writes(state):
    return [body for path, body in state["calls"] if path.endswith("/actions")]


def test_send_to_oms_orders_first_then_moves_the_request_on(gifting, monkeypatch):
    monkeypatch.setattr(oms, "send", lambda request, sent_by: "OMS-7")
    service.act(KAM, RID, "send_to_oms", None, None)
    (body,) = _writes(gifting)
    assert body["action"] == "start_fulfilment" and "OMS-7" in body["note"]


def test_if_oms_refuses_nothing_changes(gifting, monkeypatch):
    def refuse(request, sent_by):
        raise AppError(oms.FAILED, status_code=502)

    monkeypatch.setattr(oms, "send", refuse)
    with pytest.raises(AppError):
        service.act(KAM, RID, "send_to_oms", None, None)
    assert not _writes(gifting)


def test_only_a_confirmed_request_reaches_oms(gifting, monkeypatch):
    gifting["status"] = "IN_REVIEW"
    monkeypatch.setattr(oms, "send", lambda *a, **k: pytest.fail("must not send"))
    with pytest.raises(ConflictError):
        service.act(KAM, RID, "send_to_oms", None, None)


def test_with_oms_set_up_the_manual_step_is_replaced(gifting):
    assert service.detail(KAM, RID)["allowedActions"] == ["send_to_oms"]
    with pytest.raises(ConflictError):
        service.act(KAM, RID, "start_fulfilment", None, None)


def test_outside_the_pilot_a_person_can_only_look(gifting, monkeypatch):
    monkeypatch.setattr(settings, "GIFTING_PILOT_EMAILS", "other@example.com")
    shown = service.detail(KAM, RID)
    assert shown["allowedActions"] == [] and shown["pilotOnly"] is True
    for call in (lambda: service.act(KAM, RID, "send_to_oms", None, None),
                 lambda: service.create_occasion(KAM, "c-1", {}),
                 lambda: clients.invite(KAM, "c-1", "a@b.co", None, "OWNER")):
        with pytest.raises(ForbiddenError):
            call()
    assert not _writes(gifting)
    monkeypatch.setattr(settings, "GIFTING_PILOT_EMAILS", " KAM@example.com ")
    assert service.may_act(KAM)


def test_only_an_admin_creates_a_gifting_os_client(monkeypatch):
    monkeypatch.setattr(settings, "GIFTING_PILOT_EMAILS", "")
    monkeypatch.setattr(service, "_call", lambda *a, **k: pytest.fail("must not call Gifting OS"))
    with pytest.raises(ForbiddenError):
        clients.set_up(KAM, "c-1")


@pytest.mark.parametrize("current,reported,steps", [
    ("IN_PROGRESS", "DISPATCHED", ["dispatch"]),
    ("IN_PROGRESS", "DELIVERED", ["dispatch", "deliver"]),
    ("DELIVERED", "DISPATCHED", []),
])
def test_oms_status_updates(monkeypatch, current, reported, steps):
    done = []

    def fake_call(path, body, base=None):
        if path.endswith("/actions"):
            done.append(body["action"])
        return {"request": {"status": current}}

    db = type("Q", (), {"__getattr__": lambda self, n: self, "__call__": lambda self, *a, **k: self,
                        "execute": lambda self: type("R", (), {"data": [{"gifting_tenant_id": "t-1"}]})()})()
    monkeypatch.setattr(service, "get_service_client", lambda: db)
    monkeypatch.setattr(service, "_call", fake_call)
    assert service.apply_oms_status(RID, reported, "OMS-7")["changed"] is bool(steps)
    assert done == steps


def test_oms_webhook_needs_a_valid_signature(monkeypatch):
    monkeypatch.setattr(service, "apply_oms_status", lambda rid, status, ref: {"requestId": rid, "status": status})
    url = f"{settings.API_V1_STR}/integrations/oms/status"
    raw = json.dumps({"requestId": RID, "status": "DELIVERED"}).encode()
    good = "sha256=" + hmac.new(SECRET.encode(), raw, hashlib.sha256).hexdigest()
    client = TestClient(app)
    monkeypatch.setattr(settings, "OMS_WEBHOOK_SECRET", "")
    assert client.post(url, content=raw, headers={"X-OMS-Signature": good}).status_code == 403
    monkeypatch.setattr(settings, "OMS_WEBHOOK_SECRET", SECRET)
    assert client.post(url, content=raw, headers={"X-OMS-Signature": "sha256=bad"}).status_code == 403
    assert client.post(url, content=raw, headers={"X-OMS-Signature": good}).status_code == 200
