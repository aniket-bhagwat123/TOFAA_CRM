import pytest

from src.core.errors import UnauthorizedError
from src.modules.auth import service, sessions


class FakeRpc:
    def __init__(self, data):
        self.data = data

    def execute(self):
        return self


class FakeClient:
    """Mimics the claim/touch Postgres functions with an in-memory slot per user."""

    def __init__(self):
        self.slots: dict[str, str] = {}
        self.deleted: list[tuple] = []

    def rpc(self, name, args):
        uid, sid = args["p_user_id"], args["p_session_id"]
        if name == "claim_user_session":
            if uid in self.slots:
                return FakeRpc(False)
            self.slots[uid] = sid
            return FakeRpc(True)
        return FakeRpc(self.slots.get(uid) == sid)


@pytest.fixture
def fake(monkeypatch):
    client = FakeClient()
    monkeypatch.setattr(sessions, "get_service_client", lambda: client)
    sessions._verified.clear()
    return client


def test_second_claim_is_rejected(fake):
    assert sessions.claim("u1", "s1") is True
    assert sessions.claim("u1", "s2") is False
    assert sessions.claim("u2", "s3") is True  # other users unaffected


def test_ensure_active_accepts_owner_rejects_others(fake):
    sessions.claim("u1", "s1")
    sessions.ensure_active("u1", "s1")
    with pytest.raises(UnauthorizedError):
        sessions.ensure_active("u1", "s2")
    with pytest.raises(UnauthorizedError):
        sessions.ensure_active("u1", None)


def _session_result(uid="u1", sid="s1"):
    class S:
        access_token = "tok"
        refresh_token = "ref"
        expires_in = 3600

    class U:
        id = uid

    class R:
        session = S()
        user = U()

    return R()


def test_login_rejected_when_already_signed_in(fake, monkeypatch):
    revoked = []
    anon = type("A", (), {"auth": type("X", (), {"verify_otp": lambda self, c: _session_result()})()})()
    monkeypatch.setattr(service, "new_anon_client", lambda: anon)
    monkeypatch.setattr(service.settings, "SINGLE_SESSION", True)
    monkeypatch.setattr(service, "get_profile", lambda uid: {"id": uid})
    monkeypatch.setattr(service, "verify_access_token", lambda t: {"session_id": "s-new"})
    monkeypatch.setattr(sessions, "revoke_supabase_session", lambda t: revoked.append(t))
    fake.slots["u1"] = "s-old"  # someone is already signed in

    with pytest.raises(sessions.AlreadySignedInError) as e:
        service.verify_otp("a@b.co", "123456")
    assert e.value.status_code == 409
    assert e.value.data == {"code": "already_signed_in"}
    assert revoked == ["tok"]  # the just-created Supabase session was cleaned up
