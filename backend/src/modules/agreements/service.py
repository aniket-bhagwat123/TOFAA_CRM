"""The agreement checklist (sent, signed, invoice raised, payment received) and the payment request."""
from datetime import date

from src.core.audit import write_audit
from src.core.dates import now_ist
from src.core.documents import checked_document
from src.core.errors import AppError, ConflictError
from src.core.money import format_inr, to_money
from src.core.parallel import par
from src.core.storage import DOCUMENTS, signed_urls, upload_document
from src.core.supabase import get_service_client
from src.core.timeline import add_activity
from src.modules.auth.schemas import Profile, Role
from src.modules.leads import service as leads
from src.modules.leads.stages import CLOSED
from src.modules.notifications.service import notify
from src.modules.tasks import service as tasks


def _upsert(lead_id: str, **fields) -> None:
    get_service_client().table("agreements").upsert({"lead_id": lead_id, "updated_at": now_ist().isoformat(), **fields}, on_conflict="lead_id").execute()


def state(lead_id: str) -> dict:
    db = get_service_client()
    ag, pay = par(
        lambda: db.table("agreements").select("*").eq("lead_id", lead_id).limit(1).execute().data,
        lambda: db.table("payment_requests").select("*").eq("lead_id", lead_id).order("requested_at", desc=True).limit(1).execute().data,
    )
    ag = ag[0] if ag else {}
    url = signed_urls(DOCUMENTS, [ag.get("signed_path")]).get(ag.get("signed_path") or "")
    return {
        "sentAt": ag.get("sent_at"), "signedAt": ag.get("signed_at"), "signedName": ag.get("signed_name"), "signedUrl": url,
        "invoiceNumber": ag.get("invoice_number"), "invoiceRaisedAt": ag.get("invoice_raised_at"), "paymentReceivedAt": ag.get("payment_received_at"),
        "payment": pay[0] if pay else None,
    }


def mark_sent(user: Profile, lead_id: str) -> dict:
    lead = leads.get_lead_row(user, lead_id)
    if lead["stage"] in CLOSED:
        raise AppError("This lead is closed.")
    _upsert(lead_id, sent_at=now_ist().isoformat())
    add_activity(lead_id, user.id, "agreement", outcome="sent", note="Agreement sent to the client")
    return state(lead_id)


def upload_signed(user: Profile, lead_id: str, data: bytes, filename: str | None, next_follow_up: date | None) -> dict:
    lead = leads.get_lead_row(user, lead_id)
    if lead["stage"] in CLOSED:
        raise AppError("This lead is closed.")
    if not next_follow_up:
        raise AppError("Pick the next follow-up date.", {"errors": [{"field": "nextFollowUp", "message": "Pick the next follow-up date."}]}, 422)
    mime, ext = checked_document(data, filename)
    path = upload_document(lead_id, data, mime, ext)
    name = (filename or f"agreement.{ext}")[:200]
    now = now_ist().isoformat()
    par(
        lambda: _upsert(lead_id, signed_at=now, signed_path=path, signed_name=name, sent_at=now),
        lambda: add_activity(lead_id, user.id, "agreement", outcome="signed", note=f"Signed agreement uploaded: {name}"),
        lambda: tasks.set_next_action(lead_id, lead["owner_id"], next_follow_up),
    )
    leads.auto_advance(lead, "agreement_payment", user.id, "Signed agreement uploaded")
    write_audit(user.id, "agreement_signed", "agreements", lead_id, {"file": name})
    return state(lead_id)


def request_payment(user: Profile, lead_id: str, invoice_number: str, amount) -> dict:
    lead = leads.get_lead_row(user, lead_id)
    invoice = (invoice_number or "").strip()
    errors = []
    if not invoice:
        errors.append({"field": "invoiceNumber", "message": "Enter the invoice number."})
    money = None
    try:
        money = to_money(amount if amount not in (None, "") else (lead.get("quote_amount") or 0))
        if money <= 0:
            raise ValueError
    except ValueError:
        errors.append({"field": "amount", "message": "Enter an amount greater than 0."})
    if errors:
        raise AppError("Some required details are missing.", {"errors": errors}, 422)
    if lead["stage"] != "agreement_payment":
        raise AppError("Upload the signed agreement first. Payment is requested at the Agreement and Payment stage.", status_code=409)

    db = get_service_client()
    open_req = db.table("payment_requests").select("invoice_number").eq("lead_id", lead_id).in_("status", ["requested", "partial"]).limit(1).execute().data
    if open_req:
        raise ConflictError(f"A payment request is already open for this lead (invoice {open_req[0]['invoice_number']}).")
    try:
        req = db.table("payment_requests").insert(
            {"lead_id": lead_id, "invoice_number": invoice, "amount": float(money), "requested_by": user.id}
        ).execute().data[0]
    except Exception as exc:  # noqa: BLE001 - invoice numbers are unique: the ERP matches on them
        if "duplicate" in str(exc).lower() or "23505" in str(exc):
            raise ConflictError("That invoice number is already used on another payment request.") from exc
        raise
    company = lead["company"]["name"]
    finance = [r["id"] for r in db.table("profiles").select("id").in_("role", [Role.FINANCE.value, Role.ADMIN.value]).eq("is_active", True).execute().data]
    par(
        lambda: _upsert(lead_id, invoice_number=invoice, invoice_raised_at=now_ist().isoformat()),
        lambda: add_activity(lead_id, user.id, "payment", outcome="requested", note=f"Payment requested: invoice {invoice}, {format_inr(money)}"),
        *[(lambda f=f: notify(f, f"payreq:{req['id']}", "Payment requested", f"{company}: invoice {invoice}, {format_inr(money)}", "/payments")) for f in finance if f != user.id],
    )
    write_audit(user.id, "payment_requested", "payment_requests", req["id"], {"invoice": invoice})
    return req
