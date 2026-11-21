"""Payments. The ERP (or Finance, through the fallback button) is the only thing that can mark a payment received.
An executive can only ask for it. When the full amount has arrived the deal becomes Closed Won by itself."""
import hashlib
import hmac
import logging
from decimal import Decimal

from src.core.audit import write_audit
from src.core.config import settings
from src.core.dates import now_ist
from src.core.errors import AppError, ForbiddenError, NotFoundError
from src.core.money import format_inr, to_money
from src.core.parallel import par
from src.core.supabase import get_service_client
from src.core.timeline import add_activity
from src.modules.auth.schemas import Profile, Role
from src.modules.notifications.service import notify
from src.modules.tasks import service as tasks

log = logging.getLogger(__name__)
SELECT = "*, lead:leads(id,owner_id,stage,company:companies(name),contact:contacts(name)), requester:profiles!requested_by(full_name)"


def decide_status(amount: Decimal, paid_total: Decimal) -> str:
    """'confirmed' once the whole invoice is paid; 'partial' while some of it has arrived."""
    return "confirmed" if paid_total >= amount else "partial"


def valid_signature(raw: bytes, header: str | None) -> bool:
    """The ERP signs each callback with the shared secret. With no secret configured we accept nothing."""
    if not settings.ERP_WEBHOOK_SECRET or not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(settings.ERP_WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header[len("sha256="):])


def list_requests(user: Profile, status: str | None) -> list[dict]:
    if user.role not in (Role.FINANCE, Role.ADMIN):
        raise ForbiddenError("Only Finance and admins see payments.")
    q = get_service_client().table("payment_requests").select(SELECT)
    if status in ("requested", "partial", "confirmed"):
        q = q.eq("status", status)
    rows = q.order("requested_at", desc=True).limit(200).execute().data
    out = []
    for r in rows:
        lead = r.pop("lead", None) or {}
        r["lead_id"] = lead.get("id")
        r["company_name"] = (lead.get("company") or {}).get("name")
        r["contact_name"] = (lead.get("contact") or {}).get("name")
        r["requested_by_name"] = (r.pop("requester", None) or {}).get("full_name")
        out.append(r)
    return out


def _load(request_id: str | None = None, invoice: str | None = None) -> dict:
    q = get_service_client().table("payment_requests").select("*, lead:leads(id,owner_id,stage,version,company:companies(name))")
    q = q.eq("id", request_id) if request_id else q.eq("invoice_number", invoice)
    rows = q.limit(1).execute().data
    if not rows:
        raise NotFoundError("No payment request matches that invoice number.")
    return rows[0]


def apply_payment(req: dict, paid_total: Decimal, source: str, actor_id: str | None) -> dict:
    """Record what has arrived. Closes the deal as Won only when the invoice is fully paid."""
    amount = to_money(req["amount"])
    status = decide_status(amount, paid_total)
    lead = req["lead"]
    db = get_service_client()
    patch = {"amount_paid": float(paid_total), "status": status}
    if status == "confirmed":
        patch |= {"confirmed_at": now_ist().isoformat(), "confirmed_by": actor_id, "source": source}
    db.table("payment_requests").update(patch).eq("id", req["id"]).execute()

    company = lead["company"]["name"]
    if status == "partial":
        note = f"Partial payment: {format_inr(paid_total)} of {format_inr(amount)} received (invoice {req['invoice_number']})"
        par(
            lambda: add_activity(lead["id"], actor_id, "payment", outcome="partial", note=note),
            lambda: notify(lead["owner_id"], f"pay:{req['id']}:{paid_total}", "Partial payment received", f"{company}: {format_inr(paid_total)} of {format_inr(amount)}", f"/leads/{lead['id']}") if lead.get("owner_id") else None,
        )
        return {"status": status, "amountPaid": float(paid_total)}

    now = now_ist().isoformat()
    par(
        lambda: db.table("leads").update(
            {"stage": "closed_won", "paid_amount": float(paid_total), "closed_at": now, "next_follow_up": None, "updated_at": now, "lost_reason": None}
        ).eq("id", lead["id"]).execute(),
        lambda: db.table("agreements").update({"payment_received_at": now, "updated_at": now}).eq("lead_id", lead["id"]).execute(),
        lambda: tasks.close_open_tasks(lead["id"], "won"),
        lambda: add_activity(lead["id"], actor_id, "stage_change", note="Payment confirmed", meta={"from": lead["stage"], "to": "closed_won", "auto": True}),
        lambda: add_activity(lead["id"], actor_id, "payment", outcome="confirmed", note=f"Payment of {format_inr(paid_total)} confirmed ({source}), invoice {req['invoice_number']}"),
        lambda: notify(lead["owner_id"], f"won:{req['id']}", "Deal won: payment received", f"{company}: {format_inr(paid_total)}", f"/leads/{lead['id']}") if lead.get("owner_id") else None,
    )
    try:
        from src.modules.clients.service import on_deal_won  # local import: clients imports quotations and leads

        on_deal_won(lead["id"])  # the first paid deal makes the company a client
    except Exception:  # noqa: BLE001 - the payment is recorded; client details can be fixed by hand
        log.exception("could not mark the company as a client")
    write_audit(actor_id or "", "payment_confirmed", "payment_requests", req["id"], {"invoice": req["invoice_number"], "amount": float(paid_total), "source": source})
    return {"status": status, "amountPaid": float(paid_total)}


def confirm(user: Profile, request_id: str, amount) -> dict:
    """Finance's fallback button, until the ERP link is live."""
    if user.role not in (Role.FINANCE, Role.ADMIN):
        raise ForbiddenError("Only Finance can confirm a payment.")
    if not settings.PAYMENT_FALLBACK_ENABLED:
        raise ForbiddenError("Payments are confirmed by the ERP now. This button is switched off.")
    req = _load(request_id=request_id)
    if req["status"] == "confirmed":
        raise AppError("This payment is already confirmed.", status_code=409)
    paid = to_money(amount) if amount is not None else to_money(req["amount"])
    if paid <= 0:
        raise AppError("Enter an amount greater than 0.", status_code=422)
    total = to_money(req["amount_paid"] or 0) + paid  # what Finance enters is what arrived now
    return apply_payment(req, total, "finance", user.id)


def handle_erp(payload: dict) -> dict:
    """The ERP's callback. Assumed contract until the ERP team confirms theirs:
    {"invoiceNumber": "INV-1", "status": "paid" | "partial", "amountPaid": 12345.5}
    where amountPaid is the total received so far. Matched by invoice number. Safe to repeat."""
    invoice = str(payload.get("invoiceNumber") or "").strip()
    if not invoice:
        raise AppError("invoiceNumber is required.", status_code=422)
    req = _load(invoice=invoice)
    if req["status"] == "confirmed":
        return {"status": "confirmed", "note": "already confirmed"}
    state = str(payload.get("status") or "").lower()
    if state not in ("paid", "partial"):
        raise AppError("status must be 'paid' or 'partial'.", status_code=422)
    raw = payload.get("amountPaid")
    paid = to_money(raw) if raw is not None else to_money(req["amount"])
    if paid <= 0:
        raise AppError("amountPaid must be greater than 0.", status_code=422)
    if state == "paid" and paid < to_money(req["amount"]):
        paid = to_money(req["amount"])  # the ERP says it is paid in full
    return apply_payment(req, paid, "erp", None)
