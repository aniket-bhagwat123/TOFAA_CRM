"""WhatsApp: Business Cloud API when configured, click-to-chat fallback until Meta approves.

One company number. Every message is saved against the lead and its company, so the history stays
with the company if a KAM leaves.
"""
import hashlib
import hmac
import logging
from datetime import datetime, timedelta
from urllib.parse import quote

import httpx

from src.core import cache
from src.core.config import settings
from src.core.dates import now_ist
from src.core.errors import AppError, ForbiddenError, NotFoundError
from src.core.keys import phone_key
from src.core.supabase import get_service_client
from src.core.timeline import add_activity
from src.core.soft_delete import live
from src.modules.auth.schemas import Profile, Role
from src.modules.auth.service import normalize_identifier
from src.modules.leads import service as leads
from src.modules.leads.stages import CLOSED
from src.modules.notifications.service import notify
from src.modules.whatsapp.schemas import SendMessage, TemplateCreate, TemplateUpdate

log = logging.getLogger(__name__)
GRAPH = "https://graph.facebook.com/v20.0"


def api_enabled() -> bool:
    return bool(settings.WHATSAPP_TOKEN and settings.WHATSAPP_PHONE_NUMBER_ID)


def _digits(phone: str) -> str:
    _, e164 = normalize_identifier(phone)
    return e164.lstrip("+")


def _last_inbound(lead_id: str) -> datetime | None:
    rows = (
        get_service_client().table("whatsapp_messages").select("created_at").eq("lead_id", lead_id).eq("direction", "in")
        .order("created_at", desc=True).limit(1).execute().data
    )
    return datetime.fromisoformat(rows[0]["created_at"]) if rows else None


def _auth() -> dict:
    return {"Authorization": f"Bearer {settings.WHATSAPP_TOKEN}"}


def _post_message(to_digits: str, payload: dict) -> str:
    """One message through the Cloud API. Returns WhatsApp's message id."""
    try:
        res = httpx.post(
            f"{GRAPH}/{settings.WHATSAPP_PHONE_NUMBER_ID}/messages", headers=_auth(),
            json={"messaging_product": "whatsapp", "to": to_digits, **payload}, timeout=20,
        )
    except httpx.HTTPError as exc:
        raise AppError("Could not reach WhatsApp. Try again.", status_code=502) from exc
    if res.status_code >= 400:
        log.warning("whatsapp send failed: %s %s", res.status_code, res.text[:300])
        raise AppError("WhatsApp rejected the message. Check the number or use an approved template.", status_code=502)
    return (res.json().get("messages") or [{}])[0].get("id", "")


def _send_via_api(to_digits: str, body: SendMessage) -> str:
    if body.template:
        payload = {"type": "template", "template": {"name": body.template, "language": {"code": settings.WHATSAPP_TEMPLATE_LANGUAGE or "en"}}}
    else:
        payload = {"type": "text", "text": {"body": body.body}}
    return _post_message(to_digits, payload)


# --- a message with a "View quotation" button -------------------------------------------------------------------

LINK_BUTTON = "View quotation"


def quotation_text(name: str, number: str, company: str, total: str) -> str:
    """The quotation message. The same words as the approved template, so the client sees one message either way."""
    return (
        f"Hello {name},\n\nThank you for your interest in {settings.COMPANY_NAME}. Your quotation {number} for {company} is ready.\n"
        f"Total: {total}\n\nTap the button below to view or download it."
    )


def link_payload(text: str, link: str, *, in_window: bool, template: str, language: str, values: list[str], base: str) -> dict:
    """The message with a button that opens the link.
    Inside the 24-hour window: an interactive message (any text, any link) with a "View quotation" button.
    Outside it Meta only allows an approved template: the same text from the body values, and the template's URL button
    ("https://<crm>/s/{{1}}") gets the link's code."""
    if in_window:
        return {"type": "interactive", "interactive": {
            "type": "cta_url", "body": {"text": text[:1024]},
            "action": {"name": "cta_url", "parameters": {"display_text": LINK_BUTTON, "url": link}},
        }}
    code = link[len(base):] if base and link.startswith(base) else ""
    if not template or not code:
        raise AppError("Outside the 24-hour window WhatsApp needs the approved quotation template.", {"code": "template_required"}, 422)
    return {"type": "template", "template": {"name": template, "language": {"code": language or "en"}, "components": [
        {"type": "body", "parameters": [{"type": "text", "text": (v or "-")[:1000]} for v in values]},
        {"type": "button", "sub_type": "url", "index": "0", "parameters": [{"type": "text", "text": code}]},
    ]}}


def send_link_message(user: Profile, lead_id: str, *, text: str, link: str, values: list[str], base: str) -> dict:
    """Send the message with its "View quotation" button from the company number. Saved to the lead's history.
    Raises AppError(code=template_required) when the window is closed and the template is not set up, so the caller
    can fall back to click-to-chat."""
    lead = leads.get_lead_row(user, lead_id)
    phone = (lead.get("contact") or {}).get("phone")
    if not phone:
        raise AppError("This contact has no phone number.", status_code=422)
    to = _digits(phone)
    last = _last_inbound(lead_id)
    in_window = bool(last and now_ist() - last <= timedelta(hours=24))
    template = settings.WHATSAPP_QUOTATION_TEMPLATE
    payload = link_payload(text, link, in_window=in_window, template=template, language=settings.WHATSAPP_TEMPLATE_LANGUAGE, values=values, base=base)
    provider_id = _post_message(to, payload)
    get_service_client().table("whatsapp_messages").insert(
        {"lead_id": lead_id, "company_id": lead["company_id"], "direction": "out", "mode": "api", "phone": to,
         "body": f"{text}\n[{LINK_BUTTON}: {link}]", "template": None if in_window else template, "provider_id": provider_id,
         "sent_by": user.id, "status": "sent"}
    ).execute()
    add_activity(lead_id, user.id, "whatsapp", outcome="sent", note=text, meta={"direction": "out", "mode": "api", "link": link})
    return {"mode": "api", "url": None, "button": True}


def send(user: Profile, lead_id: str, body: SendMessage, *, force_click: bool = False) -> dict:
    lead = leads.get_lead_row(user, lead_id)
    phone = (lead.get("contact") or {}).get("phone")
    if not phone:
        raise AppError("This contact has no phone number.", status_code=422)
    to = _digits(phone)

    mode, provider_id, url = "click_to_chat", None, None
    if api_enabled() and not force_click:
        mode = "api"
        approved = None
        if body.template:
            approved = (
                get_service_client().table("whatsapp_templates").select("approved").eq("name", body.template).limit(1).execute().data
            )
            if not approved or not approved[0]["approved"]:
                raise AppError("That template is not approved by Meta yet.", status_code=422)
        else:  # free text only inside the 24-hour window after the client last wrote
            last = _last_inbound(lead_id)
            if not last or now_ist() - last > timedelta(hours=24):
                raise AppError("The 24-hour window is closed. Send an approved template instead.", {"code": "template_required"}, 422)
        provider_id = _send_via_api(to, body)
    else:
        url = f"https://wa.me/{to}?text={quote(body.body)}"

    db = get_service_client()
    db.table("whatsapp_messages").insert(
        {
            "lead_id": lead_id, "company_id": lead["company_id"], "direction": "out", "mode": mode, "phone": to,
            "body": body.body, "template": body.template, "provider_id": provider_id, "sent_by": user.id,
            "status": "sent",
        }
    ).execute()
    add_activity(lead_id, user.id, "whatsapp", outcome="sent", note=body.body, meta={"direction": "out", "mode": mode})
    return {"mode": mode, "url": url}


def conversation(user: Profile, lead_id: str) -> list[dict]:
    leads.get_lead_row(user, lead_id)
    return (
        get_service_client().table("whatsapp_messages").select("*").eq("lead_id", lead_id)
        .order("created_at").limit(200).execute().data
    )


# --- webhook ------------------------------------------------------------------------------------------

def verify_webhook(mode: str | None, token: str | None, challenge: str | None) -> str:
    if mode == "subscribe" and settings.WHATSAPP_VERIFY_TOKEN and hmac.compare_digest(token or "", settings.WHATSAPP_VERIFY_TOKEN):
        return challenge or ""
    raise ForbiddenError("Verification failed.")


def valid_signature(raw: bytes, header: str | None) -> bool:
    """Meta signs each webhook call with the app secret. Without a secret we accept nothing."""
    if not settings.WHATSAPP_APP_SECRET or not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(settings.WHATSAPP_APP_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header[len("sha256="):])


def handle_webhook(payload: dict) -> None:
    db = get_service_client()
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            for st in value.get("statuses", []):
                db.table("whatsapp_messages").update({"status": st.get("status", "sent")}).eq("provider_id", st.get("id")).execute()
            for msg in value.get("messages", []):
                _store_inbound(msg)


def _store_inbound(msg: dict) -> None:
    db = get_service_client()
    provider_id = msg.get("id")
    if provider_id and db.table("whatsapp_messages").select("id").eq("provider_id", provider_id).limit(1).execute().data:
        return  # Meta retries deliveries
    sender = msg.get("from", "")
    text = (msg.get("text") or {}).get("body") or f"[{msg.get('type', 'message')}]"
    key = phone_key(sender)
    contacts = db.table("contacts").select("id,company_id").eq("phone_key", key).execute().data if key else []
    lead = None
    if contacts:
        rows = (
            live(db.table("leads").select("*")).in_("contact_id", [c["id"] for c in contacts])
            .not_.in_("stage", list(CLOSED)).order("last_activity_at", desc=True).limit(1).execute().data
        )
        lead = rows[0] if rows else None
    db.table("whatsapp_messages").insert(
        {
            "lead_id": lead["id"] if lead else None, "company_id": lead["company_id"] if lead else None,
            "direction": "in", "mode": "api", "phone": sender, "body": text, "provider_id": provider_id, "status": "received",
        }
    ).execute()
    if not lead:
        return
    add_activity(lead["id"], None, "whatsapp", outcome="received", note=text, meta={"direction": "in"})
    leads.auto_advance(lead, "connected", None, "WhatsApp reply received")
    if lead.get("owner_id"):
        notify(lead["owner_id"], f"wa:{provider_id}", "New WhatsApp reply", text[:120], f"/leads/{lead['id']}")


# --- templates & usage (admin) ---------------------------------------------------------------------------

def list_templates() -> list[dict]:
    return cache.reference("wa", "templates", 300, _load_templates)


def _load_templates() -> list[dict]:
    return get_service_client().table("whatsapp_templates").select("*").order("purpose").execute().data


def create_template(body: TemplateCreate) -> dict:
    row = get_service_client().table("whatsapp_templates").insert(body.model_dump()).execute().data[0]
    cache.invalidate_reference("wa")
    return row


def update_template(template_id: str, body: TemplateUpdate) -> dict:
    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise AppError("Nothing to update.")
    res = get_service_client().table("whatsapp_templates").update(patch).eq("id", template_id).execute()
    if not res.data:
        raise NotFoundError("Template not found.")
    cache.invalidate_reference("wa")
    return res.data[0]


def usage(user: Profile) -> dict:
    """Conversations and estimated cost for the current month. A conversation = one client per day."""
    if user.role != Role.ADMIN:
        raise ForbiddenError()
    start = now_ist().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    rows = (
        get_service_client().table("whatsapp_messages").select("direction,mode,phone,created_at,sent_by")
        .gte("created_at", start.isoformat()).limit(10000).execute().data
    )
    api = [r for r in rows if r["mode"] == "api"]
    conversations = {(r["phone"], r["created_at"][:10]) for r in api}
    return {
        "month": start.strftime("%Y-%m"),
        "apiEnabled": api_enabled(),
        "messagesOut": sum(1 for r in api if r["direction"] == "out"),
        "messagesIn": sum(1 for r in api if r["direction"] == "in"),
        "clickToChatSent": sum(1 for r in rows if r["mode"] == "click_to_chat"),
        "conversations": len(conversations),
        "estimatedCost": round(len(conversations) * settings.WHATSAPP_COST_PER_CONVERSATION, 2),
    }
