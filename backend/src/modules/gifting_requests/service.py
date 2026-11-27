"""Gift requests of the KAM's clients, read from and handled in TOFAA Gifting OS (where they live). KAM and admin.

Which clients someone may see is decided here, with the same rule as People: an admin sees every linked client
account, a KAM only the accounts they own. Only those Gifting OS client ids are ever sent to Gifting OS.
"""
import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from src.core.config import settings
from src.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from src.core.soft_delete import live
from src.core.supabase import get_service_client
from src.modules.auth.schemas import Profile, Role
from src.modules.gifting_requests import oms
from src.modules.people.service import company_scope

log = logging.getLogger(__name__)
PATH = "/api/v1/integrations/crm/gift-requests"
PLANNING = "/api/v1/integrations/crm/planning"
TIMEOUT_SECONDS = 20
NOT_CONNECTED = "The Gifting OS connection is not set up (GIFTING_OS_API_URL / GIFTING_OS_API_KEY)."
UNREACHABLE = "Gifting OS could not be reached. Try again in a moment."
PASS_THROUGH = {403, 404, 409, 422}  # Gifting OS refusals the person should read as they are
ALERT_DAYS = 3  # only requests submitted this recently raise an alert


def may_act(user: Profile) -> bool:
    """During a pilot only the listed people may change anything."""
    pilot = {e.strip().lower() for e in settings.GIFTING_PILOT_EMAILS.split(",") if e.strip()}
    return not pilot or (getattr(user, "email", None) or "").lower() in pilot


def require_may_act(user: Profile) -> None:
    if not may_act(user):
        raise ForbiddenError("Changes from the CRM are in a pilot, and your account is not part of it yet.")


def accounts(user: Profile) -> dict[str, dict[str, str]]:
    """Gifting OS client id -> CRM account, for the linked accounts this person may see."""
    scope = company_scope(user)  # refuses every role except KAM and admin
    if scope is not None and not scope:
        return {}
    q = get_service_client().table("companies").select("id,name,gifting_tenant_id").not_.is_("gifting_tenant_id", "null")
    q = live(q, "companies")
    if scope is not None:
        q = q.in_("id", scope)
    return {str(c["gifting_tenant_id"]): {"id": c["id"], "name": c["name"]} for c in q.order("name").limit(300).execute().data}


def _call(path: str, body: dict[str, Any], base: str = PATH) -> dict[str, Any]:
    if not settings.GIFTING_OS_API_URL or len(settings.GIFTING_OS_API_KEY) < 32:
        raise AppError(NOT_CONNECTED, status_code=503)
    try:
        res = httpx.post(settings.GIFTING_OS_API_URL.rstrip("/") + base + path, json=body,
                         headers={"X-API-Key": settings.GIFTING_OS_API_KEY}, timeout=TIMEOUT_SECONDS, follow_redirects=False)
        if res.status_code == 404 and base == PATH and path != "/search":
            raise NotFoundError("Gift request not found.")
        if res.status_code in PASS_THROUGH:
            raise AppError(str(res.json().get("message") or UNREACHABLE), status_code=res.status_code)
        res.raise_for_status()
        return res.json()["data"]
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        log.warning("Gifting OS gift request call failed: %s", type(exc).__name__)
        raise AppError(UNREACHABLE, status_code=502) from exc


def _named(item: dict, linked: dict) -> dict:
    account = linked.get(str(item.get("tenantId"))) or {}
    return {**item, "accountId": account.get("id"), "accountName": account.get("name")}


def search(user: Profile, *, company_id: str | None, status: str | None, search: str | None, page: int, limit: int) -> dict:
    linked = accounts(user)
    choices = [a for a in linked.values()]
    wanted = [t for t, a in linked.items() if not company_id or a["id"] == company_id]
    if company_id and not wanted:
        raise NotFoundError("Client not found.")
    if not wanted:
        return {"items": [], "total": 0, "page": page, "limit": limit, "counts": [], "accounts": choices}
    data = _call("/search", {"tenantIds": wanted, "status": status, "search": search, "page": page, "limit": limit})
    return {**data, "items": [_named(i, linked) for i in data["items"]], "accounts": choices}


def _shaped(user: Profile, data: dict, linked: dict) -> dict:
    """A request as the CRM shows it: its account, this person's allowed steps, and the OMS step when OMS is set up."""
    out = {**data, "request": _named(data["request"], linked), "omsEnabled": oms.configured()}
    if not may_act(user):
        out.update(actionsEnabled=False, allowedActions=[], pilotOnly=True)
    elif oms.configured():
        out["allowedActions"] = ["send_to_oms" if a == "start_fulfilment" else a for a in data.get("allowedActions", [])]
    return out


def detail(user: Profile, request_id: str) -> dict:
    linked = accounts(user)
    if not linked:
        raise NotFoundError("Gift request not found.")
    return _shaped(user, _call(f"/{request_id}", {"tenantIds": list(linked)}), linked)


def act(user: Profile, request_id: str, action: str, note: str | None, proposal: dict | None) -> dict:
    require_may_act(user)
    linked = accounts(user)
    if not linked:
        raise NotFoundError("Gift request not found.")
    if action == "send_to_oms":
        if not oms.configured():
            raise ConflictError("OMS is not connected yet.")
        current = _call(f"/{request_id}", {"tenantIds": list(linked)})
        if "start_fulfilment" not in current.get("allowedActions", []):  # not confirmed, or changes are switched off
            raise ConflictError("Only a confirmed request can be sent to OMS.")
        reference = oms.send(_named(current["request"], linked), sent_by=user.full_name or "TOFAA team")
        # If the update below fails the person can send again: OMS knows the request and makes no second order.
        action, note = "start_fulfilment", f"Sent to OMS (reference {reference})"
    elif action == "start_fulfilment" and oms.configured():
        raise ConflictError("Send this request to OMS instead.")
    data = _call(f"/{request_id}/actions", {
        "tenantIds": list(linked), "action": action, "note": note, "proposal": proposal,
        "actorId": user.id, "actorName": (user.full_name or "TOFAA team")[:100],
    })
    return _shaped(user, data, linked)


def raise_alerts(user: Profile) -> int:
    """A bell alert for each recently submitted request of this KAM's clients (once per request and submission)."""
    from src.modules.notifications.service import notify  # that module calls this one

    found = search(user, company_id=None, status="SUBMITTED", search=None, page=1, limit=50)
    since = datetime.now(timezone.utc) - timedelta(days=ALERT_DAYS)
    raised = 0
    for r in found["items"]:
        at = datetime.fromisoformat(str(r["updatedAt"]).replace("Z", "+00:00"))
        if at < since:
            continue
        notify(user.id, f"giftreq:{r['id']}:{r['updatedAt']}", "New gift request",
               f"{r.get('accountName') or 'A client'}: {r['title']}", f"/gifting-requests?open={r['id']}")
        raised += 1
    return raised


def raise_alerts_in_background(user: Profile) -> None:
    """The notification poll never waits for Gifting OS, and works when it is down."""
    if user.role != Role.KAM or not settings.GIFTING_OS_API_URL:
        return

    def run() -> None:
        try:
            raise_alerts(user)
        except Exception as exc:  # noqa: BLE001 - the next poll tries again
            log.warning("gift request alerts failed: %s", type(exc).__name__)

    threading.Thread(target=run, name="gift-request-alerts", daemon=True).start()


# --- occasions, events and new requests -------------------------------------------------------------------------------

def _client(user: Profile, company_id: str) -> dict[str, Any]:
    """The Gifting OS client behind this CRM account, if the person may work on it."""
    linked = accounts(user)
    tenant = next((t for t, a in linked.items() if a["id"] == company_id), None)
    if not tenant:
        raise NotFoundError("Client not found, or it is not linked to Gifting OS.")
    return {"tenantIds": [tenant], "tenantId": tenant}


def _writer(user: Profile, company_id: str) -> dict[str, Any]:
    require_may_act(user)
    return {**_client(user, company_id), "actorId": user.id, "actorName": (user.full_name or "TOFAA team")[:100]}


def planning_accounts(user: Profile) -> list[dict[str, str]]:
    return list(accounts(user).values())


def options(user: Profile, company_id: str, recipient_id: str | None) -> dict:
    data = _call("/options", {**_client(user, company_id), "recipientId": recipient_id}, PLANNING)
    return data if may_act(user) else {**data, "actionsEnabled": False}


def create_occasion(user: Profile, company_id: str, occasion: dict) -> dict:
    return _call("/occasions", {**_writer(user, company_id), "occasion": occasion}, PLANNING)


def create_event(user: Profile, company_id: str, recipient_id: str, event: dict) -> dict:
    return _call("/events", {**_writer(user, company_id), "recipientId": recipient_id, "event": event}, PLANNING)


def create_request(user: Profile, company_id: str, request: dict) -> dict:
    if user.role == Role.KAM:
        raise ForbiddenError("A Key Account Manager cannot create gift requests. Ask a sales manager or an admin.")
    return _call("/gift-requests", {**_writer(user, company_id), "request": request}, PLANNING)


def apply_oms_status(request_id: str, status: str, reference: str | None) -> dict:
    """A signed status update from OMS. Repeats are harmless; a missed "dispatched" is filled in before "delivered"."""
    q = get_service_client().table("companies").select("gifting_tenant_id").not_.is_("gifting_tenant_id", "null")
    scope = {"tenantIds": [str(r["gifting_tenant_id"]) for r in q.limit(300).execute().data]}
    current = _call(f"/{request_id}", scope)["request"]["status"]
    steps = oms.STEPS[status].get(current)
    if steps is None:
        raise ConflictError(f"The request is {current}, so it cannot be marked {status}.")
    note = f"From OMS (reference {reference})" if reference else "From OMS"
    for action in steps:
        _call(f"/{request_id}/actions", {**scope, "action": action, "note": note, "proposal": None,
                                         "actorId": oms.SYSTEM_ACTOR, "actorName": "OMS"})
    return {"requestId": request_id, "status": status if steps else current, "changed": bool(steps)}
