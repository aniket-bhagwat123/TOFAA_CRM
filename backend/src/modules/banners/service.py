"""Dashboard banners for TOFAA Gifting OS: wide pictures shown as a rotating strip at the top of its dashboard.

Managed here by an admin (any banner) and by a KAM (banners for their own clients only); shown in Gifting OS, which
reads the live banners of the client being viewed through the integration API, and on the CRM's OS Home. A banner is for
every client or for chosen ones (company_ids; empty = every client), and can be scheduled (show from / until), switched
off, ordered, and aimed at everyone (KAM + admin), only KAM, or only admin. Every picture is exactly 2156 x 198.
Pictures live in the private "banners" bucket; the API hands out signed links.
"""
import logging
from datetime import date
from io import BytesIO

from src.core import cache
from src.core.audit import write_audit
from src.core.dates import today_ist
from src.core.errors import AppError, ForbiddenError, NotFoundError
from src.core.images import sniff
from src.core.soft_delete import live as live_rows_only
from src.core.storage import delete_image, signed_urls, upload_image
from src.core.supabase import get_service_client
from src.modules.auth.schemas import Profile, Role
from src.modules.people.service import company_scope

log = logging.getLogger(__name__)
BUCKET = "banners"
NOT_READY = "Banners are not set up yet. An admin needs to apply the database migration 20260120000000_people_and_banners.sql, then try again."
BASE_COLUMNS = "id,audience,title,image_path,sort_order,is_active,starts_on,ends_on,created_at,updated_at"
COLUMNS = BASE_COLUMNS + ",company_ids"
CLIENTS_NOT_READY = "Banners for chosen clients are not set up yet. An admin needs to apply the database migration 20261128100000_banner_clients.sql, then try again."
ROLES = (Role.ADMIN, Role.KAM)  # who sees and manages banners
MAX_LIVE = 50  # the most one dashboard shows
MAX_ROWS = 500
MAX_CLIENTS = 300
MAX_BYTES = 5 * 1024 * 1024
WIDTH, HEIGHT = 2156, 198  # the CRM crops every upload to this size
LIVE_TTL = 60


def require_role(user: Profile) -> None:
    if user.role not in ROLES:
        raise ForbiddenError("Only an admin or a Key Account Manager manages banners.")


def own_clients(user: Profile) -> set[str] | None:
    """The client accounts a banner may be managed for: None means any (admin), a KAM the accounts they own."""
    require_role(user)
    return None if user.role == Role.ADMIN else set(company_scope(user) or [])


# --- pure rules (tested without a database) ---------------------------------------------------------------------------

def is_live(row: dict, today: date) -> bool:
    """Switched on, and today is inside the optional show-from / show-until window."""
    if not row.get("is_active"):
        return False
    start, end = row.get("starts_on"), row.get("ends_on")
    if start and date.fromisoformat(str(start)) > today:
        return False
    if end and date.fromisoformat(str(end)) < today:
        return False
    return True


def audience_allows(audience: str, role: Role) -> bool:
    return audience == "ALL" or (audience == "KAM" and role == Role.KAM) or (audience == "ADMIN" and role == Role.ADMIN)


def can_manage(row: dict, own: set[str] | None) -> bool:
    """An admin manages every banner; a KAM one that is shown only to their own clients."""
    ids = row.get("company_ids") or []
    return own is None or (bool(ids) and set(map(str, ids)) <= own)


def shown_to(row: dict, clients: set[str] | None) -> bool:
    """Whether a banner is for these clients. A banner with none chosen is for every client; None = no narrowing."""
    ids = row.get("company_ids") or []
    return clients is None or not ids or bool(set(map(str, ids)) & clients)


def check_picture(data: bytes) -> tuple[str, str]:
    """A banner picture: PNG, JPEG or WebP (by its own bytes), up to 5 MB, exactly 2156 x 198.
    Returns (mime, extension) or a message the person can act on."""
    if not data:
        raise AppError("Choose a banner picture.", status_code=422)
    if len(data) > MAX_BYTES:
        raise AppError("The picture must be 5 MB or smaller.", status_code=413)
    kind = sniff(data)
    if not kind:
        raise AppError("Use a PNG, JPEG or WebP picture.", status_code=422)
    try:
        from PIL import Image

        width, height = Image.open(BytesIO(data)).size
    except Exception as exc:  # noqa: BLE001
        raise AppError("That picture could not be read. Try another file.", status_code=422) from exc
    if (width, height) != (WIDTH, HEIGHT):
        raise AppError(f"The picture is {width} x {height}. A banner must be {WIDTH} x {HEIGHT}: crop it before uploading.", status_code=422)
    return kind


# --- reading ----------------------------------------------------------------------------------------------------------

def _with_urls(rows: list[dict]) -> list[dict]:
    urls = signed_urls(BUCKET, [r.get("image_path") for r in rows])
    return [{**{k: v for k, v in r.items() if k != "image_path"}, "image_url": urls.get(r.get("image_path") or "")} for r in rows]


def _missing(exc: Exception) -> bool:
    text = str(exc)
    return "dashboard_banners" in text and ("does not exist" in text or "42P01" in text or "PGRST205" in text)


def _no_clients_column(exc: Exception) -> bool:
    text = str(exc)
    return "company_ids" in text and ("42703" in text or "does not exist" in text or "PGRST204" in text)


def _select(narrow) -> list[dict]:
    """Rows of the banners table. Before the clients migration every banner is for every client."""
    table = get_service_client().table("dashboard_banners")
    try:
        return narrow(table.select(COLUMNS)).execute().data
    except Exception as exc:  # noqa: BLE001
        if not _no_clients_column(exc):
            raise
    rows = narrow(get_service_client().table("dashboard_banners").select(BASE_COLUMNS)).execute().data
    return [{**r, "company_ids": []} for r in rows]


def _live_rows() -> list[dict]:
    """Every banner switched on and inside its show-from / show-until window today (none before the migration)."""
    try:
        rows = _select(lambda q: q.eq("is_active", True).order("sort_order").order("created_at").limit(MAX_ROWS))
    except Exception as exc:  # noqa: BLE001
        if _missing(exc):
            return []
        raise
    today = today_ist()
    return [r for r in rows if is_live(r, today)]


def live(user: Profile, company_id: str | None = None) -> list[dict]:
    """The banners this person sees now, for one client or (without one) all their clients. Nothing (not an error) for
    other roles or before the migration."""
    if user.role not in ROLES:
        return []

    def load() -> list[dict]:
        own = own_clients(user)
        if company_id:
            clients = {company_id} if own is None or company_id in own else set()
        else:
            clients = own
        rows = [r for r in _live_rows() if audience_allows(r["audience"], user.role) and shown_to(r, clients)]
        return _with_urls(rows[:MAX_LIVE])

    return cache.memo("banners-live", user.id, company_id, LIVE_TTL, load)


SHARED_FIELDS = ("id", "title", "sort_order", "image_url")


def _company_of(tenant_id: str) -> str | None:
    """The CRM client account behind a Gifting OS client, if one is linked."""
    q = get_service_client().table("companies").select("id").eq("gifting_tenant_id", tenant_id)
    rows = live_rows_only(q, "companies").limit(1).execute().data
    return str(rows[0]["id"]) if rows else None


def shared_live(tenant_id: str | None = None) -> list[dict]:
    """The live banners for one Gifting OS client's dashboard: those for every client plus those chosen for it (without a
    client, only those for every client). Only what a dashboard needs to show them: no schedule, author, chosen clients or
    storage path. Picture links are signed and expire after an hour."""

    def load() -> list[dict]:
        company = _company_of(tenant_id) if tenant_id else None
        rows = [r for r in _live_rows() if shown_to(r, {company} if company else set())]
        return [{k: r.get(k) for k in SHARED_FIELDS} for r in _with_urls(rows[:MAX_LIVE]) if r.get("image_url")]

    return cache.memo("banners-shared", "gifting-os", tenant_id, LIVE_TTL, load)


def _client_names(ids: set[str]) -> dict[str, str]:
    if not ids:
        return {}
    q = get_service_client().table("companies").select("id,name").in_("id", sorted(ids))
    return {str(c["id"]): c["name"] for c in live_rows_only(q, "companies").limit(1000).execute().data}


def _with_clients(rows: list[dict]) -> list[dict]:
    names = _client_names({str(i) for r in rows for i in r.get("company_ids") or []})
    return [{**r, "clients": [{"id": str(i), "name": names.get(str(i), "Removed client")} for i in r.get("company_ids") or []]} for r in rows]


def manage_list(user: Profile) -> list[dict]:
    own = own_clients(user)
    try:
        rows = _select(lambda q: q.order("sort_order").order("created_at").limit(MAX_ROWS))
    except Exception as exc:  # noqa: BLE001
        if _missing(exc):
            raise AppError(NOT_READY, status_code=503) from exc
        raise
    today = today_ist()
    rows = [r for r in rows if can_manage(r, own)]
    return [{**r, "live": is_live(r, today)} for r in _with_clients(_with_urls(rows))]


def _row(user: Profile, banner_id: str) -> dict:
    """A banner this person manages; anyone else's reads as not found."""
    own = own_clients(user)
    rows = _select(lambda q: q.eq("id", banner_id).limit(1))
    if not rows or not can_manage(rows[0], own):
        raise NotFoundError("Banner not found.")
    return rows[0]


def targets(user: Profile, company_ids: list[str]) -> list[str]:
    """The clients a banner may be saved for. Empty (every client) is for admins only."""
    own = own_clients(user)
    wanted = list(dict.fromkeys(str(i) for i in company_ids))
    if len(wanted) > MAX_CLIENTS:
        raise AppError(f"Choose at most {MAX_CLIENTS} clients, or all clients.", status_code=422)
    if not wanted:
        if own is not None:
            raise AppError("Choose at least one of your clients.", status_code=422)
        return []
    if own is not None and not set(wanted) <= own:
        raise ForbiddenError("You can only add banners for your own clients.")
    if set(_client_names(set(wanted))) != set(wanted):
        raise AppError("One of the chosen clients no longer exists.", status_code=422)
    return wanted


# --- writing ----------------------------------------------------------------------------------------------------------

def _store(data: bytes) -> str:
    mime, ext = check_picture(data)
    return upload_image(BUCKET, "banners", data, mime, ext, not_ready=NOT_READY)


def create(user: Profile, fields: dict, data: bytes) -> dict:
    """Upload first, then save the row. If saving fails, the uploaded picture is removed (never an orphan file)."""
    fields = dict(fields)
    clients = targets(user, fields.pop("company_ids", None) or [])
    if clients:  # left out when empty, so banners for everyone still save before the clients migration
        fields["company_ids"] = clients
    path = _store(data)
    try:
        row = get_service_client().table("dashboard_banners").insert({**fields, "image_path": path, "created_by": user.id}).execute().data[0]
    except Exception as exc:
        delete_image(BUCKET, path)
        if _no_clients_column(exc):
            raise AppError(CLIENTS_NOT_READY, status_code=503) from exc
        if _missing(exc):
            raise AppError(NOT_READY, status_code=503) from exc
        raise
    write_audit(user.id, "create", "dashboard_banners", row["id"], {"audience": row["audience"]})
    return _with_urls([row])[0]


def update(user: Profile, banner_id: str, fields: dict) -> dict:
    old = _row(user, banner_id)
    if not fields:
        raise AppError("Change at least one setting.", status_code=422)
    fields = dict(fields)
    if "company_ids" in fields:
        fields["company_ids"] = targets(user, fields["company_ids"] or [])
        if not fields["company_ids"] and not old.get("company_ids") and len(fields) > 1:
            del fields["company_ids"]  # unchanged "every client": also saves before the clients migration
    try:
        row = get_service_client().table("dashboard_banners").update(fields).eq("id", banner_id).execute().data[0]
    except Exception as exc:
        if _no_clients_column(exc):
            raise AppError(CLIENTS_NOT_READY, status_code=503) from exc
        raise
    write_audit(user.id, "update", "dashboard_banners", banner_id, {k: str(v) for k, v in fields.items()})
    return _with_urls([row])[0]


def set_image(user: Profile, banner_id: str, data: bytes) -> dict:
    """A new picture for a banner: store it, point the row at it, then remove the old one."""
    old = _row(user, banner_id)
    path = _store(data)
    try:
        row = get_service_client().table("dashboard_banners").update({"image_path": path}).eq("id", banner_id).execute().data[0]
    except Exception:
        delete_image(BUCKET, path)
        raise
    delete_image(BUCKET, old.get("image_path"))
    write_audit(user.id, "update", "dashboard_banners", banner_id, {"image": True})
    return _with_urls([row])[0]


def delete(user: Profile, banner_id: str) -> None:
    old = _row(user, banner_id)
    get_service_client().table("dashboard_banners").delete().eq("id", banner_id).execute()
    delete_image(BUCKET, old.get("image_path"))
    write_audit(user.id, "delete", "dashboard_banners", banner_id, {})
