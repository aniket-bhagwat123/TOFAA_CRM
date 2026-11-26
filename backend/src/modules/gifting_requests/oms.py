"""The Order Management System link. The contract is described in GIFTING_INTEGRATION.md.

CRM -> OMS:  POST {OMS_API_URL}/gift-orders  (X-API-Key, Idempotency-Key = gift request id)  -> {"reference": "..."}
OMS -> CRM:  POST /api/v1/integrations/oms/status, signed with OMS_WEBHOOK_SECRET (X-OMS-Signature: sha256=<hex>)
"""
import hashlib
import hmac
import logging
from typing import Any

import httpx

from src.core.config import settings
from src.core.errors import AppError

log = logging.getLogger(__name__)
TIMEOUT_SECONDS = 20
SYSTEM_ACTOR = "00000000-0000-4000-8000-0000000000a5"  # "OMS" in the Gifting OS history
FAILED = "OMS did not accept the order, so nothing was changed. Try again in a moment."
# For each status OMS may report: the steps still needed from where the request is now, in order.
STEPS = {
    "DISPATCHED": {"IN_PROGRESS": ["dispatch"], "DISPATCHED": [], "DELIVERED": []},
    "DELIVERED": {"IN_PROGRESS": ["dispatch", "deliver"], "DISPATCHED": ["deliver"], "DELIVERED": []},
}


def configured() -> bool:
    return bool(settings.OMS_API_URL.strip() and settings.OMS_API_KEY)


def order_body(r: dict[str, Any], sent_by: str) -> dict[str, Any]:
    options = (r.get("proposal") or {}).get("options") or []
    index = r.get("selectedOptionIndex")
    if isinstance(index, int) and 0 <= index < len(options):
        chosen = options[index]
    else:
        chosen = options[0] if len(options) == 1 else None
    return {
        "requestId": r["id"], "requestCode": r.get("requestCode"), "title": r.get("title"),
        "client": {"accountId": r.get("accountId"), "name": r.get("accountName")},
        "recipient": {"name": r.get("recipientName"), "mobile": r.get("recipientMobile")},
        "occasion": r.get("eventName") or r.get("occasionName"),
        "deliveryDate": r.get("deliveryDate"), "deliveryAddress": r.get("deliveryAddress"),
        "budget": r.get("requestedBudget") or r.get("budgetMax"), "chosenOption": chosen,
        "message": r.get("message"), "specialInstructions": r.get("specialInstructions"), "sentBy": sent_by,
    }


def send(request: dict[str, Any], *, sent_by: str) -> str:
    """Hand a confirmed request to OMS and return its order reference."""
    try:
        res = httpx.post(
            settings.OMS_API_URL.rstrip("/") + "/gift-orders", json=order_body(request, sent_by),
            headers={"X-API-Key": settings.OMS_API_KEY, "Idempotency-Key": str(request["id"])},
            timeout=TIMEOUT_SECONDS, follow_redirects=False,
        )
        res.raise_for_status()
        reference = str(res.json()["reference"] or "").strip()[:100]
        if not reference:
            raise ValueError("empty reference")
        return reference
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        log.warning("OMS order failed for %s: %s", request.get("id"), type(exc).__name__)
        raise AppError(FAILED, status_code=502) from exc


def valid_signature(raw: bytes, header: str | None) -> bool:
    """With no secret configured nothing is accepted."""
    if not settings.OMS_WEBHOOK_SECRET or not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(settings.OMS_WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected.encode(), header[len("sha256="):].encode())
