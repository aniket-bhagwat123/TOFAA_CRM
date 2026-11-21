from fastapi import APIRouter

from src.core.schema import ok
from src.modules.auth import service, signup as signup_service
from src.modules.auth.dependencies import ClaimsDep, CurrentUserDep
from src.modules.auth.schemas import OtpRequest, PasswordChange, PasswordLogin, PasswordReset, RefreshRequest, SignupRequest

router = APIRouter(prefix="/auth", tags=["auth"])


# The one-time code is only used to reset a forgotten password now (see /password/reset). Sign-in is by password.
@router.post("/otp/request")
def request_otp(body: OtpRequest):
    service.request_otp(body.identifier)
    return ok(None, "If that account exists, a code has been sent.")


@router.post("/refresh")
def refresh(body: RefreshRequest):
    return ok(service.refresh(body.refresh_token).model_dump(by_alias=True))


@router.get("/me")
def me(user: CurrentUserDep):
    return ok(user.model_dump(by_alias=True))


@router.post("/logout")
def logout(claims: ClaimsDep):
    service.logout(claims["sub"], claims["_token"], claims.get("session_id"))
    return ok(None, "Signed out.")


@router.post("/password/login")
def password_login(body: PasswordLogin):
    return ok(service.password_login(body.identifier, body.password).model_dump(by_alias=True), "Signed in.")


@router.post("/password/reset")
def reset_password(body: PasswordReset):
    """Step 2 of forgot password. Step 1 is /auth/otp/request."""
    service.reset_password(body.identifier, body.code, body.new_password)
    return ok(None, "Password updated. You can sign in now.")


@router.post("/password/change")
def change_password(body: PasswordChange, user: CurrentUserDep):
    """Set a new password while signed in (Profile screen). No code needed."""
    service.change_password(user.id, body.new_password)
    return ok(None, "Password updated.")


@router.post("/signup", status_code=201)
def signup(body: SignupRequest):
    """Public. Creates an account in the chosen role (never admin); inactive until an admin approves it (see SIGNUP_* settings)."""
    res = signup_service.signup(body)
    return ok(res.model_dump(by_alias=True, exclude_none=True), res.message)
