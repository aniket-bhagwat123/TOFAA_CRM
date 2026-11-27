import time

import jwt
import pytest

from src.core.config import settings
from src.core.errors import UnauthorizedError
from src.core.security import verify_access_token


def _token(**over):
    claims = {"sub": "u1", "aud": settings.SUPABASE_JWT_AUDIENCE, "exp": time.time() + 60, **over}
    return jwt.encode(claims, settings.SUPABASE_JWT_SECRET, algorithm=settings.SUPABASE_JWT_ALGORITHM)


def test_valid_token():
    assert verify_access_token(_token())["sub"] == "u1"


def test_expired_token():
    with pytest.raises(UnauthorizedError):
        verify_access_token(_token(exp=time.time() - 10))


def test_bad_signature():
    bad = jwt.encode({"sub": "u"}, "x" * 40, algorithm="HS256")
    with pytest.raises(UnauthorizedError):
        verify_access_token(bad)


def test_roles():
    from src.modules.auth.schemas import Profile, Role

    p = Profile(id="1", email="a@b.co", role="admin")
    assert p.role == Role.ADMIN
    assert {r.value for r in Role} == {"admin", "sales_manager", "finance", "kam"}
    assert Profile(id="2", role="sales_executive").role == Role.KAM  # accounts saved with the old name


def test_es256_token_verified_with_jwks(monkeypatch):
    from cryptography.hazmat.primitives.asymmetric import ec

    from src.core import security

    private = ec.generate_private_key(ec.SECP256R1())

    class FakeKey:
        key = private.public_key()

    class FakeClient:
        def get_signing_key_from_jwt(self, _):
            return FakeKey()

    monkeypatch.setattr(security, "_jwks_client", lambda: FakeClient())
    token = jwt.encode(
        {"sub": "u9", "aud": settings.SUPABASE_JWT_AUDIENCE, "exp": time.time() + 60},
        private,
        algorithm="ES256",
        headers={"kid": "k1"},
    )
    assert security.verify_access_token(token)["sub"] == "u9"


def test_alg_none_rejected():
    forged = jwt.encode({"sub": "x", "aud": settings.SUPABASE_JWT_AUDIENCE}, None, algorithm="none")
    with pytest.raises(UnauthorizedError):
        verify_access_token(forged)
