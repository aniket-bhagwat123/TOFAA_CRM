"""Minutes of meeting. Saving them is the action that moves a lead to Requirement Received."""
from datetime import date

from src.core.audit import write_audit
from src.core.dates import now_ist
from src.core.documents import checked_document
from src.core.errors import AppError
from src.core.parallel import par
from src.core.storage import DOCUMENTS, signed_urls, upload_document
from src.core.supabase import get_service_client
from src.core.timeline import add_activity
from src.modules.auth.schemas import Profile
from src.modules.leads import service as leads
from src.modules.leads.stages import CLOSED
from src.modules.tasks import service as tasks


def _positive(value) -> bool:
    try:
        return float(value) > 0
    except (TypeError, ValueError):
        return False


def _given(value) -> bool:
    return value is not None and str(value).strip() != ""


def validate(note: str | None, quantity, budget) -> list[dict]:
    """Field-level problems, in the shape the forms already know how to show.

    Only the summary is required. Quantity and budget are optional, but must be above 0 when given.
    """
    errors = []
    if not (note or "").strip():
        errors.append({"field": "note", "message": "Summary is required."})
    if _given(quantity) and not _positive(quantity):
        errors.append({"field": "quantity", "message": "Enter a quantity greater than 0."})
    if _given(budget) and not _positive(budget):
        errors.append({"field": "budget", "message": "Enter a budget greater than 0."})
    return errors


def add_minutes(
    user: Profile, lead_id: str, *, note: str | None, occasion: str | None, quantity, budget, delivery_date: str | None,
    next_follow_up: date | None, meeting_id: str | None, file: tuple[bytes, str | None] | None,
) -> dict:
    lead = leads.get_lead_row(user, lead_id)
    if lead["stage"] in CLOSED:
        raise AppError("This lead is closed.")
    errors = validate(note, quantity, budget)
    if errors:
        raise AppError("Some required details are missing.", {"errors": errors}, 422)

    path = name = None
    if file:
        data, filename = file
        mime, ext = checked_document(data, filename)
        path, name = upload_document(lead_id, data, mime, ext), (filename or f"minutes.{ext}")[:200]

    db = get_service_client()
    # Only overwrite what was actually filled in; keep anything already known about the lead.
    requirement = dict(lead.get("requirement") or {})
    if _given(occasion):
        requirement["occasion"] = occasion.strip()
    if _given(quantity):
        requirement["quantity"] = float(quantity)
    if _given(budget):
        requirement["budget"] = float(budget)
    if _given(delivery_date):
        requirement["deliveryDate"] = delivery_date
    lead_update = {"requirement": requirement, "updated_at": now_ist().isoformat()}
    if _given(budget):
        lead_update["estimate_amount"] = float(budget)

    summary = note.strip()
    mom = (
        db.table("moms").insert(
            {"lead_id": lead_id, "meeting_id": meeting_id, "body": summary, "file_path": path, "file_name": name, "created_by": user.id}
        ).execute().data[0]
    )
    jobs = [
        lambda: db.table("leads").update(lead_update).eq("id", lead_id).execute(),
        lambda: add_activity(lead_id, user.id, "mom", note=summary[:400], meta={"momId": mom["id"], "file": name}),
        lambda: leads.auto_advance(lead, "requirement_received", user.id, "Minutes saved"),
    ]
    if next_follow_up:
        jobs.append(lambda: tasks.set_next_action(lead_id, lead["owner_id"], next_follow_up))
    par(*jobs)
    write_audit(user.id, "create", "moms", mom["id"], {"lead": lead_id})
    return {**mom, "stage": lead["stage"]}


def list_minutes(lead_id: str) -> list[dict]:
    rows = get_service_client().table("moms").select("*, author:profiles!created_by(full_name)").eq("lead_id", lead_id).order("created_at", desc=True).limit(50).execute().data
    urls = signed_urls(DOCUMENTS, [r.get("file_path") for r in rows])
    for r in rows:
        r["file_url"] = urls.get(r.get("file_path") or "")
        r.pop("file_path", None)
    return rows
