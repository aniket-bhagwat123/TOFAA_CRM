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


def validate(note: str | None, has_file: bool, occasion, quantity, budget, delivery_date, next_follow_up) -> list[dict]:
    """Field-level problems, in the shape the forms already know how to show."""
    errors = []
    if not (note or "").strip() and not has_file:
        errors.append({"field": "note", "message": "Type the minutes or attach a file."})
    if not (occasion or "").strip():
        errors.append({"field": "occasion", "message": "Occasion is required."})
    if not _positive(quantity):
        errors.append({"field": "quantity", "message": "Enter a quantity greater than 0."})
    if not _positive(budget):
        errors.append({"field": "budget", "message": "Enter a budget greater than 0."})
    if not delivery_date:
        errors.append({"field": "deliveryDate", "message": "Delivery date is required."})
    if not next_follow_up:
        errors.append({"field": "nextFollowUp", "message": "Pick the next follow-up date."})
    return errors


def add_minutes(
    user: Profile, lead_id: str, *, note: str | None, occasion: str | None, quantity, budget, delivery_date: str | None,
    next_follow_up: date | None, meeting_id: str | None, file: tuple[bytes, str | None] | None,
) -> dict:
    lead = leads.get_lead_row(user, lead_id)
    if lead["stage"] in CLOSED:
        raise AppError("This lead is closed.")
    errors = validate(note, file is not None, occasion, quantity, budget, delivery_date, next_follow_up)
    if errors:
        raise AppError("Some required details are missing.", {"errors": errors}, 422)

    path = name = None
    if file:
        data, filename = file
        mime, ext = checked_document(data, filename)
        path, name = upload_document(lead_id, data, mime, ext), (filename or f"minutes.{ext}")[:200]

    db = get_service_client()
    requirement = {
        **(lead.get("requirement") or {}),
        "occasion": occasion.strip(), "quantity": float(quantity), "budget": float(budget), "deliveryDate": delivery_date,
    }
    mom = (
        db.table("moms").insert(
            {"lead_id": lead_id, "meeting_id": meeting_id, "body": (note or "").strip() or None, "file_path": path, "file_name": name, "created_by": user.id}
        ).execute().data[0]
    )
    par(
        lambda: db.table("leads").update(
            {"requirement": requirement, "estimate_amount": float(budget), "updated_at": now_ist().isoformat()}
        ).eq("id", lead_id).execute(),
        lambda: add_activity(lead_id, user.id, "mom", note=(note or "").strip()[:400] or f"File: {name}", meta={"momId": mom["id"], "file": name}),
        lambda: tasks.set_next_action(lead_id, lead["owner_id"], next_follow_up),
        lambda: leads.auto_advance(lead, "requirement_received", user.id, "Minutes saved"),
    )
    write_audit(user.id, "create", "moms", mom["id"], {"lead": lead_id})
    return {**mom, "stage": lead["stage"]}


def list_minutes(lead_id: str) -> list[dict]:
    rows = get_service_client().table("moms").select("*, author:profiles!created_by(full_name)").eq("lead_id", lead_id).order("created_at", desc=True).limit(50).execute().data
    urls = signed_urls(DOCUMENTS, [r.get("file_path") for r in rows])
    for r in rows:
        r["file_url"] = urls.get(r.get("file_path") or "")
        r.pop("file_path", None)
    return rows
