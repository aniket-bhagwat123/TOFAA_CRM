"""Sampling: sample images and files for each item of the quotation, sent to the client as secure links.
Sending the samples is the action that moves the lead to the Sampling stage."""
import logging
from html import escape

from src.core.audit import write_audit
from src.core.config import settings
from src.core.dates import now_ist, today_ist
from src.core.documents import checked_document
from src.core.email import send_email
from src.core.errors import AppError
from src.core.parallel import par
from src.core import share_links
from src.core.storage import DOCUMENTS, signed_urls, upload_document
from src.core.supabase import get_service_client
from src.core.timeline import add_activity
from src.modules.auth.schemas import Profile
from src.modules.leads import service as leads
from src.modules.leads.stages import CLOSED
from src.modules.samples import schemas
from src.modules.tasks import service as tasks
from src.modules.whatsapp import service as whatsapp
from src.modules.whatsapp.schemas import SendMessage

log = logging.getLogger(__name__)
LINK_DAYS = 14  # how long the links in the message keep working
NOT_READY = "Sampling is not set up yet. An admin needs to apply the database migration 20260111000000_sampling.sql, then try again."


def _missing_table(exc: Exception) -> bool:
    text = str(exc)
    return ("lead_samples" in text or "sample_sends" in text) and ("does not exist" in text or "42P01" in text or "PGRST205" in text)


def _open_lead(user: Profile, lead_id: str) -> dict:
    lead = leads.get_lead_row(user, lead_id)
    if lead["stage"] in CLOSED:
        raise AppError("This lead is closed.")
    return lead


# --- read --------------------------------------------------------------------------------------------------------------

def state(lead_id: str) -> dict:
    """The sample items with preview links, and when they last went to the client. Empty (never an error) before the migration."""
    db = get_service_client()
    try:
        rows, sends = par(
            lambda: db.table("lead_samples").select("*").eq("lead_id", lead_id).order("position").execute().data,
            lambda: db.table("sample_sends").select("*").eq("lead_id", lead_id).order("sent_at", desc=True).limit(1).execute().data,
        )
    except Exception:  # noqa: BLE001 - the lead page must load even before the migration
        log.warning("could not read samples", exc_info=True)
        return {"items": [], "lastSent": None, "ready": False}
    urls = signed_urls(DOCUMENTS, [f.get("path") for r in rows for f in (r.get("files") or [])])
    items = [
        {
            "id": r["id"], "packageName": r.get("package_name"), "itemName": r["item_name"], "description": r.get("description"),
            "files": [{**f, "url": urls.get(f.get("path") or "")} for f in (r.get("files") or [])],
        }
        for r in rows
    ]
    last = sends[0] if sends else None
    return {
        "items": items,
        "lastSent": {"sentAt": last["sent_at"], "channel": last["channel"], "itemCount": last["item_count"], "fileCount": last["file_count"]} if last else None,
        "ready": True,
    }


# --- upload / save -----------------------------------------------------------------------------------------------------

def upload_file(user: Profile, lead_id: str, data: bytes, filename: str | None) -> dict:
    """One sample image or file (PDF, Word, JPEG, PNG, WebP; 10 MB at most). The path goes into an item's files on save."""
    _open_lead(user, lead_id)
    mime, ext = checked_document(data, filename)
    path = upload_document(lead_id, data, mime, ext)
    name = (filename or f"sample.{ext}").strip()[:200] or f"sample.{ext}"
    return {"path": path, "name": name, "mime": mime, "url": signed_urls(DOCUMENTS, [path]).get(path)}


def check_paths(lead_id: str, items: list[schemas.SampleItemIn]) -> None:
    """Files must be ones uploaded for this lead (their path starts with the lead id)."""
    for it in items:
        for f in it.files:
            if not f.path.startswith(f"{lead_id}/") or ".." in f.path:
                raise AppError("One of the sample files does not belong to this lead. Upload it again.", status_code=422)


def save(user: Profile, lead_id: str, body: schemas.SamplesSave) -> dict:
    """Replace the lead's sample items with these (the sheet always sends the whole list)."""
    _open_lead(user, lead_id)
    check_paths(lead_id, body.items)
    db = get_service_client()
    now = now_ist().isoformat()
    rows = [
        {
            "lead_id": lead_id, "position": n, "package_name": it.package_name or None, "item_name": it.item_name,
            "description": it.description or None, "files": [f.model_dump() for f in it.files], "created_by": user.id, "updated_at": now,
        }
        for n, it in enumerate(body.items, 1)
    ]
    try:
        db.table("lead_samples").delete().eq("lead_id", lead_id).execute()
        if rows:
            db.table("lead_samples").insert(rows).execute()
    except Exception as exc:
        if _missing_table(exc):
            raise AppError(NOT_READY, status_code=503) from exc
        raise
    write_audit(user.id, "save", "lead_samples", lead_id, {"items": len(rows)})
    return state(lead_id)


# --- send --------------------------------------------------------------------------------------------------------------

def _links(items: list[dict], lead_id: str | None = None, user_id: str | None = None) -> list[tuple[str, list[tuple[str, str]]]]:
    """(item title, [(file name, link)]) for every item that has files. Short links on the CRM's own address
    (https://<crm>/s/<code>), working without signing in for LINK_DAYS."""
    out = []
    for it in items:
        files = []
        for f in it.get("files") or []:
            if not f.get("path"):
                continue
            url = share_links.create(f["path"], f.get("name") or "file", days=LINK_DAYS, mime=f.get("mime"), kind="sample", lead_id=lead_id, user_id=user_id)
            if url:
                files.append((f.get("name") or "file", url))
        if files:
            title = " · ".join(x for x in (it.get("package_name"), it["item_name"]) if x)
            out.append((title, files))
    return out


def message_text(contact_name: str, company: str, links, note: str | None) -> str:
    lines = [f"Hello {contact_name}, here are the samples for {company}."]
    if note:
        lines.append(note.strip())
    for title, files in links:
        lines.append("")
        lines.append(f"*{title}*")
        lines.extend(f"{name}: {url}" for name, url in files)
    lines.append("")
    lines.append(f"The links work for {LINK_DAYS} days.")
    return "\n".join(lines)


def message_html(contact_name: str, company: str, links, note: str | None) -> str:
    parts = [f"<p>Dear {escape(contact_name)},</p><p>Please find the samples for {escape(company)} below.</p>"]
    if note:
        parts.append(f"<p>{escape(note.strip())}</p>")
    for title, files in links:
        items = "".join(f'<li><a href="{escape(url)}">{escape(name)}</a></li>' for name, url in files)
        parts.append(f"<p><b>{escape(title)}</b></p><ul>{items}</ul>")
    parts.append(f"<p>The links work for {LINK_DAYS} days. Reply to this email with any questions.</p>")
    return "".join(parts)


def send(user: Profile, lead_id: str, body: schemas.SamplesSend) -> dict:
    lead = _open_lead(user, lead_id)
    if body.next_follow_up < today_ist():
        raise AppError("Pick a follow-up date from today onwards.", {"errors": [{"field": "nextFollowUp", "message": "Pick a date from today onwards."}]}, 422)
    contact = lead["contact"]
    if body.channel == "whatsapp" and not contact.get("phone"):
        raise AppError("This contact has no phone number.", {"errors": [{"field": "channel", "message": "No phone number on this lead."}]}, 422)
    if body.channel == "email" and not contact.get("email"):
        raise AppError("This contact has no email address.", {"errors": [{"field": "channel", "message": "No email on this lead."}]}, 422)

    db = get_service_client()
    try:
        rows = db.table("lead_samples").select("*").eq("lead_id", lead_id).order("position").execute().data
    except Exception as exc:
        if _missing_table(exc):
            raise AppError(NOT_READY, status_code=503) from exc
        raise
    links = _links(rows, lead_id, user.id)
    if not links:
        raise AppError("Upload at least one sample file, then send.", {"errors": [{"field": "samples", "message": "Upload at least one sample file."}]}, 422)
    file_count = sum(len(f) for _, f in links)
    company = lead["company"]["name"]

    result: dict = {"channel": body.channel, "mode": body.channel}
    if body.channel == "email":
        send_email(contact["email"], f"Samples for {company} from {settings.COMPANY_NAME}", message_html(contact["name"], company, links, body.message))
    else:
        text = message_text(contact["name"], company, links, body.message)
        try:
            result.update(whatsapp.send(user, lead_id, SendMessage(body=text)))
        except AppError as exc:
            if (exc.data or {}).get("code") != "template_required":
                raise
            # The 24-hour window is closed and a free message is not allowed: hand over a click-to-chat link instead.
            result.update(whatsapp.send(user, lead_id, SendMessage(body=text), force_click=True))

    par(
        lambda: db.table("sample_sends").insert(
            {"lead_id": lead_id, "channel": body.channel, "item_count": len(links), "file_count": file_count, "sent_by": user.id}
        ).execute(),
        lambda: add_activity(
            lead_id, user.id, "sample", outcome="sent",
            note=f"Samples sent by {body.channel}: {len(links)} {'item' if len(links) == 1 else 'items'}, {file_count} {'file' if file_count == 1 else 'files'}",
            meta={"channel": body.channel, "items": len(links), "files": file_count},
        ),
        lambda: tasks.set_next_action(lead_id, lead["owner_id"], body.next_follow_up),
    )
    leads.auto_advance(lead, "sampling", user.id, "Samples sent")
    write_audit(user.id, "send", "lead_samples", lead_id, {"channel": body.channel, "items": len(links), "files": file_count})
    return {**result, "state": state(lead_id)}
