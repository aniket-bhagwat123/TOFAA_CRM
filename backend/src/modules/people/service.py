"""People: the recipients of a client's gifts (employees, partners, family ...), kept under the client account.

KAM and admin only. A KAM works with the people of the client accounts they own; an admin with every account.
Someone else's account or person answers "not found", so ids from other accounts reveal nothing.
One shared record per person: details, delivery addresses, preferences, links to other people, groups, a computed
completeness score and an append-only change history. Saving an old copy is refused (optimistic locking).
"""
import logging
import re
from typing import Literal

from src.core.selected_client import selected_client
from src.core import cache
from src.core.dates import now_ist, today_ist
from src.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from src.core.images import checked_upload
from src.core.keys import email_key, normalize_phone10, phone_key
from src.core.parallel import par
from src.core.soft_delete import live
from src.core.storage import CLIENT_IMAGES, delete_image, signed_urls, upload_image
from src.core.supabase import get_service_client
from src.modules.auth.schemas import Profile, Role
from src.modules.people import rules, schemas

log = logging.getLogger(__name__)
ROLES = (Role.ADMIN, Role.SALES_MANAGER, Role.KAM)
NOT_READY = "People is not set up yet. An admin needs to apply the database migration 20260120000000_people_and_banners.sql, then try again."
PERSON = "*, company:companies(id,name)"
CHUNK = 150          # ids per request for bulk work
MEMORY_LIMIT = 5000  # rows read when the list must be sorted or filtered in Python
INTL = re.compile(r"^\+?[1-9][0-9]{7,14}$")


# --- access -----------------------------------------------------------------------------------------------------------

class ExternalActor(Profile):
    """Someone signed in to TOFAA Gifting OS, working on one client's people through the integration API.

    Not a CRM user: rows they write have no CRM user id (created_by / updated_by / actor_id stay empty); the history
    keeps their name and Gifting OS role instead. They only ever reach the one client account linked to their tenant."""

    company_id: str
    added_by: Literal["CLIENT", "TOFAA"] = "TOFAA"
    actor_role: str | None = None


def uid(user: Profile) -> str | None:
    """The CRM user id to store as author, or None for someone from Gifting OS."""
    return None if isinstance(user, ExternalActor) else user.id


def require_role(user: Profile) -> None:
    if user.role not in ROLES:
        raise ForbiddenError("People is for KAMs, sales managers and admins.")


def require_delete(user: Profile) -> None:
    """Deleting people and groups is for sales managers and admins: a deleted person leaves Gifting OS too, so a KAM
    archives instead. (Someone signed in to Gifting OS acts there under its own rules.)"""
    require_role(user)
    if user.role == Role.KAM and not isinstance(user, ExternalActor):
        raise ForbiddenError("Only a sales manager or an admin can delete. Archive instead.")


def company_scope(user: Profile) -> list[str] | None:
    """Client accounts the user may work with: None means all (admin, sales manager); a KAM, the accounts they own,
    or just the one picked in the header; someone from Gifting OS, only their own client's account."""
    require_role(user)
    if isinstance(user, ExternalActor):
        return [user.company_id]
    if user.role in (Role.ADMIN, Role.SALES_MANAGER):
        picked = selected_client(user)  # an admin's header pick
        return [picked] if picked else None

    def load() -> list[str]:
        q = get_service_client().table("companies").select("id").eq("account_owner_id", user.id).not_.is_("client_since", "null")
        return [r["id"] for r in live(q, "companies").limit(5000).execute().data]

    owned = cache.memo("people-scope", user.id, None, 30, load)
    picked = selected_client(user)
    return [c for c in owned if c == picked] if picked else owned


def client_account(user: Profile, company_id: str) -> dict:
    """A live client account the user may work with (else "not found")."""
    scope = company_scope(user)
    if scope is not None and company_id not in scope:
        raise NotFoundError("Client not found.")
    q = get_service_client().table("companies").select("id,name,client_since").eq("id", company_id)
    rows = live(q, "companies").limit(1).execute().data
    if not rows or not rows[0].get("client_since"):
        raise NotFoundError("Client not found.")
    return rows[0]


def _missing(exc: Exception) -> bool:
    text = str(exc)
    return "recipient" in text and ("does not exist" in text or "42P01" in text or "PGRST205" in text)


def _db(fn):
    """Run a query; before the migration, say what to do instead of a vague error."""
    try:
        return fn()
    except Exception as exc:
        if _missing(exc):
            raise AppError(NOT_READY, status_code=503) from exc
        raise


def person_row(user: Profile, recipient_id: str, *, include_deleted: bool = False) -> dict:
    """The person, if they belong to an account the user may work with."""
    rows = _db(lambda: get_service_client().table("recipients").select(PERSON).eq("id", recipient_id).limit(1).execute().data)
    if not rows or (rows[0].get("deleted_at") and not include_deleted):
        raise NotFoundError("Person not found.")
    scope = company_scope(user)
    if scope is not None and rows[0]["company_id"] not in scope:
        raise NotFoundError("Person not found.")
    return rows[0]


# --- history ----------------------------------------------------------------------------------------------------------

def record(user: Profile, recipient_ids: list[str], action: str, changes: list[tuple] | None = None, source: str = "MANUAL") -> None:
    """Append to the history. Never blocks the change itself."""
    rows = []
    for rid in recipient_ids:
        base = {"recipient_id": rid, "actor_id": uid(user), "actor_name": user.full_name, "action": action, "source": source}
        if isinstance(user, ExternalActor):
            base["actor_role"] = user.actor_role
        if changes:
            rows += [{**base, "field": f, "old_value": _json(o), "new_value": _json(n)} for f, o, n in changes]
        else:
            rows.append(base)
    if not rows:
        return
    try:
        for i in range(0, len(rows), 500):
            get_service_client().table("recipient_audit").insert(rows[i : i + 500]).execute()
    except Exception:  # noqa: BLE001
        log.warning("could not write the people history", exc_info=True)


def _json(v):
    return None if v is None else (v if isinstance(v, (bool, int, float)) else str(v))


def history(user: Profile, recipient_id: str, page: int = 1, limit: int = 30) -> dict:
    person_row(user, recipient_id, include_deleted=True)
    start = (max(page, 1) - 1) * limit
    res = get_service_client().table("recipient_audit").select("*", count="exact").eq("recipient_id", recipient_id) \
        .order("created_at", desc=True).range(start, start + limit - 1).execute()
    return {"items": res.data, "total": res.count or 0, "page": page, "limit": limit}


# --- shaping ----------------------------------------------------------------------------------------------------------

def _mobile(raw: str | None) -> tuple[str | None, str | None]:
    """(stored number, duplicate key). A 10-digit Indian mobile becomes +91XXXXXXXXXX."""
    if not raw:
        return None, None
    ten = normalize_phone10(raw)
    if ten:
        return f"+91{ten}", phone_key(ten)
    digits = "+" + re.sub(r"\D", "", raw) if raw.strip().startswith("+") else re.sub(r"\D", "", raw)
    if not INTL.match(digits):
        raise AppError("Enter a valid mobile number, for example 98765 43210 or +44 7700 900123.",
                       {"errors": [{"field": "mobileNumber", "message": "Enter a valid mobile number"}]}, 422)
    return digits, phone_key(digits)


def _enrich(rows: list[dict]) -> list[dict]:
    """Groups, completeness, next occasion, photo link and account name for a whole page at once (never one query per
    person). A failed lookup leaves that decoration off; the list still loads."""
    if not rows:
        return rows
    ids = [r["id"] for r in rows]
    db = get_service_client()

    def safe(fn, default):
        try:
            return fn()
        except Exception:  # noqa: BLE001
            log.warning("people list decoration failed", exc_info=True)
            return default

    def by_chunks(table: str, cols: str) -> list[dict]:  # ids in chunks, so a long export never builds an over-long URL
        out: list[dict] = []
        for i in range(0, len(ids), CHUNK):
            out += db.table(table).select(cols).in_("recipient_id", ids[i : i + CHUNK]).execute().data
        return out

    members, links, addresses, prefs = par(
        lambda: safe(lambda: by_chunks("recipient_group_members", "recipient_id,group:recipient_groups(id,name)"), []),
        lambda: safe(lambda: by_chunks("recipient_relationships", "recipient_id"), []),
        lambda: safe(lambda: by_chunks("recipient_addresses", "recipient_id"), []),
        lambda: safe(lambda: by_chunks("recipient_preferences", "recipient_id,interests,gift_preferences,preferred_brands"), []),
    )
    groups: dict[str, list] = {}
    for m in members:
        if m.get("group"):
            groups.setdefault(m["recipient_id"], []).append({"id": m["group"]["id"], "name": m["group"]["name"]})
    from collections import Counter

    link_n, addr_n = Counter(x["recipient_id"] for x in links), Counter(x["recipient_id"] for x in addresses)
    has_pref = {p["recipient_id"] for p in prefs if p.get("interests") or p.get("gift_preferences") or p.get("preferred_brands")}
    photos = signed_urls(CLIENT_IMAGES, [r.get("photo_path") for r in rows])
    today = today_ist()
    out = []
    for r in rows:
        company = r.pop("company", None) or {}
        out.append({
            **{k: v for k, v in r.items() if k not in ("photo_path", "mobile_key")},
            "account": {"id": r["company_id"], "name": company.get("name")},
            "photo_url": photos.get(r.get("photo_path") or ""),
            "groups": sorted(groups.get(r["id"], []), key=lambda g: g["name"].lower()),
            "next_occasion": rules.next_occasion(r, today),
            "completeness": rules.completeness(r, links=link_n[r["id"]], addresses=addr_n[r["id"]], has_preferences=r["id"] in has_pref),
        })
    return out


# --- list -------------------------------------------------------------------------------------------------------------

SORTS = {"name": "name", "city": "city", "mobile": "mobile_number", "created": "created_at"}


def _search(term: str) -> str:
    return re.sub(r"[,()%*\\:]", " ", term).strip()


def list_people(user: Profile, *, company_id: str | None, page: int, limit: int, search: str | None, relationship: str | None,
                city: str | None, group_id: str | None, status: str | None, upcoming_days: int | None, sort: str, order: str,
                recipient_ids: list[str] | None = None) -> dict:
    """Paged, filtered, sorted list. The database pages; only "upcoming occasion" and "sort by next occasion" are
    worked out in Python (over at most MEMORY_LIMIT rows)."""
    scope = company_scope(user)
    if company_id:
        client_account(user, company_id)
    if scope is not None and not scope:
        return {"items": [], "total": 0, "page": page, "limit": limit}
    db = get_service_client()
    q = db.table("recipients").select(PERSON, count="exact").is_("deleted_at", "null")
    if company_id:
        q = q.eq("company_id", company_id)
    elif scope is not None:
        q = q.in_("company_id", scope)
    if recipient_ids is not None:
        if not recipient_ids:
            return {"items": [], "total": 0, "page": page, "limit": limit}
        q = q.in_("id", recipient_ids[:100])
    if group_id:
        member_ids = [m["recipient_id"] for m in _db(lambda: db.table("recipient_group_members").select("recipient_id").eq("group_id", group_id).execute().data)]
        if not member_ids:
            return {"items": [], "total": 0, "page": page, "limit": limit}
        q = q.in_("id", member_ids[:MEMORY_LIMIT])
    q = q.eq("status", status) if status in ("ACTIVE", "ARCHIVED") else q.eq("status", "ACTIVE") if status != "ALL" else q
    if relationship:
        q = q.eq("relationship", relationship)
    if city:
        q = q.ilike("city", _search(city))
    if search and _search(search):
        t = _search(search)
        digits = re.sub(r"\D", "", t)
        clauses = [f"name.ilike.%{t}%", f"email.ilike.%{t}%", f"city.ilike.%{t}%", f"designation.ilike.%{t}%"]
        if len(digits) >= 3:
            clauses.append(f"mobile_number.ilike.%{digits}%")
        q = q.or_(",".join(clauses))

    desc = order == "desc" if order in ("asc", "desc") else sort == "created"
    start = (max(page, 1) - 1) * limit
    if upcoming_days or sort == "nextOccasion":
        rows = _db(lambda: q.order("name").limit(MEMORY_LIMIT).execute().data)
        today = today_ist()
        if upcoming_days:
            rows = [r for r in rows if (o := rules.next_occasion(r, today)) and o["days_away"] <= upcoming_days]
        if sort == "nextOccasion":
            rows.sort(key=lambda r: ((o := rules.next_occasion(r, today)) is None, (o or {}).get("days_away", 0)), reverse=desc)
        return {"items": _enrich(rows[start : start + limit]), "total": len(rows), "page": page, "limit": limit}
    col = SORTS.get(sort, "created_at")
    res = _db(lambda: q.order(col, desc=desc).order("id").range(start, start + limit - 1).execute())
    return {"items": _enrich(res.data), "total": res.count or 0, "page": page, "limit": limit}


def summary(user: Profile, company_id: str | None) -> dict:
    """Counts and filter choices (cities, relationships) for the list header."""
    scope = company_scope(user)
    if company_id:
        client_account(user, company_id)

    def load() -> dict:
        q = get_service_client().table("recipients").select("status,city,relationship").is_("deleted_at", "null")
        q = q.eq("company_id", company_id) if company_id else (q.in_("company_id", scope or ["00000000-0000-0000-0000-000000000000"]) if scope is not None else q)
        rows = _db(lambda: q.limit(20000).execute().data)
        return {
            "total": len(rows), "active": sum(1 for r in rows if r["status"] == "ACTIVE"), "archived": sum(1 for r in rows if r["status"] == "ARCHIVED"),
            "cities": sorted({(r.get("city") or "").strip() for r in rows if r.get("city")}, key=str.lower),
            "relationships": sorted({r["relationship"] for r in rows if r.get("relationship")}),
        }

    return cache.memo("people-summary", user.id, company_id, 20, load)


# --- duplicates ------------------------------------------------------------------------------------------------------

def find_duplicates(user: Profile, company_id: str, name: str | None, mobile: str | None, email: str | None, exclude_id: str | None = None) -> list[dict]:
    """Same mobile, same email, or a similar name in the same account: likely the same person."""
    client_account(user, company_id)
    db = get_service_client()
    clauses = []
    mk = phone_key(mobile) if mobile else None
    ek = email_key(email)
    if mk:
        clauses.append(f"mobile_key.eq.{mk}")
    if ek:
        clauses.append(f"email.ilike.{ek}")
    if name and len(name.strip()) >= 3:
        clauses.append(f"name.ilike.%{_search(name)}%")
    if not clauses:
        return []
    rows = _db(lambda: db.table("recipients").select("id,name,mobile_number,mobile_key,email,city,status").eq("company_id", company_id)
               .is_("deleted_at", "null").or_(",".join(clauses)).limit(20).execute().data)
    out = []
    for r in rows:
        if r["id"] == exclude_id:
            continue
        reasons = [x for x, hit in (("SAME_MOBILE", mk and r.get("mobile_key") == mk), ("SAME_EMAIL", ek and email_key(r.get("email")) == ek),
                                    ("SAME_NAME", name and name.strip().lower() in (r.get("name") or "").lower())) if hit]
        if reasons:
            out.append({k: r[k] for k in ("id", "name", "mobile_number", "email", "city", "status")} | {"reasons": reasons})
    return out


# --- create / read / update / delete ----------------------------------------------------------------------------------

def _columns(body) -> dict:
    data = body.model_dump(exclude_unset=True, mode="json", exclude={"company_id", "allow_duplicate", "address", "version"})
    if "mobile_number" in data:
        data["mobile_number"], data["mobile_key"] = _mobile(data["mobile_number"])
    if "email" in data and data["email"]:
        data["email"] = data["email"].strip().lower()
    return data


def create(user: Profile, body: schemas.RecipientCreate, source: str = "MANUAL") -> dict:
    client_account(user, body.company_id)
    data = _columns(body)
    if not data.get("city") and body.address:
        data["city"] = body.address.city
    if not body.allow_duplicate:
        dups = find_duplicates(user, body.company_id, body.name, data.get("mobile_number"), data.get("email"))
        if dups:
            raise ConflictError("This person may already be in this client's people.", data={"duplicates": dups})
    row = {**data, "company_id": body.company_id, "source": source, "created_by": uid(user), "updated_by": uid(user)}
    if isinstance(user, ExternalActor):
        row["added_by"] = user.added_by
    try:
        person = _db(lambda: get_service_client().table("recipients").insert(row).execute().data[0])
    except AppError:
        raise
    except Exception as exc:
        if "recipients_company_mobile_uq" in str(exc) or "23505" in str(exc):
            raise ConflictError("Someone in this client's people already has this mobile number.",
                                data={"errors": [{"field": "mobileNumber", "message": "Already used by another person"}]}) from exc
        raise
    if body.address:
        try:
            add_address(user, person["id"], schemas.AddressIn(**{**body.address.model_dump(), "is_default": True}), log_it=False)
        except Exception:  # noqa: BLE001 - the person is saved; the address can be added again
            log.warning("could not save the first address", exc_info=True)
    record(user, [person["id"]], "IMPORT" if source == "IMPORT" else "CREATE", source=source)
    return get(user, person["id"])


def get(user: Profile, recipient_id: str) -> dict:
    return _enrich([person_row(user, recipient_id)])[0]


def update(user: Profile, recipient_id: str, body: schemas.RecipientUpdate) -> dict:
    """Save edits from the copy the person had (version). If someone saved in between, refuse with the latest copy."""
    old = person_row(user, recipient_id)
    if body.version != old["version"]:
        raise ConflictError("Someone else saved this person while you were editing. Review the latest details and save again.",
                            data={"reason": "VERSION_CONFLICT", "current": _enrich([old])[0]})
    data = _columns(body)
    if data.get("mobile_key") and data["mobile_key"] != old.get("mobile_key"):
        clash = [d for d in find_duplicates(user, old["company_id"], None, data["mobile_number"], None, exclude_id=recipient_id) if "SAME_MOBILE" in d["reasons"]]
        if clash:
            raise ConflictError(f"{clash[0]['name']} already has this mobile number.", data={"errors": [{"field": "mobileNumber", "message": "Already used by another person"}]})
    patch = {**data, "version": old["version"] + 1, "updated_by": uid(user), "updated_at": now_ist().isoformat()}
    res = _db(lambda: get_service_client().table("recipients").update(patch).eq("id", recipient_id).eq("version", body.version).execute().data)
    if not res:  # a save landed between the read and this write
        latest = person_row(user, recipient_id)
        raise ConflictError("Someone else saved this person while you were editing. Review the latest details and save again.",
                            data={"reason": "VERSION_CONFLICT", "current": _enrich([latest])[0]})
    changes = rules.diff(old, data)
    action = ("ARCHIVE" if data["status"] == "ARCHIVED" else "RESTORE") if "status" in data and data["status"] != old["status"] else "EDIT"
    record(user, [recipient_id], action, changes)
    return get(user, recipient_id)


def delete(user: Profile, recipient_id: str) -> None:
    """Soft delete: hidden everywhere, kept in the database, can be restored."""
    require_delete(user)
    person_row(user, recipient_id)
    get_service_client().table("recipients").update({"deleted_at": now_ist().isoformat(), "updated_by": uid(user)}).eq("id", recipient_id).execute()
    record(user, [recipient_id], "DELETE")


def restore(user: Profile, recipient_id: str) -> dict:
    row = person_row(user, recipient_id, include_deleted=True)
    if not row.get("deleted_at"):
        return get(user, recipient_id)
    if row.get("mobile_key"):
        clash = get_service_client().table("recipients").select("name").eq("company_id", row["company_id"]).eq("mobile_key", row["mobile_key"]) \
            .is_("deleted_at", "null").limit(1).execute().data
        if clash:
            raise ConflictError(f"Can't restore: {clash[0]['name']} now has the same mobile number.")
    get_service_client().table("recipients").update({"deleted_at": None, "updated_by": uid(user)}).eq("id", recipient_id).execute()
    record(user, [recipient_id], "RESTORE")
    return get(user, recipient_id)


def _owned_ids(user: Profile, ids: list[str], *, include_deleted: bool = False) -> list[str]:
    """The ids (of these) the user may change."""
    scope = company_scope(user)
    out = []
    for i in range(0, len(ids), CHUNK):
        q = get_service_client().table("recipients").select("id,company_id").in_("id", ids[i : i + CHUNK])
        if not include_deleted:
            q = q.is_("deleted_at", "null")
        out += [r["id"] for r in _db(lambda q=q: q.execute().data) if scope is None or r["company_id"] in scope]
    return out


def bulk_delete(user: Profile, ids: list[str]) -> dict:
    require_delete(user)
    ok_ids = _owned_ids(user, ids)
    now = now_ist().isoformat()
    for i in range(0, len(ok_ids), CHUNK):
        get_service_client().table("recipients").update({"deleted_at": now, "updated_by": uid(user)}).in_("id", ok_ids[i : i + CHUNK]).execute()
    record(user, ok_ids, "DELETE")
    return {"affected": len(ok_ids)}


def bulk_status(user: Profile, ids: list[str], status: str) -> dict:
    scope = company_scope(user)
    changed: list[str] = []
    for i in range(0, len(ids), CHUNK):
        rows = get_service_client().table("recipients").select("id,company_id,status,version").in_("id", ids[i : i + CHUNK]).is_("deleted_at", "null").execute().data
        todo = [r for r in rows if (scope is None or r["company_id"] in scope) and r["status"] != status]
        for r in todo:  # each one's own version goes up, so open editors see the change
            get_service_client().table("recipients").update({"status": status, "version": r["version"] + 1, "updated_by": uid(user)}).eq("id", r["id"]).execute()
        changed += [r["id"] for r in todo]
    record(user, changed, "ARCHIVE" if status == "ARCHIVED" else "RESTORE")
    return {"affected": len(changed)}


# --- photo ------------------------------------------------------------------------------------------------------------

def set_photo(user: Profile, recipient_id: str, data: bytes) -> dict:
    row = person_row(user, recipient_id)
    mime, ext = checked_upload(data)
    path = upload_image(CLIENT_IMAGES, f"people/{row['company_id']}", data, mime, ext)
    try:
        get_service_client().table("recipients").update({"photo_path": path, "updated_by": uid(user)}).eq("id", recipient_id).execute()
    except Exception:
        delete_image(CLIENT_IMAGES, path)
        raise
    delete_image(CLIENT_IMAGES, row.get("photo_path"))
    return get(user, recipient_id)


def remove_photo(user: Profile, recipient_id: str) -> dict:
    row = person_row(user, recipient_id)
    get_service_client().table("recipients").update({"photo_path": None, "updated_by": uid(user)}).eq("id", recipient_id).execute()
    delete_image(CLIENT_IMAGES, row.get("photo_path"))
    return get(user, recipient_id)


# --- profile: addresses, preferences, links ---------------------------------------------------------------------------

def addresses(user: Profile, recipient_id: str) -> list[dict]:
    person_row(user, recipient_id)
    return get_service_client().table("recipient_addresses").select("*").eq("recipient_id", recipient_id).order("is_default", desc=True).order("created_at").execute().data


def _clear_default(recipient_id: str, keep: str | None = None) -> None:
    q = get_service_client().table("recipient_addresses").update({"is_default": False}).eq("recipient_id", recipient_id).eq("is_default", True)
    (q.neq("id", keep) if keep else q).execute()


def add_address(user: Profile, recipient_id: str, body: schemas.AddressIn, *, log_it: bool = True) -> dict:
    person_row(user, recipient_id)
    data = body.model_dump(mode="json")
    existing = get_service_client().table("recipient_addresses").select("id").eq("recipient_id", recipient_id).limit(1).execute().data
    if not existing:
        data["is_default"] = True  # the first address is the default
    if data["is_default"]:
        _clear_default(recipient_id)
    row = get_service_client().table("recipient_addresses").insert({**data, "recipient_id": recipient_id}).execute().data[0]
    if log_it:
        record(user, [recipient_id], "EDIT", [("address", None, f"{row['address_line1']}, {row['city']}")])
    return row


def update_address(user: Profile, recipient_id: str, address_id: str, body: schemas.AddressUpdate) -> dict:
    person_row(user, recipient_id)
    data = body.model_dump(exclude_unset=True, mode="json")
    if not data:
        raise AppError("Change at least one field.", status_code=422)
    if data.get("is_default"):
        _clear_default(recipient_id, keep=address_id)
    rows = get_service_client().table("recipient_addresses").update({**data, "updated_at": now_ist().isoformat()}).eq("id", address_id).eq("recipient_id", recipient_id).execute().data
    if not rows:
        raise NotFoundError("Address not found.")
    record(user, [recipient_id], "EDIT", [("address", None, f"{rows[0]['address_line1']}, {rows[0]['city']}")])
    return rows[0]


def delete_address(user: Profile, recipient_id: str, address_id: str) -> None:
    person_row(user, recipient_id)
    db = get_service_client()
    gone = db.table("recipient_addresses").delete().eq("id", address_id).eq("recipient_id", recipient_id).execute().data
    if gone and gone[0].get("is_default"):  # another address becomes the default
        rest = db.table("recipient_addresses").select("id").eq("recipient_id", recipient_id).order("created_at").limit(1).execute().data
        if rest:
            db.table("recipient_addresses").update({"is_default": True}).eq("id", rest[0]["id"]).execute()
    record(user, [recipient_id], "EDIT", [("address", "removed", None)])


def preferences(user: Profile, recipient_id: str) -> dict:
    person_row(user, recipient_id)
    rows = get_service_client().table("recipient_preferences").select("*").eq("recipient_id", recipient_id).limit(1).execute().data
    return rows[0] if rows else {"recipient_id": recipient_id, "interests": [], "preferred_brands": []}


def save_preferences(user: Profile, recipient_id: str, body: schemas.PreferencesIn) -> dict:
    person_row(user, recipient_id)
    data = {**body.model_dump(mode="json"), "recipient_id": recipient_id, "updated_by": uid(user), "updated_at": now_ist().isoformat()}
    row = get_service_client().table("recipient_preferences").upsert(data, on_conflict="recipient_id").execute().data[0]
    record(user, [recipient_id], "EDIT", [("preferences", None, "updated")])
    return row


def links(user: Profile, recipient_id: str) -> list[dict]:
    person_row(user, recipient_id)
    return get_service_client().table("recipient_relationships").select("id,related_recipient_id,relationship_type,related:recipients!related_recipient_id(id,name,deleted_at)") \
        .eq("recipient_id", recipient_id).execute().data


def save_links(user: Profile, recipient_id: str, body: schemas.LinksIn) -> list[dict]:
    """Replace the person's links. Linked people must be live people of the same client."""
    me = person_row(user, recipient_id)
    ids = [i.related_recipient_id for i in body.items]
    if recipient_id in ids:
        raise AppError("A person can't be linked to themselves.", status_code=422)
    if ids:
        ok_rows = get_service_client().table("recipients").select("id").in_("id", ids).eq("company_id", me["company_id"]).is_("deleted_at", "null").execute().data
        if len(ok_rows) != len(set(ids)):
            raise AppError("Link only people of the same client.", status_code=422)
    db = get_service_client()
    db.table("recipient_relationships").delete().eq("recipient_id", recipient_id).execute()
    if body.items:
        db.table("recipient_relationships").insert([{"recipient_id": recipient_id, "related_recipient_id": i.related_recipient_id,
                                                     "relationship_type": i.relationship_type, "created_by": uid(user)} for i in body.items]).execute()
    record(user, [recipient_id], "EDIT", [("relationships", None, f"{len(body.items)} linked")])
    return links(user, recipient_id)

