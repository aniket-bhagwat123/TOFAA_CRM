"""Self sign-up: someone makes their own account with name, email, password (and optionally a mobile number).

Safe by default:
  - the person picks their role from SIGNUP_ALLOWED_ROLES; Admin can never be picked
  - with SIGNUP_REQUIRES_APPROVAL the account stays inactive until an admin activates it, and admins are told
  - every role (KAM, manager, finance) reaches client data, so it always waits for approval, even with approval switched off
  - SIGNUP_ALLOWED_DOMAINS limits sign-up to company email addresses
  - SIGNUP_ENABLED switches the whole thing off
"""
import logging

from src.core.audit import write_audit
from src.core.config import settings
from src.core.errors import AppError, ForbiddenError
from src.core.supabase import get_service_client
from src.modules.auth import service as auth
from src.modules.auth.schemas import Role, SignupRequest, SignupResponse

log = logging.getLogger(__name__)

PENDING = "Thanks for signing up. An admin will activate your account, then you can sign in with your email and password."


def allowed_domains() -> set[str]:
    return {d.strip().lower().lstrip("@") for d in settings.SIGNUP_ALLOWED_DOMAINS.split(",") if d.strip()}


def allowed_roles() -> set[Role]:
    out = set()
    for r in settings.SIGNUP_ALLOWED_ROLES.split(","):
        try:
            out.add(Role(r.strip()))
        except ValueError:
            continue
    out.discard(Role.ADMIN)  # never, whatever the setting says
    return out


def check_role(role: Role) -> None:
    if role not in allowed_roles():
        raise AppError(
            "That role cannot be chosen at sign-up. Ask your admin.",
            {"errors": [{"field": "role", "message": "This role cannot be chosen at sign-up."}]},
            422,
        )


def needs_approval(role: Role) -> bool:
    return True  # no role is harmless enough to open without an admin's yes


def check_domain(email: str) -> None:
    domains = allowed_domains()
    if domains and email.rsplit("@", 1)[-1].lower() not in domains:
        raise AppError(
            "Use your company email address to sign up.",
            {"errors": [{"field": "email", "message": "Use your company email address."}]},
            422,
        )


def signup(body: SignupRequest) -> SignupResponse:
    from src.modules.users.service import create_account  # local: users imports the auth service

    if not settings.SIGNUP_ENABLED:
        raise ForbiddenError("Sign-up is closed. Ask your admin to add you.")
    check_domain(body.email)
    check_role(body.role)

    approval = needs_approval(body.role)
    row = create_account(
        email=body.email, password=body.password, phone=body.phone, full_name=body.full_name,
        role=body.role, is_active=not approval,
    )
    write_audit(row["id"], "signup", "profiles", row["id"], {"pending": approval, "role": body.role.value})

    if approval:
        _tell_admins(row["id"], body.full_name, body.email, body.role)
        return SignupResponse(status="pending", message=PENDING)

    # No approval step: sign them in straight away.
    session = auth.password_login(body.email, body.password)
    return SignupResponse(status="active", message="Account created.", profile=session.profile, tokens=session.tokens)


def _tell_admins(user_id: str, name: str, email: str, role: Role) -> None:
    from src.modules.notifications.service import notify  # local: keeps auth light to import

    try:
        admins = get_service_client().table("profiles").select("id").eq("role", Role.ADMIN.value).eq("is_active", True).execute().data
        for a in admins:
            notify(a["id"], f"signup:{user_id}", "New sign-up waiting for approval", f"{name} ({email}) as {role.value.replace('_', ' ')}. Check the role, then activate them in Users.", "/users")
    except Exception:  # noqa: BLE001 - the account exists; a missed notification is not worth failing the sign-up
        log.exception("could not notify admins about sign-up %s", user_id)
