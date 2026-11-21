"""Quotations: build from line items, check the discount against the executive's limit, ask for approval when it is
too high, make the PDF, and send it. Sending is the action that moves the lead to Quotation Sent."""
import logging
from datetime import datetime
from decimal import Decimal
from html import escape

from src.core.access import team_ids
from src.core.audit import write_audit
from src.core.config import settings
from src.core.dates import IST, now_ist, today_ist
from src.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from src.core.money import format_inr, to_money
from src.core.parallel import par
from src.core.storage import signed_document_url, upload_document
from src.core.supabase import get_service_client
from src.core.timeline import add_activity
from src.core.email import send_email
from src.modules.auth.schemas import Profile, Role
from src.modules.leads import service as leads
from src.modules.leads.stages import CLOSED
from src.modules.notifications.service import notify
from src.modules.quotations import pdf, schemas
from src.modules.targets.service import discount_limit_for
from src.modules.tasks import service as tasks
from src.modules.whatsapp import service as whatsapp
from src.modules.whatsapp.schemas import SendMessage

log = logging.getLogger(__name__)
SENDABLE = {"ready", "approved", "sent"}  # sent is allowed again: re-sending the same version is fine
LINK_DAYS = 7


# --- pure rules (tested without a database) ---------------------------------------------------------------------

def totals(items: list[tuple[Decimal, Decimal]], discount_pct: Decimal) -> tuple[Decimal, Decimal, Decimal]:
    """(subtotal, discount amount, total), all rounded to paise. Items are (quantity, unit price)."""
    subtotal = to_money(sum((q * p for q, p in items), Decimal("0")))
    discount = to_money(subtotal * discount_pct / 100)
    return subtotal, discount, to_money(subtotal - discount)


def status_for(creator_role: Role, discount_pct: Decimal, limit: Decimal) -> str:
    """Managers and admins can quote any discount. An executive's discount must be within their own limit."""
    if creator_role in (Role.SALES_MANAGER, Role.ADMIN):
        return "approved"
    return "ready" if discount_pct <= limit else "pending_approval"


def quote_number(lead_id: str, version: int) -> str:
    return f"Q-{lead_id.replace('-', '')[:6].upper()}-V{version}"


def can_decide(actor: Profile, owner_id: str | None) -> bool:
    if actor.role == Role.ADMIN:
        return True
    return actor.role == Role.SALES_MANAGER and owner_id in team_ids(actor)


# --- templates --------------------------------------------------------------------------------------------------------

def list_templates() -> list[dict]:
    return get_service_client().table("quotation_templates").select("*").order("is_default", desc=True).order("name").execute().data


def save_template(body: schemas.TemplateIn, template_id: str | None = None) -> dict:
    db = get_service_client()
    row = body.model_dump()
    if row["is_default"]:
        db.table("quotation_templates").update({"is_default": False}).eq("is_default", True).execute()
    if template_id:
        res = db.table("quotation_templates").update(row).eq("id", template_id).execute()
        if not res.data:
            raise NotFoundError("Template not found.")
        return res.data[0]
    return db.table("quotation_templates").insert(row).execute().data[0]


def _template(template_id: str | None) -> dict | None:
    db = get_service_client()
    if template_id:
        rows = db.table("quotation_templates").select("*").eq("id", template_id).limit(1).execute().data
    else:
        rows = db.table("quotation_templates").select("*").eq("is_default", True).limit(1).execute().data
    return rows[0] if rows else None


# --- create / read ----------------------------------------------------------------------------------------------------

def _approvers(owner_id: str | None) -> list[str]:
    db = get_service_client()
    ids = {r["id"] for r in db.table("profiles").select("id").eq("role", Role.ADMIN.value).eq("is_active", True).execute().data}
    if owner_id:
        mgr = db.table("profiles").select("manager_id").eq("id", owner_id).limit(1).execute().data
        if mgr and mgr[0].get("manager_id"):
            ids.add(mgr[0]["manager_id"])
    ids.discard(owner_id)
    return list(ids)


def create_quotation(user: Profile, lead_id: str, body: schemas.QuotationCreate) -> dict:
    lead = leads.get_lead_row(user, lead_id)
    if lead["stage"] in CLOSED:
        raise AppError("This lead is closed.")
    db = get_service_client()
    items = [(i.quantity, i.unit_price) for i in body.items]
    subtotal, discount, total = totals(items, body.discount_pct)
    if total <= 0:
        raise AppError("The total must be greater than 0.", {"errors": [{"field": "items", "message": "Add at least one priced item."}]}, 422)

    latest = db.table("quotations").select("version").eq("lead_id", lead_id).order("version", desc=True).limit(1).execute().data
    version = (latest[0]["version"] if latest else 0) + 1
    limit = discount_limit_for(lead["owner_id"]) if lead.get("owner_id") else Decimal("0")
    status = status_for(user.role, body.discount_pct, limit)
    try:
        q = (
            db.table("quotations").insert(
                {
                    "lead_id": lead_id, "version": version, "status": status, "template_id": body.template_id or (_template(None) or {}).get("id"),
                    "subtotal": float(subtotal), "discount_pct": float(body.discount_pct), "discount_amount": float(discount), "total": float(total),
                    "valid_days": body.valid_days, "notes": body.notes, "discount_limit": float(limit), "created_by": user.id,
                }
            ).execute().data[0]
        )
    except Exception as exc:  # noqa: BLE001 - the unique (lead, version) rule: two people saved at the same moment
        if "duplicate" in str(exc).lower() or "23505" in str(exc):
            raise ConflictError("Someone just saved another version. Open the quotation list again and try once more.") from exc
        raise
    db.table("quotation_items").insert(
        [{"quotation_id": q["id"], "position": n, "description": i.description, "quantity": float(i.quantity), "unit_price": float(i.unit_price)} for n, i in enumerate(body.items, 1)]
    ).execute()

    note = f"Quotation v{version}: {format_inr(total)}" + (f" with {body.discount_pct:g}% discount" if body.discount_pct else "")
    steps = [lambda: add_activity(lead_id, user.id, "quotation", outcome=status, note=note, meta={"quotationId": q["id"], "version": version})]
    if status == "pending_approval":
        for approver in _approvers(lead.get("owner_id")):
            steps.append(lambda a=approver: notify(a, f"approval:{q['id']}", "Discount needs approval", f"{lead['company']['name']}: {body.discount_pct:g}% (limit {limit:g}%)", "/team"))
    if version > 1 or status == "pending_approval":
        # On a client project, a revised proposal or a discount request means the deal is in Negotiation.
        # (On a new-business lead this does nothing: that pipeline has no Negotiation stage.)
        steps.append(lambda: leads.auto_advance(lead, "project_negotiation", user.id, "Revised proposal" if version > 1 else "Discount approval requested"))
    par(*steps)
    write_audit(user.id, "create", "quotations", q["id"], {"lead": lead_id, "version": version, "status": status})
    return {**q, "number": quote_number(lead_id, version), "needs_approval": status == "pending_approval"}


def list_quotations(lead_id: str) -> list[dict]:
    db = get_service_client()
    rows = db.table("quotations").select("*, author:profiles!created_by(full_name)").eq("lead_id", lead_id).order("version", desc=True).limit(30).execute().data
    if not rows:
        return []
    items = db.table("quotation_items").select("*").in_("quotation_id", [r["id"] for r in rows]).order("position").execute().data
    by_q: dict[str, list] = {}
    for it in items:
        by_q.setdefault(it["quotation_id"], []).append(it)
    for r in rows:
        r["items"] = by_q.get(r["id"], [])
        r["number"] = quote_number(lead_id, r["version"])
        r.pop("pdf_path", None)
    return rows


def _load(user: Profile, quotation_id: str) -> tuple[dict, dict, list[dict]]:
    db = get_service_client()
    rows = db.table("quotations").select("*").eq("id", quotation_id).limit(1).execute().data
    if not rows:
        raise NotFoundError("Quotation not found.")
    q = rows[0]
    lead = leads.get_lead_row(user, q["lead_id"])  # also checks the user may see this lead
    items = db.table("quotation_items").select("*").eq("quotation_id", quotation_id).order("position").execute().data
    return q, lead, items


def make_pdf(user: Profile, quotation_id: str) -> tuple[bytes, str]:
    q, lead, items = _load(user, quotation_id)
    number = quote_number(q["lead_id"], q["version"])
    created = datetime.fromisoformat(q["created_at"]).astimezone(IST).date()
    data = pdf.render(
        number=number, created=created, valid_days=q["valid_days"], lead=lead, items=items, subtotal=q["subtotal"], discount_pct=q["discount_pct"],
        discount_amount=q["discount_amount"], total=q["total"], template=_template(q.get("template_id")), notes=q.get("notes"),
    )
    return data, number


# --- approvals ------------------------------------------------------------------------------------------------------------

def pending_approvals(user: Profile) -> list[dict]:
    if user.role not in (Role.ADMIN, Role.SALES_MANAGER):
        raise ForbiddenError()
    db = get_service_client()
    q = db.table("quotations").select("*, author:profiles!created_by(full_name), lead:leads(id,owner_id,company:companies(name),contact:contacts(name))").eq("status", "pending_approval")
    rows = q.order("created_at").limit(100).execute().data
    scope = None if user.role == Role.ADMIN else team_ids(user)
    out = []
    for r in rows:
        lead = r.pop("lead", None) or {}
        if scope is not None and lead.get("owner_id") not in scope:
            continue
        r["number"] = quote_number(r["lead_id"], r["version"])
        r["company_name"] = (lead.get("company") or {}).get("name")
        r["contact_name"] = (lead.get("contact") or {}).get("name")
        r["owner_id"] = lead.get("owner_id")
        out.append(r)
    return out


def decide(user: Profile, quotation_id: str, body: schemas.Decision) -> dict:
    db = get_service_client()
    rows = db.table("quotations").select("*, lead:leads(owner_id,company:companies(name))").eq("id", quotation_id).limit(1).execute().data
    if not rows:
        raise NotFoundError("Quotation not found.")
    q = rows[0]
    lead = q.pop("lead")
    if not can_decide(user, lead.get("owner_id")):
        raise ForbiddenError("Only the owner's manager or an admin can decide this.")
    if q["status"] != "pending_approval":
        raise AppError("This quotation is not waiting for approval.")
    status = "approved" if body.approve else "rejected"
    db.table("quotations").update({"status": status, "decided_by": user.id, "decision_note": body.note, "decided_at": now_ist().isoformat()}).eq("id", quotation_id).execute()
    verdict = "approved" if body.approve else "rejected"
    par(
        lambda: add_activity(q["lead_id"], user.id, "quotation", outcome=status, note=f"Quotation v{q['version']} {verdict}" + (f": {body.note}" if body.note else "")),
        lambda: notify(lead["owner_id"], f"decision:{quotation_id}", f"Discount {verdict}", f"{lead['company']['name']} v{q['version']}" + (f": {body.note}" if body.note else ""), f"/leads/{q['lead_id']}") if lead.get("owner_id") else None,
    )
    write_audit(user.id, "decision", "quotations", quotation_id, {"status": status})
    return {"id": quotation_id, "status": status}


# --- send ------------------------------------------------------------------------------------------------------------------

def send(user: Profile, quotation_id: str, body: schemas.SendQuotation) -> dict:
    q, lead, _items = _load(user, quotation_id)
    if q["status"] not in SENDABLE:
        raise AppError(
            "Waiting for the manager's approval." if q["status"] == "pending_approval" else "This version was rejected. Make a new version.",
            status_code=409,
        )
    if lead["stage"] in CLOSED:
        raise AppError("This lead is closed.")
    if body.next_follow_up < today_ist():
        raise AppError("Pick a follow-up date from today onwards.", {"errors": [{"field": "nextFollowUp", "message": "Pick a date from today onwards."}]}, 422)
    contact = lead["contact"]
    if body.channel == "whatsapp" and not contact.get("phone"):
        raise AppError("This contact has no phone number.", {"errors": [{"field": "channel", "message": "No phone number on this lead."}]}, 422)
    if body.channel == "email" and not contact.get("email"):
        raise AppError("This contact has no email address.", {"errors": [{"field": "channel", "message": "No email on this lead."}]}, 422)

    data, number = make_pdf(user, quotation_id)
    path = upload_document(q["lead_id"], data, "application/pdf", "pdf")
    link = signed_document_url(path, LINK_DAYS * 86400, download_name=f"{number}.pdf")
    total = format_inr(q["total"])
    company = lead["company"]["name"]

    result: dict = {"channel": body.channel, "mode": body.channel}
    if body.channel == "email":
        send_email(
            contact["email"], f"Quotation {number} from {escape(settings.COMPANY_NAME)}",
            f"<p>Dear {escape(contact['name'])},</p><p>Please find our quotation <b>{number}</b> for {escape(company)} attached. Total: <b>{total}</b>.</p>"
            f"<p>It is valid for {q['valid_days']} days. Reply to this email with any questions.</p>",
            [(f"{number}.pdf", data)],
        )
    else:
        text = f"Hello {contact['name']}, here is our quotation {number} for {company}. Total: {total}. Valid for {q['valid_days']} days.\nView or download: {link}"
        try:
            result.update(whatsapp.send(user, q["lead_id"], SendMessage(body=text)))
        except AppError as exc:
            if (exc.data or {}).get("code") != "template_required":
                raise
            # The 24-hour window is closed and a free message is not allowed: hand over a click-to-chat link instead.
            result.update(whatsapp.send(user, q["lead_id"], SendMessage(body=text), force_click=True))

    db = get_service_client()
    requirement = {**(lead.get("requirement") or {}), "quotationTotal": float(q["total"])}
    par(
        lambda: db.table("quotations").update({"status": "sent", "sent_at": now_ist().isoformat(), "sent_via": body.channel, "pdf_path": path}).eq("id", quotation_id).execute(),
        lambda: db.table("leads").update({"quote_amount": float(q["total"]), "requirement": requirement, "updated_at": now_ist().isoformat()}).eq("id", q["lead_id"]).execute(),
        lambda: add_activity(q["lead_id"], user.id, "quotation", outcome="sent", note=f"Quotation v{q['version']} ({total}) sent by {body.channel}", meta={"quotationId": quotation_id}),
        lambda: tasks.set_next_action(q["lead_id"], lead["owner_id"], body.next_follow_up),
        lambda: leads.auto_advance(lead, "quotation_sent", user.id, "Quotation sent"),
    )
    write_audit(user.id, "send", "quotations", quotation_id, {"channel": body.channel})
    return result
