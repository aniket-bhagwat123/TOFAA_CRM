import pytest
from pydantic import ValidationError

from src.core.errors import AppError, ConflictError, ForbiddenError
from src.modules.auth.schemas import Profile, Role
from src.modules.users import service
from src.modules.users.schemas import UserCreate


def body(**over):
    base = {"email": "New@Example.com", "password": "Tofaa2026x", "fullName": " Asha ", "role": "sales_executive"}
    return UserCreate.model_validate({**base, **over})


def actor(role, id="actor-1"):
    return Profile(id=id, email="a@b.co", role=role)


# --- schema ---------------------------------------------------------------------------------

def test_email_lowercased_and_name_stripped():
    b = body()
    assert b.email == "new@example.com" and b.full_name == "Asha"


def test_email_and_password_are_required():
    # people sign in with email and password, so an account without them could never be used
    with pytest.raises(ValidationError):
        body(email=None, phone="98765 43210")
    with pytest.raises(ValidationError):
        UserCreate.model_validate({"email": "a@b.co", "fullName": "Asha"})


def test_weak_password_rejected():
    for weak in ("short1A", "alllowercase1", "ALLUPPERCASE1", "NoDigitsHere"):
        with pytest.raises(ValidationError):
            body(password=weak)


def test_phone_is_optional_and_cleaned():
    assert body(phone="98765 43210").phone == "9876543210"  # stored as the plain 10 digits


def test_unknown_role_rejected():
    with pytest.raises(ValidationError):
        body(role="owner")


# --- service --------------------------------------------------------------------------------

class FakeAdmin:
    def __init__(self, fail=None):
        self.fail, self.deleted, self.attrs = fail, [], None

    def create_user(self, attrs):
        self.attrs = attrs
        if self.fail:
            raise self.fail
        return type("R", (), {"user": type("U", (), {"id": "new-id"})()})()

    def delete_user(self, uid):
        self.deleted.append(uid)


class FakeTable:
    def __init__(self, fail):
        self.fail = fail

    def insert(self, row):
        self.row = row
        return self

    def execute(self):
        if self.fail:
            raise RuntimeError("db down")
        return type("R", (), {"data": [{**self.row, "is_active": True, "created_at": None}]})()


class FakeDb:
    def __init__(self, auth_fail=None, table_fail=False):
        self.auth = type("A", (), {"admin": FakeAdmin(auth_fail)})()
        self.table_fail = table_fail

    def table(self, _):
        return FakeTable(self.table_fail)


@pytest.fixture
def db(monkeypatch):
    def make(**kw):
        d = FakeDb(**kw)
        monkeypatch.setattr(service, "get_service_client", lambda: d)
        monkeypatch.setattr(service, "write_audit", lambda *a, **k: None)
        return d

    return make


def test_admin_can_create_any_role(db):
    db()
    for role in Role:
        assert service.create_user(actor(Role.ADMIN), body(role=role.value)).role == role


def test_manager_can_only_create_executives_into_own_team(db):
    db()
    out = service.create_user(actor(Role.SALES_MANAGER, "mgr-1"), body())
    assert out.manager_id == "mgr-1"
    for role in ("admin", "sales_manager", "finance"):
        with pytest.raises(ForbiddenError):
            service.create_user(actor(Role.SALES_MANAGER), body(role=role))


def test_executive_cannot_create(db):
    db()
    with pytest.raises(ForbiddenError):
        service.create_user(actor(Role.SALES_EXECUTIVE), body())


def test_phone_is_normalised_for_auth(db):
    d = db()
    service.create_user(actor(Role.ADMIN), body(phone="98765 43210"))
    assert d.auth.admin.attrs == {
        "email": "new@example.com", "email_confirm": True, "password": "Tofaa2026x", "phone": "+919876543210", "phone_confirm": True,
    }


def test_duplicate_is_409(db):
    db(auth_fail=Exception("A user with this email address has already been registered"))
    with pytest.raises(ConflictError):
        service.create_user(actor(Role.ADMIN), body())


def test_profile_failure_rolls_back_auth_user(db):
    d = db(table_fail=True)
    with pytest.raises(AppError):
        service.create_user(actor(Role.ADMIN), body())
    assert d.auth.admin.deleted == ["new-id"]
