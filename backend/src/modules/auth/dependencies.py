from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from src.core.config import settings
from src.core.errors import ForbiddenError, UnauthorizedError
from src.core.security import verify_access_token
from src.modules.auth import service, sessions
from src.modules.auth.schemas import Profile, Role

bearer = HTTPBearer(auto_error=False)


def get_claims(creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> dict:
    """Verify the bearer token (and the one-active-session rule when SINGLE_SESSION is on)."""
    if not creds:
        raise UnauthorizedError("Missing authentication token.")
    claims = verify_access_token(creds.credentials)
    if settings.SINGLE_SESSION:
        sessions.ensure_active(claims["sub"], claims.get("session_id"))
    return {**claims, "_token": creds.credentials}


ClaimsDep = Annotated[dict, Depends(get_claims)]


def get_current_user(claims: ClaimsDep) -> Profile:
    return service.get_profile(claims["sub"])


CurrentUserDep = Annotated[Profile, Depends(get_current_user)]


def require_roles(*roles: Role):
    def _dep(user: CurrentUserDep) -> Profile:
        if user.role not in roles:
            raise ForbiddenError()
        return user

    return _dep
