from functools import lru_cache

import jwt
from jwt import PyJWKClient

from src.core.config import settings
from src.core.errors import UnauthorizedError

# Never accept "none" or anything outside this list.
_ALLOWED_ALGS = {"ES256", "RS256", "HS256"}


@lru_cache
def _jwks_client() -> PyJWKClient:
    """Supabase projects with asymmetric signing keys publish their public keys here."""
    return PyJWKClient(
        f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json",
        headers={"apikey": settings.SUPABASE_ANON_KEY},
        cache_keys=True,
        lifespan=3600,
    )


def verify_access_token(token: str) -> dict:
    try:
        alg = jwt.get_unverified_header(token).get("alg")
        if alg not in _ALLOWED_ALGS:
            raise UnauthorizedError("Invalid authentication token.")
        if alg == "HS256":
            # Legacy projects: shared secret.
            if not settings.SUPABASE_JWT_SECRET:
                raise UnauthorizedError("Invalid authentication token.")
            key = settings.SUPABASE_JWT_SECRET
        else:
            key = _jwks_client().get_signing_key_from_jwt(token).key
        return jwt.decode(token, key, algorithms=[alg], audience=settings.SUPABASE_JWT_AUDIENCE)
    except jwt.ExpiredSignatureError as exc:
        raise UnauthorizedError("Session expired.") from exc
    except jwt.PyJWTError as exc:
        raise UnauthorizedError("Invalid authentication token.") from exc
