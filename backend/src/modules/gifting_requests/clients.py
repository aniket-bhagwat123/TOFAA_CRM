"""Set up a CRM client account in Gifting OS and invite its users. KAMs see and invite for their own accounts;
creating the Gifting OS client is for admins and sales managers."""
import base64
from datetime import datetime, timezone

from src.core.errors import AppError, ConflictError, ForbiddenError
from src.core.images import sniff
from src.core.supabase import get_service_client
from src.modules.auth.schemas import Profile, Role
from src.modules.gifting_requests import logos, service
from src.modules.integrations.people_notice import notifier
from src.modules.people.service import client_account

BASE = "/api/v1/integrations/crm/clients"
MANAGERS = (Role.ADMIN, Role.SALES_MANAGER)  # who creates a client in Gifting OS and changes its details
LOGO_MAX_BYTES = 2 * 1024 * 1024


def _tenant_of(company_id: str) -> str | None:
    rows = get_service_client().table("companies").select("gifting_tenant_id").eq("id", company_id).limit(1).execute().data
    return str(rows[0]["gifting_tenant_id"]) if rows and rows[0].get("gifting_tenant_id") else None


def _actor(user: Profile) -> dict:
    return {"actorId": user.id, "actorName": (user.full_name or "TOFAA team")[:100]}


def status(user: Profile, company_id: str) -> dict:
    client_account(user, company_id)  # role and ownership
    tenant = _tenant_of(company_id)
    if not tenant:
        return {"linked": False, "canSetUp": user.role in MANAGERS and service.may_act(user), "canInvite": False, "canManage": False, "users": []}
    return _shown(user, service._call("/status", {"tenantIds": [tenant], "tenantId": tenant}, BASE))


def _shown(user: Profile, data: dict) -> dict:
    """The Gifting OS client with what this person may do with it."""
    open_ = bool(data.get("actionsEnabled")) and service.may_act(user)
    return {**data, "linked": True, "canSetUp": False, "canInvite": open_, "canManage": open_ and user.role in MANAGERS}


def set_up(user: Profile, company_id: str) -> dict:
    service.require_may_act(user)
    if user.role not in MANAGERS:
        raise ForbiddenError("Only an admin or a sales manager can create a Gifting OS client.")
    company = client_account(user, company_id)
    if _tenant_of(company_id):
        raise ConflictError("This account is already set up in Gifting OS.")
    tenant = service._call("/create", {"name": company["name"], **_actor(user)}, BASE)["tenantId"]
    db = get_service_client()
    if db.table("companies").select("id").eq("gifting_tenant_id", tenant).limit(1).execute().data:
        raise ConflictError("The Gifting OS client with this name is already linked to another CRM account.")
    db.table("companies").update({"gifting_tenant_id": tenant}).eq("id", company_id).is_("gifting_tenant_id", "null").execute()
    # Copy this account's people and groups now: mark the people changed, then tell Gifting OS.
    db.table("recipients").update({"changed_at": datetime.now(timezone.utc).isoformat()}).eq("company_id", company_id).execute()
    notifier.poke()
    return status(user, company_id)


def _linked(user: Profile, company_id: str, *, manage: bool) -> str:
    """The Gifting OS id of an account this person may change (`manage`: the client itself, not just its logins)."""
    service.require_may_act(user)
    if manage and user.role not in MANAGERS:
        raise ForbiddenError("Only an admin or a sales manager changes the client's Gifting OS details.")
    client_account(user, company_id)
    tenant = _tenant_of(company_id)
    if not tenant:
        raise ConflictError("Set this account up in Gifting OS first.")
    return tenant


def change_details(user: Profile, company_id: str, changes: dict) -> dict:
    tenant = _linked(user, company_id, manage=True)
    return _shown(user, service._call("/details", {"tenantId": tenant, **changes, **_actor(user)}, BASE))


def change_logo(user: Profile, company_id: str, data: bytes | None) -> dict:
    tenant = _linked(user, company_id, manage=True)
    body = {"tenantId": tenant, "content": None, "contentType": "", **_actor(user)}
    if data is not None:
        if len(data) > LOGO_MAX_BYTES:
            raise AppError("The logo must be 2 MB or smaller.", status_code=413)
        kind = sniff(data)
        if not kind:
            raise AppError("Use a PNG, JPEG or WebP picture.", status_code=422)
        body.update(content=base64.b64encode(data).decode(), contentType=kind[0])
    out = _shown(user, service._call("/logo", body, BASE))
    logos.forget()
    return out


def set_active(user: Profile, company_id: str, active: bool) -> dict:
    tenant = _linked(user, company_id, manage=True)
    service._call("/update", {"tenantId": tenant, "active": active, **_actor(user)}, BASE)
    logos.forget()
    return status(user, company_id)


def change_login(user: Profile, company_id: str, user_id: str, changes: dict) -> dict:
    tenant = _linked(user, company_id, manage=False)
    return _shown(user, service._call("/users/update", {"tenantId": tenant, "userId": user_id, **changes, **_actor(user)}, BASE))


def invite(user: Profile, company_id: str, email: str, full_name: str | None, client_role: str) -> dict:
    service.require_may_act(user)
    client_account(user, company_id)
    tenant = _tenant_of(company_id)
    if not tenant:
        raise ConflictError("Set this account up in Gifting OS first.")
    body = {"tenantIds": [tenant], "tenantId": tenant, "email": email, "fullName": full_name, "clientRole": client_role}
    return service._call("/invite", {**body, **_actor(user)}, BASE)
