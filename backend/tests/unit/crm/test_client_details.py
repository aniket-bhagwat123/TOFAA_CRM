"""Editing a client's Gifting OS details, logo and logins from the CRM: who may, and what is sent."""
import pytest

from src.core.errors import AppError, ForbiddenError
from src.modules.auth.schemas import Profile, Role
from src.modules.gifting_requests import clients, logos, service

ADMIN = Profile.model_construct(id="a", role=Role.ADMIN, full_name="Admin")
KAM = Profile.model_construct(id="k", role=Role.KAM, full_name="Kam")


@pytest.fixture
def sent(monkeypatch):
    calls = []
    monkeypatch.setattr(service, "require_may_act", lambda user: None)
    monkeypatch.setattr(service, "may_act", lambda user: True)
    monkeypatch.setattr(service, "_call", lambda path, body, base=None: calls.append((path, body)) or {"actionsEnabled": True})
    monkeypatch.setattr(clients, "client_account", lambda user, company: {"id": company})
    monkeypatch.setattr(clients, "_tenant_of", lambda company: "t-1")
    return calls


def test_only_admins_and_sales_managers_change_the_client_itself(sent):
    for call in (lambda: clients.change_details(KAM, "c", {"gstin": None}), lambda: clients.change_logo(KAM, "c", None),
                 lambda: clients.set_active(KAM, "c", False)):
        with pytest.raises(ForbiddenError):
            call()
    assert sent == []
    out = clients.change_details(ADMIN, "c", {"legalName": "Acme Pvt Ltd"})
    assert out["canManage"] and sent[0][0] == "/details" and sent[0][1]["legalName"] == "Acme Pvt Ltd" and sent[0][1]["tenantId"] == "t-1"


def test_a_kam_manages_the_logins_of_their_client(sent):
    out = clients.change_login(KAM, "c", "u-1", {"isActive": False})
    assert sent[0][0] == "/users/update" and sent[0][1]["userId"] == "u-1" and not out["canManage"]


def test_only_a_real_small_picture_is_sent_as_a_logo(sent):
    with pytest.raises(AppError, match="PNG, JPEG or WebP"):
        clients.change_logo(ADMIN, "c", b"GIF89a....")
    with pytest.raises(AppError, match="2 MB"):
        clients.change_logo(ADMIN, "c", b"x" * (clients.LOGO_MAX_BYTES + 1))
    assert sent == []
    clients.change_logo(ADMIN, "c", b"\x89PNG\r\n\x1a\n" + b"0" * 20)
    assert sent[0][1]["contentType"] == "image/png"


def test_a_client_switched_off_in_gifting_os_is_marked():
    found = {"c": {"logo_url": None, "active": False}}
    assert logos.fields(found, "c")["gifting_inactive"] and not logos.fields(found, "other")["gifting_inactive"]
