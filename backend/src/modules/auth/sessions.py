"""Single active session per user.

A `user_sessions` row (one per user) records the Supabase `session_id` that currently owns the
account. Claiming is atomic in Postgres (`claim_user_session`): it succeeds only if there is no
row yet, or the existing one has been idle longer than SESSION_IDLE_MINUTES (abandoned browser).
Every authenticated request calls `ensure_active` which checks the token's session_id matches and
refreshes last_seen_at.
"""
from src.core.config import settings
from src.core.errors import AppError, UnauthorizedError
from src.core.supabase import get_service_client
from src.core.ttl_cache import TTLCache

# Remember "this session was just verified" so we do not hit the database on every request.
_verified = TTLCache(ttl_seconds=20, max_items=4096)

SESSION_ENDED = "Your session has ended. You signed in on another device, or were inactive too long."
ALREADY_SIGNED_IN = (
    "This account is already signed in on another device. "
    "Sign out there first, or try again after the other session has been idle."
)


def _idle_seconds() -> int:
    return settings.SESSION_IDLE_MINUTES * 60


def claim(user_id: str, session_id: str) -> bool:
    res = get_service_client().rpc(
        "claim_user_session",
        {"p_user_id": user_id, "p_session_id": session_id, "p_idle_seconds": _idle_seconds()},
    ).execute()
    return bool(res.data)


def ensure_active(user_id: str, session_id: str | None) -> None:
    if not session_id:
        raise UnauthorizedError(SESSION_ENDED)
    key = f"{user_id}:{session_id}"
    if _verified.get(key):
        return
    res = get_service_client().rpc(
        "touch_user_session",
        {"p_user_id": user_id, "p_session_id": session_id, "p_idle_seconds": _idle_seconds()},
    ).execute()
    if not res.data:
        raise UnauthorizedError(SESSION_ENDED)
    _verified.set(key, True)


def release(user_id: str, session_id: str | None) -> None:
    if session_id:
        _verified.invalidate_prefix(f"{user_id}:{session_id}")
        get_service_client().table("user_sessions").delete().eq("user_id", user_id).eq(
            "session_id", session_id
        ).execute()


def revoke_supabase_session(access_token: str) -> None:
    """Invalidate only this one Supabase session (not the user's other sessions)."""
    try:
        get_service_client().auth.admin.sign_out(access_token, "local")
    except Exception:  # noqa: BLE001 - best effort; the token is also unusable without a claim
        pass


class AlreadySignedInError(AppError):
    status_code = 409

    def __init__(self):
        super().__init__(ALREADY_SIGNED_IN, data={"code": "already_signed_in"})
