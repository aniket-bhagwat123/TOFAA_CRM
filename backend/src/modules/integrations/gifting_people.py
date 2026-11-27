"""People for TOFAA Gifting OS, server to server. The CRM is the master copy of People.

Mounted at /api/v1/integrations/gifting. Every call needs the shared key (X-API-Key) and names the Gifting OS client
(X-Tenant-Id). It runs the CRM's own People endpoints (same rules, duplicate checks, history, version checks), but
as an ExternalActor limited to the client account linked to that tenant, so one client can never reach another's
people. Who did it travels in X-Actor-Name / X-Actor-Role / X-Actor-Kind (CLIENT or TOFAA) for the history.

Extra endpoints:
  GET  /tenant          the linked client account (404 code TENANT_NOT_LINKED before linking)
  PUT  /tenant          link the tenant: an account with the same name, else a new client account
  GET  /people-sync     full rows (with addresses, preferences, links) changed since a moment, for the Gifting OS mirror
  GET  /groups-sync     every group of every linked client with its members (a full snapshot, so deletions show too)
"""
import logging
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Header, Query
from pydantic import Field

from src.core.config import settings
from src.core.errors import AppError, register_error_handlers
from src.core.keys import company_key
from src.core.schema import CamelModel, ok
from src.core.soft_delete import live
from src.core.storage import CLIENT_IMAGES, signed_urls
from src.core.supabase import get_service_client
from src.modules.auth.dependencies import get_current_user
from src.modules.auth.schemas import KAM_VALUES, Role
from src.modules.integrations.router import require_gifting_os_key
from src.modules.people import router as people_router
from src.modules.people.service import ExternalActor

log = logging.getLogger(__name__)
NOT_LINKED = "TENANT_NOT_LINKED"
SYNC_PAGE = 300
PERSON_COLS = (
    "id,company_id,name,mobile_number,email,company_name,designation,department,city,date_of_birth,anniversary_date,"
    "budget,birthday_budget,anniversary_budget,gifting_occasion,remark,photo_path,relationship,recipient_type,status,"
    "is_primary,version,source,added_by,deleted_at,created_at,updated_at,changed_at"
)

TenantDep = Annotated[str, Header(alias="X-Tenant-Id", min_length=36, max_length=36)]


def linked_company(tenant_id: str) -> dict | None:
    q = get_service_client().table("companies").select("id,name,client_since,account_owner_id").eq("gifting_tenant_id", tenant_id)
    rows = live(q, "companies").limit(1).execute().data
    return rows[0] if rows else None


def _company_or_404(tenant_id: str) -> dict:
    company = linked_company(tenant_id)
    if not company or not company.get("client_since"):
        raise AppError("This Gifting OS client is not linked to a CRM client account yet.", {"code": NOT_LINKED}, 404)
    return company


def external_actor(
    tenant_id: TenantDep,
    _key: Annotated[None, Depends(require_gifting_os_key)],
    actor_name: Annotated[str | None, Header(alias="X-Actor-Name", max_length=120)] = None,
    actor_role: Annotated[str | None, Header(alias="X-Actor-Role", max_length=40)] = None,
    actor_kind: Annotated[Literal["CLIENT", "TOFAA"], Header(alias="X-Actor-Kind")] = "TOFAA",
) -> ExternalActor:
    """Stands in for the signed-in CRM user on every People endpoint of this app."""
    company = _company_or_404(tenant_id)
    return ExternalActor(
        id=f"gifting:{company['id']}", role=Role.KAM, company_id=company["id"], full_name=(actor_name or "Gifting OS").strip()[:120],
        added_by=actor_kind, actor_role=(actor_role or "").strip()[:40] or None,
    )


app = FastAPI(title="CRM People for Gifting OS", openapi_url=None, docs_url=None, redoc_url=None)
register_error_handlers(app)
app.dependency_overrides[get_current_user] = external_actor
app.include_router(people_router.router)


class LinkIn(CamelModel):
    name: str = Field(min_length=1, max_length=200)


@app.get("/tenant")
def tenant(tenant_id: TenantDep, _key: Annotated[None, Depends(require_gifting_os_key)]):
    company = _company_or_404(tenant_id)
    return ok({"company_id": company["id"], "name": company["name"]})


@app.get("/account")
def account(tenant_id: TenantDep, _key: Annotated[None, Depends(require_gifting_os_key)]):
    """The CRM's own facts about this client, shown to TOFAA staff in Gifting OS: account owner and business contacts."""
    company = _company_or_404(tenant_id)
    db = get_service_client()
    owner = None
    if company.get("account_owner_id"):
        rows = db.table("profiles").select("full_name,email").eq("id", company["account_owner_id"]).limit(1).execute().data
        owner = rows[0] if rows else None
    contacts = db.table("contacts").select("name,designation,phone,email").eq("company_id", company["id"]).order("created_at").limit(100).execute().data
    return ok({"name": company["name"], "owner": owner, "contacts": contacts})


@app.put("/tenant")
def link_tenant(body: LinkIn, tenant_id: TenantDep, _key: Annotated[None, Depends(require_gifting_os_key)]):
    company = link_account(tenant_id, body.name)
    return ok({"company_id": company["id"], "name": company["name"]})


def link_account(tenant_id: str, name: str) -> dict:
    """Link this Gifting OS client to a CRM client account: the one already linked, else one with the same name (made a
    client if it was not), else a new client account owned by GIFTING_OS_ACCOUNT_OWNER (a KAM's email)."""
    db = get_service_client()
    company = linked_company(tenant_id)
    now = datetime.now(timezone.utc).isoformat()
    if not company:
        key = company_key(name)
        same = live(db.table("companies").select("id,name,client_since,account_owner_id,gifting_tenant_id").eq("name_key", key), "companies").limit(1).execute().data
        if same and same[0].get("gifting_tenant_id"):
            raise AppError(f"The CRM account {same[0]['name']!r} is already linked to another Gifting OS client.", status_code=409)
        owner = _owner_id()
        if same:
            company = same[0]
            patch = {"gifting_tenant_id": tenant_id} | ({} if company.get("client_since") else {"client_since": now}) \
                | ({} if company.get("account_owner_id") or not owner else {"account_owner_id": owner})
            db.table("companies").update(patch).eq("id", company["id"]).execute()
        else:
            company = db.table("companies").insert({
                "name": name.strip(), "name_key": key, "created_by": owner, "client_since": now,
                "account_owner_id": owner, "gifting_tenant_id": tenant_id,
            }).execute().data[0]
        # People already in this account changed before Gifting OS's "changed after" mark: mark them changed again so
        # the next sync copies all of them (a trigger sets changed_at).
        db.table("recipients").update({"changed_at": now}).eq("company_id", company["id"]).execute()
        log.info("linked Gifting OS tenant %s to CRM account %s", tenant_id, company["id"])
    elif not company.get("client_since"):
        db.table("companies").update({"client_since": now}).eq("id", company["id"]).execute()
    return company


def _owner_id() -> str | None:
    who = (settings.GIFTING_OS_ACCOUNT_OWNER or "").strip().lower()
    if not who:
        return None
    rows = get_service_client().table("profiles").select("id,email,role").ilike("email", who).limit(1).execute().data
    return rows[0]["id"] if rows and rows[0].get("role") in (*KAM_VALUES, "admin") else None


@app.get("/people-sync")
def people_sync(
    _key: Annotated[None, Depends(require_gifting_os_key)],
    since: str | None = None,
    ids: Annotated[str | None, Query(max_length=40 * 200)] = None,
    limit: Annotated[int, Query(ge=1, le=SYNC_PAGE)] = SYNC_PAGE,
):
    """People of every linked client, deleted ones included, with everything the Gifting OS mirror stores.
    Either the given ids, or those changed after `since` (oldest first; follow next_since while more is true)."""
    db = get_service_client()
    tenants = {c["id"]: c["gifting_tenant_id"] for c in
               db.table("companies").select("id,gifting_tenant_id").not_.is_("gifting_tenant_id", "null").execute().data}
    if not tenants:
        return ok({"items": [], "next_since": since, "more": False})
    q = db.table("recipients").select(PERSON_COLS).in_("company_id", list(tenants))
    if ids:
        q = q.in_("id", [i for i in ids.split(",") if i][:200])
    elif since:
        q = q.gt("changed_at", since)
    rows = q.order("changed_at").order("id").limit(limit).execute().data
    people = [r["id"] for r in rows]
    addresses, prefs, links = _parts(db, people)
    photos = signed_urls(CLIENT_IMAGES, [r.get("photo_path") for r in rows])
    items = [{
        **r, "gifting_tenant_id": tenants[r["company_id"]], "photo_url": photos.get(r.get("photo_path") or ""),
        "addresses": addresses.get(r["id"], []), "preferences": prefs.get(r["id"]), "relationships": links.get(r["id"], []),
    } for r in rows]
    return ok({"items": items, "next_since": rows[-1]["changed_at"] if rows else since, "more": not ids and len(rows) == limit})


def _all(query) -> list[dict]:
    """Every row of a query. The database returns at most one page per call, and a short snapshot would look like
    deletions to Gifting OS, so read until an empty page."""
    rows: list[dict] = []
    while True:
        page = query().range(len(rows), len(rows) + SYNC_PAGE - 1).execute().data
        if not page:
            return rows
        rows.extend(page)


@app.get("/groups-sync")
def groups_sync(_key: Annotated[None, Depends(require_gifting_os_key)]):
    db = get_service_client()
    tenants = {c["id"]: c["gifting_tenant_id"] for c in
               _all(lambda: db.table("companies").select("id,gifting_tenant_id").not_.is_("gifting_tenant_id", "null").order("id"))}
    if not tenants:
        return ok({"tenant_ids": [], "items": []})
    groups = _all(lambda: db.table("recipient_groups").select("id,company_id,name,updated_at").in_("company_id", list(tenants)).order("id"))
    members: dict[str, list[str]] = {g["id"]: [] for g in groups}
    ids = list(members)
    for i in range(0, len(ids), 150):
        part = ids[i:i + 150]
        for m in _all(lambda: db.table("recipient_group_members").select("group_id,recipient_id").in_("group_id", part).order("group_id").order("recipient_id")):
            members[m["group_id"]].append(m["recipient_id"])
    items = [{"id": g["id"], "tenant_id": tenants[g["company_id"]], "name": g["name"], "updated_at": g["updated_at"],
              "recipient_ids": members[g["id"]]} for g in groups]
    return ok({"tenant_ids": sorted(tenants.values()), "items": items})


def _parts(db, ids: list[str]) -> tuple[dict, dict, dict]:
    addresses: dict[str, list] = {}
    prefs: dict[str, dict] = {}
    links: dict[str, list] = {}
    for i in range(0, len(ids), 150):
        part = ids[i:i + 150]
        for a in db.table("recipient_addresses").select("*").in_("recipient_id", part).order("created_at").execute().data:
            addresses.setdefault(a["recipient_id"], []).append(a)
        for p in db.table("recipient_preferences").select("*").in_("recipient_id", part).execute().data:
            prefs[p["recipient_id"]] = p
        for x in db.table("recipient_relationships").select("id,recipient_id,related_recipient_id,relationship_type,created_at").in_("recipient_id", part).execute().data:
            links.setdefault(x["recipient_id"], []).append(x)
    return addresses, prefs, links
