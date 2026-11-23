"""Quotations: build from requirement packages, check the discount against the executive's limit, ask for approval when it is
too high, make the PDF, and send it. Sending is the action that moves the lead to Quotation Sent."""
import logging
from datetime import datetime
from decimal import Decimal
from html import escape

from src.core.access import team_ids
from src.core.audit import write_audit
from src.core.config import settings
from src.core.dates import IST, now_ist, today_ist
from src.core.documents import checked_document
from src.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from src.core.money import format_inr, to_money
from src.core.parallel import par
from src.core.storage import DOCUMENTS, signed_document_url, signed_urls, upload_document
from src.core.supabase import get_service_client
from src.core.timeline import add_activity
from src.core.email import send_email
from src.modules.auth.schemas import Profile, Role
from src.modules.leads import service as leads
from src.modules.leads.stages import CLOSED
from src.modules.notifications.service import notify
from src.modules.quotations import pdf, schemas
from src.modules.tasks import service as tasks
from src.modules.whatsapp import service as whatsapp
from src.modules.whatsapp.schemas import SendMessage

log = logging.getLogger(__name__)
SENDABLE = {"ready", "approved", "sent"}  # sent is allowed again: re-sending the same version is fine
LINK_DAYS = 7
MAX_PHOTO_BYTES = 5 * 1024 * 1024
PHOTO_TYPES = {"jpg", "png", "webp"}


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

def _check_photo_paths(lead_id: str, packages: list[schemas.PackageIn]) -> None:
    """Mockup photos must be ones uploaded for this lead (their path starts with the lead id)."""
    for p in packages:
        for path in p.photos:
            if not path.startswith(f"{lead_id}/") or ".." in path:
                raise AppError("One of the mockup photos does not belong to this lead. Upload it again.", status_code=422)


def _package_row(quotation_id: str, position: int, p: schemas.PackageIn) -> dict:
    return {
        "quotation_id": quotation_id, "position": position, "name": p.name, "unit_price": float(p.unit_price), "quantity": float(p.quantity),
        "items": [{"name": i.name, "description": i.description or None} for i in p.items], "photo_paths": list(dict.fromkeys(p.photos)),
    }


def _packages_for(quotation_ids: list[str]) -> list[dict]:
    """Packages of these quotations, in order. Empty (not an error) before the packages migration is applied."""
    try:
        return get_service_client().table("quotation_packages").select("*").in_("quotation_id", quotation_ids).order("position").execute().data
    except Exception:  # noqa: BLE001
        log.warning("could not read quotation packages", exc_info=True)
        return []


def _package_out(p: dict, urls: dict[str, str]) -> dict:
    paths = p.pop("photo_paths", None) or []
    return {**p, "photos": [{"path": path, "url": urls.get(path)} for path in paths]}


def _photo_bytes(packages: list[dict]) -> dict[str, bytes]:
    """path -> image bytes for the PDF. A photo that cannot be fetched is left out, never fatal."""
    paths = list(dict.fromkeys(path for p in packages for path in (p.get("photo_paths") or [])))
    if not paths:
        return {}
    bucket = get_service_client().storage.from_(DOCUMENTS)

    def fetch(path: str) -> bytes | None:
        try:
            return bucket.download(path)
        except Exception:  # noqa: BLE001
            log.warning("could not fetch mockup photo %s", path, exc_info=True)
            return None

    return {path: data for path, data in zip(paths, par(*[lambda x=x: fetch(x) for x in paths])) if data}


def copy_packages(quotation_id: str, to_lead_id: str) -> list[schemas.PackageIn]:
    """The packages of an earlier quotation, ready to quote again on another project ('same as last time').
    Mockup photos are copied under the new project. An old quotation made from flat line items becomes one
    package per line."""
    db = get_service_client()
    rows = _packages_for([quotation_id])
    if not rows:
        items = db.table("quotation_items").select("description,quantity,unit_price").eq("quotation_id", quotation_id).order("position").execute().data
        return [schemas.PackageIn(name=i["description"][:120], unit_price=Decimal(str(i["unit_price"])), quantity=Decimal(str(i["quantity"]))) for i in items]
    bucket = db.storage.from_(DOCUMENTS)

    def copy(path: str) -> str | None:
        new = f"{to_lead_id}/{path.rsplit('/', 1)[-1]}"
        try:
            bucket.copy(path, new)
            return new
        except Exception:  # noqa: BLE001 - a missing photo must not stop the repeat order
            log.warning("could not copy mockup photo %s", path, exc_info=True)
            return None

    out = []
    for p in rows:
        photos = [x for x in (copy(path) for path in (p.get("photo_paths") or [])) if x]
        out.append(schemas.PackageIn(
            name=p["name"], unit_price=Decimal(str(p["unit_price"])), quantity=Decimal(str(p["quantity"])),
            items=[schemas.PackageItemIn(name=i["name"], description=i.get("description")) for i in (p.get("items") or [])], photos=photos,
        ))
    return out


def upload_photo(user: Profile, lead_id: str, data: bytes, filename: str | None) -> dict:
    """Store one mockup photo for a requirement package and hand back its path (sent with the quotation) and a preview URL."""
    lead = leads.get_lead_row(user, lead_id)
    if lead["stage"] in CLOSED:
        raise AppError("This lead is closed.")
    if len(data) > MAX_PHOTO_BYTES:
        raise AppError("Each photo must be 5 MB or smaller.", status_code=413)
    mime, ext = checked_document(data, filename)
    if ext not in PHOTO_TYPES:
        raise AppError("Upload a JPEG, PNG or WebP image.", status_code=422)
    path = upload_document(lead_id, data, mime, ext)
    return {"path": path, "url": signed_urls(DOCUMENTS, [path]).get(path)}


def create_quotation(user: Profile, lead_id: str, body: schemas.QuotationCreate) -> dict:
    lead = leads.get_lead_row(user, lead_id)
    if lead["stage"] in CLOSED:
        raise AppError("This lead is closed.")
    db = get_service_client()
    _check_photo_paths(lead_id, body.packages)
    # No discount on quotations any more: the total is the sum of the requirements.
    subtotal, _discount, total = totals([(p.quantity, p.unit_price) for p in body.packages], Decimal("0"))
    if total <= 0:
        raise AppError("The total must be greater than 0.", {"errors": [{"field": "packages", "message": "Give at least one requirement a rate."}]}, 422)

    latest = db.table("quotations").select("version").eq("lead_id", lead_id).order("version", desc=True).limit(1).execute().data
    version = (latest[0]["version"] if latest else 0) + 1
    status = status_for(user.role, Decimal("0"), Decimal("0"))  # ready (approved for managers): no discount to approve
    try:
        q = (
            db.table("quotations").insert(
                {
                    "lead_id": lead_id, "version": version, "status": status, "template_id": body.template_id or (_template(None) or {}).get("id"),
                    "subtotal": float(subtotal), "discount_pct": 0, "discount_amount": 0, "total": float(total),
                    "notes": body.notes, "created_by": user.id,
                }
            ).execute().data[0]
        )
    except Exception as exc:  # noqa: BLE001 - the unique (lead, version) rule: two people saved at the same moment
        if "duplicate" in str(exc).lower() or "23505" in str(exc):
            raise ConflictError("Someone just saved another version. Open the quotation list again and try once more.") from exc
        raise
    try:
        db.table("quotation_packages").insert([_package_row(q["id"], n, p) for n, p in enumerate(body.packages, 1)]).execute()
    except Exception as exc:  # noqa: BLE001 - never leave a quotation with no lines behind
        db.table("quotations").delete().eq("id", q["id"]).execute()
        if "quotation_packages" in str(exc) and ("does not exist" in str(exc) or "42P01" in str(exc) or "PGRST205" in str(exc)):
            raise AppError(PACKAGES_NOT_READY, status_code=503) from exc
        raise

    note = f"Quotation v{version}: {format_inr(total)}"
    steps = [lambda: add_activity(lead_id, user.id, "quotation", outcome=status, note=note, meta={"quotationId": q["id"], "version": version})]
    if version > 1:
        # On a client project, a revised proposal means the deal is in Negotiation.
        # (On a new-business lead this does nothing: that pipeline has no Negotiation stage.)
        steps.append(lambda: leads.auto_advance(lead, "project_negotiation", user.id, "Revised proposal"))
    par(*steps)
    write_audit(user.id, "create", "quotations", q["id"], {"lead": lead_id, "version": version, "status": status})
    return {**q, "number": quote_number(lead_id, version), "needs_approval": status == "pending_approval"}


def list_quotations(lead_id: str) -> list[dict]:
    db = get_service_client()
    rows = db.table("quotations").select("*, author:profiles!created_by(full_name)").eq("lead_id", lead_id).order("version", desc=True).limit(30).execute().data
    if not rows:
        return []
    ids = [r["id"] for r in rows]
    items, packages = par(
        lambda: db.table("quotation_items").select("*").in_("quotation_id", ids).order("position").execute().data,
        lambda: _packages_for(ids),
    )
    urls = signed_urls(DOCUMENTS, [path for p in packages for path in (p.get("photo_paths") or [])])
    items_by_q: dict[str, list] = {}
    for it in items:
        items_by_q.setdefault(it["quotation_id"], []).append(it)
    packages_by_q: dict[str, list] = {}
    for p in packages:
        packages_by_q.setdefault(p["quotation_id"], []).append(_package_out(p, urls))
    for r in rows:
        r["items"] = items_by_q.get(r["id"], [])  # older quotations made from flat line items
        r["packages"] = packages_by_q.get(r["id"], [])
        r["number"] = quote_number(lead_id, r["version"])
        r.pop("pdf_path", None)
    return rows


def _load(user: Profile, quotation_id: str) -> tuple[dict, dict, list[dict], list[dict]]:
    db = get_service_client()
    rows = db.table("quotations").select("*").eq("id", quotation_id).limit(1).execute().data
    if not rows:
        raise NotFoundError("Quotation not found.")
    q = rows[0]
    lead = leads.get_lead_row(user, q["lead_id"])  # also checks the user may see this lead
    items, packages = par(
        lambda: db.table("quotation_items").select("*").eq("quotation_id", quotation_id).order("position").execute().data,
        lambda: _packages_for([quotation_id]),
    )
    return q, lead, items, packages


def make_pdf(user: Profile, quotation_id: str) -> tuple[bytes, str]:
    q, lead, items, packages = _load(user, quotation_id)
    number = quote_number(q["lead_id"], q["version"])
    created = datetime.fromisoformat(q["created_at"]).astimezone(IST).date()
    data = pdf.render(
        number=number, created=created, lead=lead, items=items, packages=packages, photos=_photo_bytes(packages), subtotal=q["subtotal"], discount_pct=q["discount_pct"],
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
    q, lead, _items, _packages = _load(user, quotation_id)
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
            "<p>Reply to this email with any questions.</p>",
            [(f"{number}.pdf", data)],
        )
    else:
        text = f"Hello {contact['name']}, here is our quotation {number} for {company}. Total: {total}.\nView or download: {link}"
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
