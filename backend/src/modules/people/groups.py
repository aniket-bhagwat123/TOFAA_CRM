"""Groups of people within one client, to plan and gift many at once. KAM and admin only."""
from src.core.dates import now_ist
from src.core.errors import AppError, ConflictError, NotFoundError
from src.core.supabase import get_service_client
from src.modules.auth.schemas import Profile
from src.modules.people import schemas
from src.modules.people.service import _db, client_account, company_scope, require_delete

SELECT = "id,company_id,name,created_at,updated_at,company:companies(name),members:recipient_group_members(recipient_id)"


def _shape(g: dict) -> dict:
    members = [m["recipient_id"] for m in (g.pop("members", None) or [])]
    company = g.pop("company", None) or {}
    return {**g, "account_name": company.get("name"), "recipient_ids": members, "count": len(members)}


def list_groups(user: Profile, company_id: str | None) -> list[dict]:
    scope = company_scope(user)
    if company_id:
        client_account(user, company_id)
    q = get_service_client().table("recipient_groups").select(SELECT)
    if company_id:
        q = q.eq("company_id", company_id)
    elif scope is not None:
        q = q.in_("company_id", scope or ["00000000-0000-0000-0000-000000000000"])
    return [_shape(g) for g in _db(lambda: q.order("name").limit(2000).execute().data)]


def _group(user: Profile, group_id: str) -> dict:
    rows = _db(lambda: get_service_client().table("recipient_groups").select(SELECT).eq("id", group_id).limit(1).execute().data)
    scope = company_scope(user)
    if not rows or (scope is not None and rows[0]["company_id"] not in scope):
        raise NotFoundError("Group not found.")
    return rows[0]


def _check_members(company_id: str, ids: list[str]) -> None:
    """Members must be live people of the group's client."""
    if not ids:
        return
    found = set()
    for i in range(0, len(ids), 150):
        found |= {r["id"] for r in get_service_client().table("recipients").select("id").in_("id", ids[i : i + 150])
                  .eq("company_id", company_id).is_("deleted_at", "null").execute().data}
    if len(found) != len(set(ids)):
        raise AppError("Every person in a group must be one of this client's people.", status_code=422)


def _name_taken(exc: Exception) -> bool:
    return "recipient_groups_company_name_uq" in str(exc) or "23505" in str(exc)


def _set_members(group_id: str, ids: list[str]) -> None:
    db = get_service_client()
    db.table("recipient_group_members").delete().eq("group_id", group_id).execute()
    for i in range(0, len(ids), 500):
        db.table("recipient_group_members").insert([{"group_id": group_id, "recipient_id": r} for r in ids[i : i + 500]]).execute()


def create(user: Profile, body: schemas.GroupIn) -> dict:
    client_account(user, body.company_id)
    _check_members(body.company_id, body.recipient_ids)
    try:
        g = _db(lambda: get_service_client().table("recipient_groups").insert({"company_id": body.company_id, "name": body.name.strip(), "created_by": user.id}).execute().data[0])
    except AppError:
        raise
    except Exception as exc:
        if _name_taken(exc):
            raise ConflictError("This client already has a group with that name.", data={"errors": [{"field": "name", "message": "Name already used"}]}) from exc
        raise
    _set_members(g["id"], body.recipient_ids)
    return _shape(_group(user, g["id"]))


def update(user: Profile, group_id: str, body: schemas.GroupUpdate) -> dict:
    """Rename, replace the members (recipient_ids), or add people and keep the rest (add_recipient_ids)."""
    g = _group(user, group_id)
    if body.name is not None and body.name.strip() != g["name"]:
        try:
            get_service_client().table("recipient_groups").update({"name": body.name.strip(), "updated_at": now_ist().isoformat()}).eq("id", group_id).execute()
        except Exception as exc:
            if _name_taken(exc):
                raise ConflictError("This client already has a group with that name.", data={"errors": [{"field": "name", "message": "Name already used"}]}) from exc
            raise
    members = [m["recipient_id"] for m in (g.get("members") or [])]
    if body.recipient_ids is not None:
        members = list(dict.fromkeys(body.recipient_ids))
    if body.add_recipient_ids:
        members = list(dict.fromkeys([*members, *body.add_recipient_ids]))
    if body.recipient_ids is not None or body.add_recipient_ids:
        _check_members(g["company_id"], members)
        _set_members(group_id, members)
        # A change of members counts as an update too, so "Updated <date>" on the Groups tab stays true.
        get_service_client().table("recipient_groups").update({"updated_at": now_ist().isoformat()}).eq("id", group_id).execute()
    return _shape(_group(user, group_id))


def delete(user: Profile, group_id: str) -> None:
    require_delete(user)
    _group(user, group_id)
    get_service_client().table("recipient_groups").delete().eq("id", group_id).execute()  # members go with it


def bulk_delete(user: Profile, ids: list[str]) -> dict:
    deleted = 0
    for gid in ids:
        try:
            delete(user, gid)
            deleted += 1
        except NotFoundError:
            continue
    return {"deleted": deleted}
