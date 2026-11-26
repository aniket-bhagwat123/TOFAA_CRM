"""Set up a CRM client account in Gifting OS and invite its users. KAMs see and invite for their own accounts;
creating the Gifting OS client is for admins (the same split Gifting OS has)."""
from datetime import datetime, timezone

from src.core.errors import ConflictError, ForbiddenError
from src.core.supabase import get_service_client
from src.modules.auth.schemas import Profile, Role
from src.modules.gifting_requests import service
from src.modules.integrations.people_notice import notifier
from src.modules.people.service import client_account

BASE = "/api/v1/integrations/crm/clients"


def _tenant_of(company_id: str) -> str | None:
    rows = get_service_client().table("companies").select("gifting_tenant_id").eq("id", company_id).limit(1).execute().data
    return str(rows[0]["gifting_tenant_id"]) if rows and rows[0].get("gifting_tenant_id") else None


def _actor(user: Profile) -> dict:
    return {"actorId": user.id, "actorName": (user.full_name or "TOFAA team")[:100]}


def status(user: Profile, company_id: str) -> dict:
    client_account(user, company_id)  # role and ownership
    tenant = _tenant_of(company_id)
    if not tenant:
        return {"linked": False, "canSetUp": user.role == Role.ADMIN and service.may_act(user), "canInvite": False, "users": []}
    data = service._call("/status", {"tenantIds": [tenant], "tenantId": tenant}, BASE)
    return {**data, "linked": True, "canSetUp": False, "canInvite": bool(data.get("actionsEnabled")) and service.may_act(user)}


def set_up(user: Profile, company_id: str) -> dict:
    service.require_may_act(user)
    if user.role != Role.ADMIN:
        raise ForbiddenError("Only an admin can create a Gifting OS client.")
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


def invite(user: Profile, company_id: str, email: str, full_name: str | None, client_role: str) -> dict:
    service.require_may_act(user)
    client_account(user, company_id)
    tenant = _tenant_of(company_id)
    if not tenant:
        raise ConflictError("Set this account up in Gifting OS first.")
    body = {"tenantIds": [tenant], "tenantId": tenant, "email": email, "fullName": full_name, "clientRole": client_role}
    return service._call("/invite", {**body, **_actor(user)}, BASE)
