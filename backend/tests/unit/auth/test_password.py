import pytest
from pydantic import ValidationError

from src.core.errors import ForbiddenError, UnauthorizedError
from src.modules.auth import service
from src.modules.auth.schemas import Profile
from src.modules.auth.schemas import PasswordReset


def _result():
    S = type("S", (), {"access_token": "tok", "refresh_token": "ref", "expires_in": 3600})
    U = type("U", (), {"id": "u1"})
    return type("R", (), {"session": S(), "user": U()})()


class Auth:
    def __init__(self, fail=False):
        self.fail, self.calls = fail, []

    def sign_in_with_password(self, creds):
        self.calls.append(("pw", creds))
        if self.fail:
            raise Exception("bad")
        return _result()

    def verify_otp(self, params):
        self.calls.append(("otp", params))
        if self.fail:
            raise Exception("bad")
        return _result()


@pytest.fixture
def env(monkeypatch):
    revoked, updated = [], []
    monkeypatch.setattr(service.sessions, "revoke_supabase_session", lambda t: revoked.append(t))
    admin = type("Ad", (), {"update_user_by_id": lambda self, uid, attrs: updated.append((uid, attrs))})()
    monkeypatch.setattr(service, "get_service_client", lambda: type("C", (), {"auth": type("A", (), {"admin": admin})()})())
    monkeypatch.setattr(service, "get_profile", lambda uid: Profile(id=uid, role="sales_executive"))
    monkeypatch.setattr(service.settings, "SINGLE_SESSION", False)

    def use(auth):
        monkeypatch.setattr(service, "new_anon_client", lambda: type("A", (), {"auth": auth})())

    return use, revoked, updated


def test_password_login_by_email_and_phone(env):
    use, _, _ = env
    auth = Auth()
    use(auth)
    assert service.password_login("A@b.co", "pw").tokens.access_token == "tok"
    service.password_login("98765 43210", "pw")
    assert auth.calls[0] == ("pw", {"email": "a@b.co", "password": "pw"})
    assert auth.calls[1] == ("pw", {"phone": "+919876543210", "password": "pw"})


def test_wrong_password_is_generic_401(env):
    use, _, _ = env
    use(Auth(fail=True))
    with pytest.raises(UnauthorizedError) as e:
        service.password_login("a@b.co", "nope")
    assert e.value.message == service.INVALID_CREDENTIALS


def test_reset_sets_password_and_does_not_leave_a_session(env):
    use, revoked, updated = env
    use(Auth())
    service.reset_password("a@b.co", "123456", "NewPassw0rd")
    assert updated == [("u1", {"password": "NewPassw0rd"})]
    assert revoked == ["tok"]


def test_reset_with_bad_code_changes_nothing(env):
    use, revoked, updated = env
    use(Auth(fail=True))
    with pytest.raises(UnauthorizedError):
        service.reset_password("a@b.co", "000000", "NewPassw0rd")
    assert updated == []


def test_reset_blocked_for_disabled_account(env, monkeypatch):
    use, revoked, updated = env
    use(Auth())

    def disabled(uid):
        raise ForbiddenError("This account is disabled.")

    monkeypatch.setattr(service, "get_profile", disabled)
    with pytest.raises(ForbiddenError):
        service.reset_password("a@b.co", "123456", "NewPassw0rd")
    assert updated == [] and revoked == ["tok"]


@pytest.mark.parametrize("pw", ["short1A", "alllowercase1", "ALLUPPER123", "NoDigitsHere"])
def test_weak_new_password_rejected(pw):
    with pytest.raises(ValidationError):
        PasswordReset.model_validate({"identifier": "a@b.co", "code": "123456", "newPassword": pw})


# --- change password while signed in ----------------------------------------------------------------

def test_signed_in_change_sets_the_password_for_that_user_only(monkeypatch):
    updated, audited = [], []
    admin = type("Ad", (), {"update_user_by_id": lambda self, uid, attrs: updated.append((uid, attrs))})()
    monkeypatch.setattr(service, "get_service_client", lambda: type("C", (), {"auth": type("A", (), {"admin": admin})()})())
    monkeypatch.setattr(service, "write_audit", lambda *a, **k: audited.append(a))
    service.change_password("me-1", "NewPassw0rd")
    assert updated == [("me-1", {"password": "NewPassw0rd"})]
    assert audited and audited[0][1] == "password_change"


def test_change_needs_a_strong_password():
    from src.modules.auth.schemas import PasswordChange

    for pw in ("short1A", "alllowercase1", "NoDigitsHere"):
        with pytest.raises(ValidationError):
            PasswordChange.model_validate({"newPassword": pw})
    assert PasswordChange.model_validate({"newPassword": "NewPassw0rd"}).new_password == "NewPassw0rd"


def test_change_requires_sign_in():
    from fastapi.testclient import TestClient

    from src.main import app

    assert TestClient(app).post("/api/v1/auth/password/change", json={"newPassword": "NewPassw0rd"}).status_code == 401
