import pytest
from pydantic import ValidationError

from src.core.config import settings
from src.core.errors import AppError, ForbiddenError
from src.modules.auth import signup as mod
from src.modules.auth.schemas import LoginResponse, Profile, Role, SignupRequest, TokenPair

GOOD = {"fullName": "  Asha   Rao ", "email": "Asha@Tofaa.in", "password": "Tofaa2026x"}


def req(**over):
    return SignupRequest.model_validate({**GOOD, **over})


@pytest.fixture
def made(monkeypatch):
    """Capture what would be created; no database."""
    calls = {"accounts": [], "notified": [], "audit": []}

    def create_account(**kw):
        calls["accounts"].append(kw)
        return {"id": "new-id", **kw}

    monkeypatch.setattr("src.modules.users.service.create_account", create_account)
    monkeypatch.setattr(mod, "write_audit", lambda *a, **k: calls["audit"].append(a))
    monkeypatch.setattr(mod, "_tell_admins", lambda uid, name, email, role: calls["notified"].append((uid, name, email)))
    monkeypatch.setattr(settings, "SIGNUP_ENABLED", True)
    monkeypatch.setattr(settings, "SIGNUP_REQUIRES_APPROVAL", True)
    monkeypatch.setattr(settings, "SIGNUP_ALLOWED_DOMAINS", "")
    monkeypatch.setattr(settings, "SIGNUP_ALLOWED_ROLES", "sales_executive,sales_manager,finance,kam")
    return calls


# --- request -------------------------------------------------------------------------------

def test_request_is_cleaned():
    r = req(phone="98765 43210")
    assert (r.full_name, r.email, r.phone) == ("Asha Rao", "asha@tofaa.in", "9876543210")


def test_request_rejects_weak_password_bad_email_and_role_field_is_ignored():
    for bad in ({"password": "weakpass"}, {"password": "Short1"}, {"email": "not-an-email"}, {"fullName": "   "}, {"phone": "12345"}):
        with pytest.raises(ValidationError):
            req(**bad)
    with pytest.raises(ValidationError):
        req(role="admin")  # admin can never sign up
    with pytest.raises(ValidationError):
        req(role="owner")
    assert req().role == Role.SALES_EXECUTIVE  # the default


# --- flow ----------------------------------------------------------------------------------

def test_signup_creates_an_inactive_sales_executive_and_tells_admins(made):
    res = mod.signup(req())
    acc = made["accounts"][0]
    assert acc["role"] == Role.SALES_EXECUTIVE and acc["is_active"] is False
    assert res.status == "pending" and res.tokens is None
    assert made["notified"] == [("new-id", "Asha Rao", "asha@tofaa.in")]


def test_closed_signup_is_refused(made, monkeypatch):
    monkeypatch.setattr(settings, "SIGNUP_ENABLED", False)
    with pytest.raises(ForbiddenError):
        mod.signup(req())
    assert made["accounts"] == []


def test_only_allowed_domains(made, monkeypatch):
    monkeypatch.setattr(settings, "SIGNUP_ALLOWED_DOMAINS", "tofaa.in, @tofaa.com")
    mod.signup(req())  # tofaa.in is fine
    with pytest.raises(AppError):
        mod.signup(req(email="someone@gmail.com"))
    assert len(made["accounts"]) == 1


def test_without_approval_signs_in_straight_away(made, monkeypatch):
    monkeypatch.setattr(settings, "SIGNUP_REQUIRES_APPROVAL", False)
    session = LoginResponse(profile=Profile(id="new-id", email="asha@tofaa.in", role=Role.SALES_EXECUTIVE), tokens=TokenPair(access_token="a", refresh_token="r"))
    monkeypatch.setattr(mod.auth, "password_login", lambda email, pw: session)
    res = mod.signup(req())
    assert made["accounts"][0]["is_active"] is True
    assert res.status == "active" and res.tokens.access_token == "a" and made["notified"] == []


def test_chosen_role_is_used(made):
    mod.signup(req(role="finance"))
    assert made["accounts"][0]["role"] == Role.FINANCE


def test_role_outside_the_allowed_list_is_refused(made, monkeypatch):
    monkeypatch.setattr(settings, "SIGNUP_ALLOWED_ROLES", "sales_executive,admin")  # admin in the setting is ignored
    with pytest.raises(AppError):
        mod.signup(req(role="sales_manager"))
    assert Role.ADMIN not in mod.allowed_roles()


def test_roles_above_executive_always_wait_for_approval(made, monkeypatch):
    monkeypatch.setattr(settings, "SIGNUP_REQUIRES_APPROVAL", False)
    res = mod.signup(req(role="sales_manager"))
    assert res.status == "pending" and made["accounts"][0]["is_active"] is False
