"""Private image storage (Supabase Storage). Files are never public: the API returns signed URLs."""
import logging
from uuid import uuid4

from src.core import cache
from src.core.errors import AppError
from src.core.parallel import bg
from src.core.supabase import get_service_client

log = logging.getLogger(__name__)

AVATARS = "avatars"
CLIENT_IMAGES = "client-images"
DOCUMENTS = "documents"  # minutes of meeting, signed agreements, quotation PDFs
DOCS_NOT_READY = "Document storage is not set up yet. An admin needs to apply the latest database migration (20260104000000_phase2.sql), then try again."
NOT_READY = "Photo storage is not set up yet. An admin needs to apply the latest database migration (20260103000000_images.sql), then try again."
URL_SECONDS = 3600
CACHE_SECONDS = 3000  # reuse a signed URL for 50 minutes, so it is always still valid when served


def upload_image(bucket: str, owner_id: str, data: bytes, mime: str, ext: str, *, not_ready: str | None = None) -> str:
    """Store the image under a fresh name (so browsers never show an old cached copy) and return its path."""
    path = f"{owner_id}/{uuid4().hex}.{ext}"
    try:
        get_service_client().storage.from_(bucket).upload(path, data, {"content-type": mime, "cache-control": "31536000"})
    except Exception as exc:  # noqa: BLE001
        if "bucket not found" in str(exc).lower():
            log.error("storage bucket %r is missing: the images migration has not been applied", bucket)
            raise AppError(not_ready or NOT_READY, status_code=503) from exc
        log.exception("image upload failed")
        raise AppError("Could not save the image. Try again.", status_code=502) from exc
    return path


def delete_image(bucket: str, path: str | None) -> None:
    if path:
        bg(lambda: get_service_client().storage.from_(bucket).remove([path]))


def signed_urls(bucket: str, paths: list[str | None]) -> dict[str, str]:
    """path -> signed URL for every path we could sign. Cached; only unseen paths cost a request."""
    wanted = list({p for p in paths if p})
    out: dict[str, str] = {}
    missing = []
    for p in wanted:
        hit = cache.peek("img", f"{bucket}:{p}")
        if hit:
            out[p] = hit
        else:
            missing.append(p)
    for i in range(0, len(missing), 100):
        chunk = missing[i : i + 100]
        try:
            items = get_service_client().storage.from_(bucket).create_signed_urls(chunk, URL_SECONDS)
        except Exception:  # noqa: BLE001 - a missing picture must never break a list
            log.warning("could not sign %d images", len(chunk), exc_info=True)
            continue
        for item in items:
            url = item.get("signedURL") or item.get("signedUrl")
            if url and item.get("path"):
                out[item["path"]] = url
                cache.store("img", f"{bucket}:{item['path']}", CACHE_SECONDS, url)
    return out


def signed_url(bucket: str, path: str | None) -> str | None:
    return signed_urls(bucket, [path]).get(path) if path else None


def photo_column_missing(exc: Exception) -> bool:
    """True when the database does not have the photo columns yet (Postgres error 42703: undefined column)."""
    text = str(exc)
    return "42703" in text or "does not exist" in text


def guard_photo_write(bucket: str, path: str, write) -> None:
    """Run the database update that points a row at its new photo. If the column is missing, remove the
    file we just uploaded and explain what to do, instead of leaving an orphan and a vague error."""
    try:
        write()
    except Exception as exc:  # noqa: BLE001
        delete_image(bucket, path)
        if photo_column_missing(exc):
            log.error("photo column missing: the images migration has not been applied")
            raise AppError(NOT_READY, status_code=503) from exc
        raise


# --- documents (minutes, signed agreements, quotation PDFs) ----------------------------------------------

def upload_document(owner_id: str, data: bytes, mime: str, ext: str) -> str:
    """Same as upload_image, into the private documents bucket, with its own 'not set up' message."""
    return upload_image(DOCUMENTS, owner_id, data, mime, ext, not_ready=DOCS_NOT_READY)


def signed_document_url(path: str | None, seconds: int = URL_SECONDS, *, download_name: str | None = None) -> str | None:
    """A link that works without signing in, for `seconds`. Used to hand a quotation PDF to a client."""
    if not path:
        return None
    try:
        opts = {"download": download_name} if download_name else None
        res = get_service_client().storage.from_(DOCUMENTS).create_signed_url(path, seconds, opts) if opts else \
            get_service_client().storage.from_(DOCUMENTS).create_signed_url(path, seconds)
        return res.get("signedURL") or res.get("signedUrl")
    except Exception:  # noqa: BLE001 - a missing file must not break the page that lists it
        log.warning("could not sign document %s", path, exc_info=True)
        return None
