"""OTP login (mobile number or company email). There are no passwords."""
import re

from src.core.audit import write_audit
from src.core.cache import reference
from src.core.config import settings
from src.core.errors import ForbiddenError, UnauthorizedError
from src.core.keys import normalize_phone10
from src.core.validators import EMAIL_MESSAGE, is_email
from src.core.security import verify_access_token
from src.core.storage import AVATARS, signed_url
from src.core.supabase import get_service_client, new_anon_client
from src.modules.auth import sessions
from src.modules.auth.schemas import LoginResponse, Profile, TokenPair

INVALID_CODE = "That code is wrong or has expired."
INVALID_CREDENTIALS = "Incorrect email, mobile number or password."


def normalize_identifier(identifier: str) -> tuple[str, str]:
    """Return ("email", lowercase email) or ("phone", "+91" and the 10-digit mobile number)."""
    value = identifier.strip()
    if "@" in value:
        if not is_email(value):
            raise UnauthorizedError(EMAIL_MESSAGE, status_code=422)
        return "email", value.lower()
    number = normalize_phone10(value)
    if not number:
        raise UnauthorizedError("Enter a valid email or a 10-digit mobile number.", status_code=422)
    return "phone", "+91" + number


PROFILE_TTL = 30  # seconds; user edits invalidate it at once (users.service)


def _load_profile(user_id: str) -> Profile:
    res = get_service_client().table("profiles").select("*").eq("id", user_id).limit(1).execute()
    if not res.data:
        raise UnauthorizedError("Profile not found.")
    row = res.data[0]
    if not row.get("is_active", True):
        raise ForbiddenError("This account is disabled.")
    return Profile(
        **{k: row.get(k) for k in ("id", "email", "phone", "full_name", "role", "manager_id")},
        avatar_url=signed_url(AVATARS, row.get("avatar_path")),
    )


def get_profile(user_id: str) -> Profile:
    """Every request needs the profile. One cached copy saves a database round trip each time."""
    return reference("profile", user_id, PROFILE_TTL, lambda: _load_profile(user_id))


def _tokens(session) -> TokenPair:
    return TokenPair(
        access_token=session.access_token,
        refresh_token=session.refresh_token,
        expires_in=session.expires_in,
    )


def request_otp(identifier: str) -> None:
    """Always succeeds from the caller's view so accounts cannot be enumerated.

    Only users an admin has created can sign in: should_create_user is off.
    """
    kind, value = normalize_identifier(identifier)
    try:
        new_anon_client().auth.sign_in_with_otp({kind: value, "options": {"should_create_user": False}})
    except Exception:  # noqa: BLE001
        pass


def verify_otp(identifier: str, code: str) -> LoginResponse:
    kind, value = normalize_identifier(identifier)
    params = {"email": value, "type": "email"} if kind == "email" else {"phone": value, "type": "sms"}
    try:
        res = new_anon_client().auth.verify_otp({**params, "token": code.strip()})
    except Exception as exc:  # supabase raises AuthApiError
        raise UnauthorizedError(INVALID_CODE) from exc
    if not res.session or not res.user:
        raise UnauthorizedError(INVALID_CODE)
    return _finish_login(res)


def _finish_login(res) -> LoginResponse:
    """Shared tail of every sign-in: active profile check, optional single-session claim."""
    access_token = res.session.access_token
    try:
        profile = get_profile(res.user.id)
        if settings.SINGLE_SESSION:
            claims = verify_access_token(access_token)
            if not sessions.claim(res.user.id, claims.get("session_id", "")):
                raise sessions.AlreadySignedInError()
    except Exception:
        sessions.revoke_supabase_session(access_token)  # do not leave a stray session behind
        raise
    return LoginResponse(profile=profile, tokens=_tokens(res.session))


def password_login(identifier: str, password: str) -> LoginResponse:
    """Optional second way in. The one-time code stays the default."""
    kind, value = normalize_identifier(identifier)
    try:
        res = new_anon_client().auth.sign_in_with_password({kind: value, "password": password})
    except Exception as exc:  # supabase raises AuthApiError
        raise UnauthorizedError(INVALID_CREDENTIALS) from exc
    if not res.session or not res.user:
        raise UnauthorizedError(INVALID_CREDENTIALS)
    return _finish_login(res)


def reset_password(identifier: str, code: str, new_password: str) -> None:
    """Forgot password: prove access with a one-time code, then set the password.

    Works for email and mobile-only users alike, and needs no reset link or redirect URL.
    """
    kind, value = normalize_identifier(identifier)
    params = {"email": value, "type": "email"} if kind == "email" else {"phone": value, "type": "sms"}
    try:
        res = new_anon_client().auth.verify_otp({**params, "token": code.strip()})
    except Exception as exc:
        raise UnauthorizedError(INVALID_CODE) from exc
    if not res.session or not res.user:
        raise UnauthorizedError(INVALID_CODE)
    try:
        get_profile(res.user.id)  # a disabled account cannot reset its way back in
        get_service_client().auth.admin.update_user_by_id(res.user.id, {"password": new_password})
    finally:
        sessions.revoke_supabase_session(res.session.access_token)  # the code proves identity, it does not sign in


def refresh(refresh_token: str) -> TokenPair:
    try:
        res = new_anon_client().auth.refresh_session(refresh_token)
    except Exception as exc:
        raise UnauthorizedError("Session expired.") from exc
    if not res.session or not res.user:
        raise UnauthorizedError("Session expired.")
    if settings.SINGLE_SESSION:
        claims = verify_access_token(res.session.access_token)
        sessions.ensure_active(res.user.id, claims.get("session_id"))
    return _tokens(res.session)


def logout(user_id: str, access_token: str, session_id: str | None) -> None:
    if settings.SINGLE_SESSION:
        sessions.release(user_id, session_id)
    sessions.revoke_supabase_session(access_token)


def change_password(user_id: str, new_password: str) -> None:
    """Signed-in password change. The bearer token already proved who is asking."""
    get_service_client().auth.admin.update_user_by_id(user_id, {"password": new_password})
    write_audit(user_id, "password_change", "profiles", user_id, {})
