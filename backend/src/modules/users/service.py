import logging

from src.core.audit import write_audit
from src.core.cache import invalidate_reference, reference
from src.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from src.core.images import checked_upload
from src.core.storage import AVATARS, delete_image, guard_photo_write, signed_url, signed_urls, upload_image
from src.core.supabase import get_service_client
from src.modules.auth.schemas import Profile, Role
from src.modules.auth.service import normalize_identifier
from src.modules.users.schemas import UserCreate, UserOut, UserUpdate

log = logging.getLogger(__name__)

# Which roles each role may create.
CAN_CREATE: dict[Role, set[Role]] = {
    Role.ADMIN: set(Role),
    Role.SALES_MANAGER: {Role.SALES_EXECUTIVE},
    Role.SALES_EXECUTIVE: set(),
    Role.FINANCE: set(),
    Role.KAM: set(),
}

COLUMNS = "*"  # "*" so a database without the photo columns yet still works (photos just do not show)
OUT_COLUMNS = ["id", "email", "phone", "full_name", "role", "manager_id", "is_active", "created_at"]


def create_user(actor: Profile, body: UserCreate) -> UserOut:
    if body.role not in CAN_CREATE.get(actor.role, set()):
        raise ForbiddenError(f"You cannot create a user with the role '{body.role.value}'.")

    manager_id = body.manager_id
    if actor.role == Role.SALES_MANAGER:
        manager_id = actor.id  # a manager's new executives always join their own team

    row = create_account(email=body.email, password=body.password, phone=body.phone, full_name=body.full_name,
                         role=body.role, manager_id=manager_id)
    write_audit(actor.id, "create", "profiles", row["id"], {"role": body.role.value})
    return UserOut(**row)


def create_account(*, email: str, password: str, phone: str | None, full_name: str, role: Role,
                   manager_id: str | None = None, is_active: bool = True) -> dict:
    """The sign-in account (Supabase Auth) and its profile, made together: if the profile fails, the sign-in account
    is removed again so no one is left able to sign in without a profile. Used by "Add user" and by self sign-up."""
    attrs: dict = {"email": email, "email_confirm": True, "password": password}
    phone_e164 = None
    if phone:
        _, phone_e164 = normalize_identifier(phone)
        attrs.update(phone=phone_e164, phone_confirm=True)

    db = get_service_client()
    try:
        created = db.auth.admin.create_user(attrs)
    except Exception as exc:  # supabase AuthApiError
        msg = str(exc).lower()
        if "already" in msg or "exists" in msg or "registered" in msg:
            raise ConflictError("A user with this email or mobile number already exists.") from exc
        log.exception("auth user creation failed")
        raise AppError("Could not create the user.") from exc

    user_id = created.user.id
    profile = {"id": user_id, "email": email, "phone": phone_e164, "full_name": full_name, "role": role.value, "manager_id": manager_id}
    if not is_active:
        profile["is_active"] = False
    try:
        row = db.table("profiles").insert(profile).execute().data[0]
    except Exception as exc:
        # Do not leave a login without a profile behind.
        try:
            db.auth.admin.delete_user(user_id)
        except Exception:  # noqa: BLE001
            log.exception("rollback of auth user %s failed", user_id)
        log.exception("profile creation failed")
        raise AppError("Could not create the user.") from exc

    _users_changed()
    return row


def list_users(actor: Profile) -> list[dict]:
    return reference("userlist", actor.id, 20, lambda: _list_users(actor))


def _list_users(actor: Profile) -> list[dict]:
    """Admin: everyone. Manager: themselves and their team."""
    q = get_service_client().table("profiles").select(COLUMNS)
    if actor.role == Role.SALES_MANAGER:
        q = q.or_(f"id.eq.{actor.id},manager_id.eq.{actor.id}")
    elif actor.role != Role.ADMIN:
        raise ForbiddenError()
    rows = q.order("full_name").execute().data
    urls = signed_urls(AVATARS, [r.get("avatar_path") for r in rows])
    for r in rows:
        r["avatar_url"] = urls.get(r.pop("avatar_path", None) or "")
    return rows


def assignable_users(actor: Profile) -> list[dict]:
    return reference("assignable", actor.id, 30, lambda: _assignable_users(actor))


def _assignable_users(actor: Profile) -> list[dict]:
    """People a lead can be reassigned to."""
    q = get_service_client().table("profiles").select("id,full_name,role,manager_id").eq("is_active", True)
    q = q.in_("role", [Role.SALES_EXECUTIVE.value, Role.SALES_MANAGER.value])
    if actor.role == Role.SALES_MANAGER:
        q = q.or_(f"id.eq.{actor.id},manager_id.eq.{actor.id}")
    elif actor.role != Role.ADMIN:
        raise ForbiddenError()
    rows = q.order("full_name").execute().data
    urls = signed_urls(AVATARS, [r.get("avatar_path") for r in rows])
    for r in rows:
        r["avatar_url"] = urls.get(r.pop("avatar_path", None) or "")
    return rows


def update_user(actor: Profile, user_id: str, body: UserUpdate) -> UserOut:
    if actor.role != Role.ADMIN:
        raise ForbiddenError()
    patch = body.model_dump(exclude_none=True, exclude={"clear_manager", "password"})
    # Sign-in details live in Supabase Auth too: change them there first, so the two never disagree.
    auth: dict = {}
    if body.email:
        auth.update(email=body.email, email_confirm=True)
    if body.phone:
        _, patch["phone"] = normalize_identifier(body.phone)
        auth.update(phone=patch["phone"], phone_confirm=True)
    if body.password:
        auth["password"] = body.password
    if auth:
        try:
            get_service_client().auth.admin.update_user_by_id(user_id, auth)
        except Exception as exc:  # supabase AuthApiError
            msg = str(exc).lower()
            if "already" in msg or "exists" in msg or "registered" in msg:
                raise ConflictError("Another user already has this email or mobile number.") from exc
            log.exception("auth user update failed")
            raise AppError("Could not update the sign-in details.") from exc
        if not patch and body.password:  # only the password changed
            write_audit(actor.id, "password_set", "profiles", user_id, {})
            rows = get_service_client().table("profiles").select(COLUMNS).eq("id", user_id).limit(1).execute().data
            if not rows:
                raise NotFoundError("User not found.")
            return UserOut(**{k: rows[0].get(k) for k in OUT_COLUMNS}, avatar_url=signed_url(AVATARS, rows[0].get("avatar_path")))
    if "role" in patch:
        patch["role"] = body.role.value
    if body.clear_manager:
        patch["manager_id"] = None
    if user_id == actor.id and (patch.get("is_active") is False or ("role" in patch and body.role != Role.ADMIN)):
        raise ForbiddenError("You cannot remove your own admin access.")
    if not patch:
        raise AppError("Nothing to update.")
    res = get_service_client().table("profiles").update(patch).eq("id", user_id).execute()
    if not res.data:
        raise NotFoundError("User not found.")
    _users_changed()
    write_audit(actor.id, "update", "profiles", user_id, patch)
    return UserOut(**{k: res.data[0].get(k) for k in OUT_COLUMNS}, avatar_url=signed_url(AVATARS, res.data[0].get("avatar_path")))


def _users_changed(user_id: str | None = None) -> None:
    """Drop cached copies that depend on users: the profile itself, teams and the reassign picker."""
    invalidate_reference("profile", user_id)
    invalidate_reference("team")
    invalidate_reference("assignable")
    invalidate_reference("userlist")


# --- profile photos -------------------------------------------------------------------------------------

def _may_edit_photo(actor: Profile, target: dict) -> bool:
    if actor.id == target["id"] or actor.role == Role.ADMIN:
        return True
    return actor.role == Role.SALES_MANAGER and target.get("manager_id") == actor.id


def _target(actor: Profile, user_id: str) -> dict:
    rows = get_service_client().table("profiles").select("*").eq("id", user_id).limit(1).execute().data  # "*": works before the photo column exists
    if not rows:
        raise NotFoundError("User not found.")
    if not _may_edit_photo(actor, rows[0]):
        raise ForbiddenError("You cannot change this person's photo.")
    return rows[0]


def set_avatar(actor: Profile, user_id: str, data: bytes) -> dict:
    target = _target(actor, user_id)
    mime, ext = checked_upload(data)
    path = upload_image(AVATARS, user_id, data, mime, ext)
    guard_photo_write(AVATARS, path, lambda: get_service_client().table("profiles").update({"avatar_path": path}).eq("id", user_id).execute())
    delete_image(AVATARS, target.get("avatar_path"))  # the previous photo, in the background
    _users_changed(user_id)
    write_audit(actor.id, "update", "profiles", user_id, {"avatar": True})
    return {"avatarUrl": signed_url(AVATARS, path)}


def remove_avatar(actor: Profile, user_id: str) -> None:
    target = _target(actor, user_id)
    get_service_client().table("profiles").update({"avatar_path": None}).eq("id", user_id).execute()
    delete_image(AVATARS, target.get("avatar_path"))
    _users_changed(user_id)
