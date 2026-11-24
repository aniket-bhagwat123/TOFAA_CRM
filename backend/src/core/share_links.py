"""Short links for files shared with clients: https://<crm>/s/Ab3xK9q

The link holds only a random code. Opening it, the CRM looks the code up, checks it has not expired, and serves the
file itself, so the client never sees the storage provider, the bucket or the folder layout. Until migration
20260116000000_share_links.sql is applied, sharing falls back to a signed storage link (the old behaviour)."""
import logging
import secrets
from datetime import timedelta

from src.core.config import settings
from src.core.dates import now_ist
from src.core.errors import AppError, NotFoundError
from src.core.storage import DOCUMENTS, signed_document_url
from src.core.supabase import get_service_client

log = logging.getLogger(__name__)
ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/l/I: easy to read aloud and type
CODE_LENGTH = 8


def new_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))


def short_url(code: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/s/{code}"


def create(path: str, file_name: str, *, days: int, mime: str | None = None, kind: str = "file",
           lead_id: str | None = None, user_id: str | None = None) -> str:
    """A short link to a stored file that works for `days` days, without signing in."""
    expires = (now_ist() + timedelta(days=days)).isoformat()
    db = get_service_client()
    for _ in range(5):  # a clash on 8 random characters is very unlikely; try again if it happens
        code = new_code()
        try:
            db.table("share_links").insert({
                "code": code, "path": path, "file_name": file_name[:200], "mime": mime, "kind": kind,
                "lead_id": lead_id, "created_by": user_id, "expires_at": expires,
            }).execute()
            return short_url(code)
        except Exception as exc:  # noqa: BLE001
            text = str(exc)
            if "duplicate" in text.lower() or "23505" in text:
                continue
            log.warning("short link not available (is migration 20260116000000_share_links.sql applied?); using a storage link", exc_info=True)
            break
    return signed_document_url(path, days * 86400, download_name=file_name) or ""


def resolve(code: str) -> tuple[bytes, str, str]:
    """(file bytes, file name, content type) for a code, or a clear error when it is unknown or expired."""
    if not code.isalnum() or len(code) > 32:
        raise NotFoundError("This link is not valid.")
    db = get_service_client()
    rows = db.table("share_links").select("*").eq("code", code).limit(1).execute().data
    if not rows:
        raise NotFoundError("This link is not valid.")
    link = rows[0]
    if link["expires_at"] < now_ist().isoformat():
        raise AppError("This link has expired. Ask us for a new one.", status_code=410)
    try:
        data = db.storage.from_(DOCUMENTS).download(link["path"])
    except Exception as exc:  # noqa: BLE001
        log.warning("shared file %s could not be read", link["path"], exc_info=True)
        raise NotFoundError("This file is no longer available.") from exc
    try:
        db.table("share_links").update({"opened_count": (link.get("opened_count") or 0) + 1, "last_opened_at": now_ist().isoformat()}).eq("code", code).execute()
    except Exception:  # noqa: BLE001 - counting opens is a nicety
        pass
    return data, link["file_name"], link.get("mime") or "application/octet-stream"
