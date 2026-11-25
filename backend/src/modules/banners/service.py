"""Dashboard banners: pictures shaped 1000 x 90 shown as a rotating strip at the top of the Dashboard.

KAM and admin only: both manage banners, and the strip shows on their Dashboards. A banner can be scheduled
(show from / until), switched off, ordered, and aimed at everyone (KAM + admin), only KAM, or only admin.
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
from src.core.storage import delete_image, signed_urls, upload_image
from src.core.supabase import get_service_client
from src.modules.auth.schemas import Profile, Role

log = logging.getLogger(__name__)
BUCKET = "banners"
NOT_READY = "Banners are not set up yet. An admin needs to apply the database migration 20260120000000_people_and_banners.sql, then try again."
COLUMNS = "id,audience,title,image_path,sort_order,is_active,starts_on,ends_on,created_at,updated_at"
ROLES = (Role.ADMIN, Role.KAM)
MAX_LIVE = 50
MAX_BYTES = 5 * 1024 * 1024
RATIO = (1000, 90)      # the banner shape
RATIO_TOLERANCE = 0.02  # within 2%
MIN_WIDTH = 500
LIVE_TTL = 60


def require_role(user: Profile) -> None:
    if user.role not in ROLES:
        raise ForbiddenError("Banners are for KAM and admin.")


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


def check_picture(data: bytes) -> tuple[str, str]:
    """A banner picture: PNG, JPEG or WebP (by its own bytes), up to 5 MB, the 1000 x 90 shape within 2%, 500 px wide or
    more. Returns (mime, extension) or raises a message the person can act on."""
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
    want = RATIO[0] / RATIO[1]
    if not height or abs(width / height - want) / want > RATIO_TOLERANCE:
        raise AppError(
            f"The picture is {width} x {height}. A banner must have the 1000 x 90 shape (for example 1000 x 90 or 2000 x 180).",
            status_code=422,
        )
    if width < MIN_WIDTH:
        raise AppError(f"The picture is {width} px wide. Use one at least {MIN_WIDTH} px wide so it stays sharp.", status_code=422)
    return kind


# --- reading ----------------------------------------------------------------------------------------------------------

def _with_urls(rows: list[dict]) -> list[dict]:
    urls = signed_urls(BUCKET, [r.get("image_path") for r in rows])
    return [{**{k: v for k, v in r.items() if k != "image_path"}, "image_url": urls.get(r.get("image_path") or "")} for r in rows]


def _missing(exc: Exception) -> bool:
    text = str(exc)
    return "dashboard_banners" in text and ("does not exist" in text or "42P01" in text or "PGRST205" in text)


def _live_rows() -> list[dict]:
    """Every banner switched on and inside its show-from / show-until window today (none before the migration)."""
    try:
        rows = (
            get_service_client().table("dashboard_banners").select(COLUMNS).eq("is_active", True)
            .order("sort_order").order("created_at").limit(MAX_LIVE).execute().data
        )
    except Exception as exc:  # noqa: BLE001
        if _missing(exc):
            return []
        raise
    today = today_ist()
    return [r for r in rows if is_live(r, today)]


def live(user: Profile) -> list[dict]:
    """The banners this person sees now. Nothing (not an error) for other roles or before the migration."""
    if user.role not in ROLES:
        return []

    def load() -> list[dict]:
        return _with_urls([r for r in _live_rows() if audience_allows(r["audience"], user.role)])

    return cache.memo("banners-live", user.role.value, None, LIVE_TTL, load)


SHARED_FIELDS = ("id", "title", "sort_order", "image_url")


def shared_live() -> list[dict]:
    """The live banners aimed at everyone (audience ALL), for TOFAA Gifting OS. Only what a dashboard needs to show
    them: no audience, schedule, author or storage path. Picture links are signed and expire after an hour."""

    def load() -> list[dict]:
        rows = _with_urls([r for r in _live_rows() if r["audience"] == "ALL"])
        return [{k: r.get(k) for k in SHARED_FIELDS} for r in rows if r.get("image_url")]

    return cache.memo("banners-shared", "gifting-os", None, LIVE_TTL, load)


def manage_list(user: Profile) -> list[dict]:
    require_role(user)
    try:
        rows = get_service_client().table("dashboard_banners").select(COLUMNS).order("sort_order").order("created_at").limit(500).execute().data
    except Exception as exc:  # noqa: BLE001
        if _missing(exc):
            raise AppError(NOT_READY, status_code=503) from exc
        raise
    today = today_ist()
    return [{**r, "live": is_live(r, today)} for r in _with_urls(rows)]


def _row(banner_id: str) -> dict:
    rows = get_service_client().table("dashboard_banners").select(COLUMNS).eq("id", banner_id).limit(1).execute().data
    if not rows:
        raise NotFoundError("Banner not found.")
    return rows[0]


# --- writing ----------------------------------------------------------------------------------------------------------

def _store(data: bytes) -> str:
    mime, ext = check_picture(data)
    return upload_image(BUCKET, "banners", data, mime, ext, not_ready=NOT_READY)


def create(user: Profile, fields: dict, data: bytes) -> dict:
    """Upload first, then save the row. If saving fails, the uploaded picture is removed (never an orphan file)."""
    require_role(user)
    path = _store(data)
    try:
        row = get_service_client().table("dashboard_banners").insert({**fields, "image_path": path, "created_by": user.id}).execute().data[0]
    except Exception as exc:
        delete_image(BUCKET, path)
        if _missing(exc):
            raise AppError(NOT_READY, status_code=503) from exc
        raise
    write_audit(user.id, "create", "dashboard_banners", row["id"], {"audience": row["audience"]})
    return _with_urls([row])[0]


def update(user: Profile, banner_id: str, fields: dict) -> dict:
    require_role(user)
    _row(banner_id)
    if not fields:
        raise AppError("Change at least one setting.", status_code=422)
    row = get_service_client().table("dashboard_banners").update(fields).eq("id", banner_id).execute().data[0]
    write_audit(user.id, "update", "dashboard_banners", banner_id, {k: str(v) for k, v in fields.items()})
    return _with_urls([row])[0]


def set_image(user: Profile, banner_id: str, data: bytes) -> dict:
    """A new picture for a banner: store it, point the row at it, then remove the old one."""
    require_role(user)
    old = _row(banner_id)
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
    require_role(user)
    old = _row(banner_id)
    get_service_client().table("dashboard_banners").delete().eq("id", banner_id).execute()
    delete_image(BUCKET, old.get("image_path"))
    write_audit(user.id, "delete", "dashboard_banners", banner_id, {})
