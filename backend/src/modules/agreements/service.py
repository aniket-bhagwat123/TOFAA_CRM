"""The agreement: prepared in the CRM (packages, scope, commercials, terms, signees), printed as a PDF, then the
checklist (sent, signed, invoice raised, payment received) and the payment request."""
import logging
import secrets
from decimal import Decimal

from src.core.audit import write_audit
from src.core.dates import now_ist, today_ist
from src.core.errors import AppError, ConflictError, ForbiddenError
from src.core.money import format_inr, to_money
from src.core.parallel import par
from src.core.storage import DOCUMENTS, signed_urls
from src.core.supabase import get_service_client
from src.core.timeline import add_activity
from src.modules.agreements import schemas
from src.modules.auth.schemas import Profile, Role
from src.modules.leads import service as leads
from src.modules.leads.stages import CLOSED
from src.modules.notifications.service import notify

log = logging.getLogger(__name__)
DETAILS_NOT_READY = "Preparing the agreement is not set up yet. An admin needs to apply the database migration 20260113000000_agreement_details.sql, then try again."


def _upsert(lead_id: str, **fields) -> None:
    get_service_client().table("agreements").upsert({"lead_id": lead_id, "updated_at": now_ist().isoformat(), **fields}, on_conflict="lead_id").execute()


def state(lead_id: str) -> dict:
    db = get_service_client()
    ag, pay = par(
        lambda: db.table("agreements").select("*").eq("lead_id", lead_id).limit(1).execute().data,
        lambda: db.table("payment_requests").select("*").eq("lead_id", lead_id).order("requested_at", desc=True).limit(1).execute().data,
    )
    ag = ag[0] if ag else {}
    details = ag.get("details")
    photo_paths = [x for p in ((details or {}).get("packages") or []) for x in (p.get("photos") or [])]
    urls = signed_urls(DOCUMENTS, [ag.get("signed_path"), *photo_paths])
    url = urls.get(ag.get("signed_path") or "")
    if details:
        details = {**details, "packages": [{**p, "photos": [{"path": x, "url": urls.get(x)} for x in (p.get("photos") or [])]} for p in details.get("packages") or []]}
    return {
        "details": details, "totalAmount": ag.get("total_amount"), "preparedAt": ag.get("prepared_at"),
        "termsStatus": ag.get("terms_status") or "standard", "termsNote": ag.get("terms_note"),
        "options": {"scope": [{"value": k, "label": v} for k, v in schemas.SCOPE.items()], "gstRates": list(schemas.GST_RATES), "defaultTerms": schemas.DEFAULT_TERMS},
        "sentAt": ag.get("sent_at"), "signedAt": ag.get("signed_at"), "signedName": ag.get("signed_name"), "signedUrl": url,
        "invoiceNumber": ag.get("invoice_number"), "invoiceRaisedAt": ag.get("invoice_raised_at"), "paymentReceivedAt": ag.get("payment_received_at"),
        "payment": pay[0] if pay else None,
    }


# --- prepare ---------------------------------------------------------------------------------------------------------

def commercials(packages: list[dict], transportation, gst_rate) -> dict:
    """Totals worked out from the packages: volume, base, average rate, transport, GST and the total project cost.
    GST is charged on the base plus transportation."""
    units = sum((Decimal(str(p["quantity"])) for p in packages), Decimal("0"))
    base = to_money(sum((Decimal(str(p["quantity"])) * Decimal(str(p["unit_price"])) for p in packages), Decimal("0")))
    transport = to_money(Decimal(str(transportation or 0)))
    gst = to_money((base + transport) * Decimal(str(gst_rate or 0)) / 100)
    return {
        "units": float(units), "base": float(base), "avgRate": float(to_money(base / units)) if units else 0.0,
        "transportation": float(transport), "gstRate": float(gst_rate or 0), "gst": float(gst), "total": float(base + transport + gst),
    }


def save_details(user: Profile, lead_id: str, body: schemas.AgreementDetails) -> dict:
    """Save the prepared agreement (the sheet always sends all of it). Totals are worked out here, never trusted from the browser."""
    from src.modules.quotations.service import _check_photo_paths

    lead = leads.get_lead_row(user, lead_id)
    if lead["stage"] in CLOSED:
        raise AppError("This lead is closed.")
    _check_photo_paths(lead_id, body.packages)
    packages = [
        {"name": p.name, "unit_price": float(p.unit_price), "quantity": float(p.quantity),
         "items": [{"name": i.name, "description": i.description or None} for i in p.items], "photos": list(dict.fromkeys(p.photos))}
        for p in body.packages
    ]
    totals = commercials(packages, body.transportation, body.gst_rate)
    if totals["total"] <= 0:
        raise AppError("The total must be greater than 0.", {"errors": [{"field": "packages", "message": "Give at least one requirement a rate."}]}, 422)
    details = {
        "packages": packages, "scope": body.scope, "scopeOther": body.scope_other if "other" in body.scope else None,
        "transportation": float(body.transportation), "gstRate": body.gst_rate,
        "terms": [t.model_dump() for t in body.terms], "tofaaSignee": body.tofaa_signee, "clientSignee": body.client_signee,
        "remarks": body.remarks, "totals": totals,
    }
    existing = get_service_client().table("agreements").select("*").eq("lead_id", lead_id).limit(1).execute().data
    before = existing[0] if existing else {}
    first = not before.get("details")
    status = terms_status_for(user, details["terms"], before)
    fields = {"details": details, "total_amount": totals["total"], "prepared_at": now_ist().isoformat(), "terms_status": status}
    if status == "pending":
        fields |= {"terms_decided_by": None, "terms_decided_at": None, "terms_note": None}
    try:
        _upsert(lead_id, **fields)
    except Exception as exc:
        text = str(exc)
        if "terms_" in text and "details" not in text:
            # Before migration 20260114000000_menu_v2.sql there is no terms approval: save the agreement as it is.
            log.warning("agreements.terms_status missing; saving without terms approval")
            status = "standard"
            _upsert(lead_id, details=details, total_amount=totals["total"], prepared_at=fields["prepared_at"])
        elif "details" in text or "total_amount" in text or "prepared_at" in text:
            raise AppError(DETAILS_NOT_READY, status_code=503) from exc
        else:
            raise
    add_activity(lead_id, user.id, "agreement", outcome="prepared", note=f"Agreement {'prepared' if first else 'updated'}: {format_inr(totals['total'])}"
                 + (" (custom terms sent for approval)" if status == "pending" and before.get("terms_status") != "pending" else ""))
    if status == "pending" and before.get("terms_status") != "pending":
        for a in _approvers(lead.get("owner_id")):
            notify(a, f"terms:{lead_id}", "Agreement terms need approval", f"{lead['company']['name']}: custom contract terms", "/approvals")
    # Preparing the agreement is the action that moves the lead to Agreement and Payment.
    leads.auto_advance(lead, "agreement_payment", user.id, "Agreement prepared")
    write_audit(user.id, "prepare", "agreements", lead_id, {"total": totals["total"]})
    return state(lead_id)


# --- terms approval --------------------------------------------------------------------------------------------------

def _terms_key(terms: list[dict]) -> list[tuple[str, str]]:
    return [((t.get("title") or "").strip(), (t.get("body") or "").strip()) for t in terms]


def terms_status_for(user: Profile, terms: list[dict], before: dict) -> str:
    """Standard terms need nobody. Changed or extra terms from a KAM wait for a manager, unless they are exactly
    the terms already approved. Managers and admins approve their own."""
    if _terms_key(terms) == _terms_key(schemas.DEFAULT_TERMS):
        return "standard"
    if user.role in (Role.SALES_MANAGER, Role.ADMIN):
        return "approved"
    old = before.get("details") or {}
    if before.get("terms_status") == "approved" and _terms_key(old.get("terms") or []) == _terms_key(terms):
        return "approved"
    return "pending"


def _approvers(owner_id: str | None) -> list[str]:
    db = get_service_client()
    ids = {r["id"] for r in db.table("profiles").select("id").eq("role", Role.ADMIN.value).eq("is_active", True).execute().data}
    if owner_id:
        mgr = db.table("profiles").select("manager_id").eq("id", owner_id).limit(1).execute().data
        if mgr and mgr[0].get("manager_id"):
            ids.add(mgr[0]["manager_id"])
    ids.discard(owner_id)
    return list(ids)


def pending_terms(user: Profile) -> list[dict]:
    """Agreements whose custom terms wait for this manager (their team) or any admin."""
    if user.role not in (Role.ADMIN, Role.SALES_MANAGER):
        raise ForbiddenError()
    try:
        rows = (
            get_service_client().table("agreements").select("lead_id,details,total_amount,prepared_at,lead:leads(id,owner_id,company:companies(name),contact:contacts(name),owner:profiles!owner_id(full_name))")
            .eq("terms_status", "pending").order("prepared_at").limit(100).execute().data
        )
    except Exception:  # noqa: BLE001 - before the migration nothing can be pending
        return []
    scope = None  # managers and admins see every agreement waiting, whoever owns the deal
    defaults = {t for t in _terms_key(schemas.DEFAULT_TERMS)}
    out = []
    for r in rows:
        lead = r.get("lead") or {}
        if scope is not None and lead.get("owner_id") not in scope:
            continue
        terms = (r.get("details") or {}).get("terms") or []
        out.append({
            "leadId": r["lead_id"], "companyName": (lead.get("company") or {}).get("name"), "contactName": (lead.get("contact") or {}).get("name"),
            "ownerName": (lead.get("owner") or {}).get("full_name"), "total": r.get("total_amount"), "preparedAt": r.get("prepared_at"),
            "terms": [{**t, "custom": (t.get("title", "").strip(), t.get("body", "").strip()) not in defaults} for t in terms],
        })
    return out


def decide_terms(user: Profile, lead_id: str, approve: bool, note: str | None) -> dict:
    if user.role not in (Role.ADMIN, Role.SALES_MANAGER):
        raise ForbiddenError("Only the owner's manager or an admin can decide this.")
    lead = leads.get_lead_row(user, lead_id)
    rows = get_service_client().table("agreements").select("terms_status").eq("lead_id", lead_id).limit(1).execute().data
    if not rows or rows[0].get("terms_status") != "pending":
        raise AppError("These terms are not waiting for approval.", status_code=409)
    status = "approved" if approve else "rejected"
    _upsert(lead_id, terms_status=status, terms_decided_by=user.id, terms_decided_at=now_ist().isoformat(), terms_note=note)
    verdict = "approved" if approve else "rejected"
    add_activity(lead_id, user.id, "agreement", outcome=f"terms_{verdict}", note=f"Custom contract terms {verdict}" + (f": {note}" if note else ""))
    if lead.get("owner_id"):
        notify(lead["owner_id"], f"terms-decision:{lead_id}", f"Agreement terms {verdict}", f"{lead['company']['name']}" + (f": {note}" if note else ""), f"/leads/{lead_id}")
    write_audit(user.id, "terms_decision", "agreements", lead_id, {"status": status})
    return state(lead_id)


def make_pdf(user: Profile, lead_id: str) -> tuple[bytes, str]:
    from src.modules.agreements import pdf

    lead = leads.get_lead_row(user, lead_id)
    rows = get_service_client().table("agreements").select("*").eq("lead_id", lead_id).limit(1).execute().data
    details = (rows[0] if rows else {}).get("details")
    if not details:
        raise AppError("Prepare the agreement first, then download it.", status_code=409)
    terms = (rows[0] or {}).get("terms_status")
    if terms in ("pending", "rejected") and user.role == Role.KAM:
        raise AppError(
            "The custom contract terms are waiting for your manager's approval." if terms == "pending"
            else "Your manager rejected the custom contract terms. Change them and save again.",
            status_code=409,
        )
    number = f"A-{lead_id.replace('-', '')[:6].upper()}"
    data = pdf.render(number=number, created=today_ist(), lead=lead, details=details, scope_labels=schemas.SCOPE)
    return data, number


def mark_sent(user: Profile, lead_id: str) -> dict:
    lead = leads.get_lead_row(user, lead_id)
    if lead["stage"] in CLOSED:
        raise AppError("This lead is closed.")
    _upsert(lead_id, sent_at=now_ist().isoformat())
    add_activity(lead_id, user.id, "agreement", outcome="sent", note="Agreement sent to the client")
    return state(lead_id)


def _agreement_total(lead_id: str):
    try:
        rows = get_service_client().table("agreements").select("total_amount").eq("lead_id", lead_id).limit(1).execute().data
        return rows[0]["total_amount"] if rows else None
    except Exception:  # noqa: BLE001 - before the migration there is no agreement total
        return None


def request_payment(user: Profile, lead_id: str, invoice_number: str | None, amount) -> dict:
    lead = leads.get_lead_row(user, lead_id)
    # The screen does not ask for an invoice number. The column is required and unique, so a reference stands in.
    invoice = (invoice_number or "").strip() or f"PR-{secrets.token_hex(4).upper()}"
    errors = []
    money = None
    try:
        money = to_money(amount if amount not in (None, "") else (_agreement_total(lead_id) or lead.get("quote_amount") or 0))
        if money <= 0:
            raise ValueError
    except ValueError:
        errors.append({"field": "amount", "message": "Enter an amount greater than 0."})
    if errors:
        raise AppError("Some required details are missing.", {"errors": errors}, 422)
    if lead["stage"] != "agreement_payment":
        raise AppError("Prepare the agreement first. Payment is requested at the Agreement and Payment stage.", status_code=409)

    db = get_service_client()
    open_req = db.table("payment_requests").select("invoice_number").eq("lead_id", lead_id).in_("status", ["requested", "partial"]).limit(1).execute().data
    if open_req:
        raise ConflictError(f"A payment request is already open for this lead (reference {open_req[0]['invoice_number']}).")
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
        lambda: add_activity(lead_id, user.id, "payment", outcome="requested", note=f"Payment requested: {format_inr(money)} (reference {invoice})"),
        *[(lambda f=f: notify(f, f"payreq:{req['id']}", "Payment requested", f"{company}: {format_inr(money)} (reference {invoice})", "/payments")) for f in finance if f != user.id],
    )
    write_audit(user.id, "payment_requested", "payment_requests", req["id"], {"invoice": invoice})
    return req
