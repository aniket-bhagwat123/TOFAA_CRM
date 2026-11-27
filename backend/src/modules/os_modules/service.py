"""Home, Gift Calendar, Gift Ideas, Events and Activity of a client, read from and changed in TOFAA Gifting OS (where
the data lives), for KAMs, sales managers and admins.

The CRM decides which client the person may work with (a KAM their own); only that client's Gifting OS id is sent.
"""
import logging
from typing import Any

import httpx

from src.core.config import settings
from src.core.errors import AppError, ConflictError, ForbiddenError
from src.modules.auth.schemas import Profile, Role
from src.modules.gifting_requests import service as gifting
from src.modules.gifting_requests.clients import _tenant_of
from src.modules.os_modules import combined
from src.modules.people.service import client_account, require_role

log = logging.getLogger(__name__)
BASE = "/api/v1/integrations/crm/modules"
PASS_THROUGH = (403, 404, 409, 422)  # Gifting OS refusals a person can act on


def _call(method: str, path: str, *, params: dict | None = None, body: dict | None = None) -> Any:
    if not settings.GIFTING_OS_API_URL or len(settings.GIFTING_OS_API_KEY) < 32:
        raise AppError(gifting.NOT_CONNECTED, status_code=503)
    try:
        res = httpx.request(
            method, settings.GIFTING_OS_API_URL.rstrip("/") + BASE + path,
            params={k: v for k, v in (params or {}).items() if v not in (None, "")}, json=body,
            headers={"X-API-Key": settings.GIFTING_OS_API_KEY}, timeout=gifting.TIMEOUT_SECONDS, follow_redirects=False,
        )
        if res.status_code in PASS_THROUGH:
            message = res.json().get("message")
            raise AppError(message if isinstance(message, str) and message else gifting.UNREACHABLE, status_code=res.status_code)
        res.raise_for_status()
        return res.json()["data"]
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        log.warning("Gifting OS module call failed: %s %s", method, type(exc).__name__)
        raise AppError(gifting.UNREACHABLE, status_code=502) from exc


def tenant_for(user: Profile, company_id: str) -> str:
    client_account(user, company_id)  # role and ownership, before anything leaves the CRM
    tenant = _tenant_of(company_id)
    if not tenant:
        raise ConflictError("This client is not set up in Gifting OS yet.")
    return tenant


ALL = "all"  # every client the person may see, put together (lists only)


def read(user: Profile, company_id: str, what: str, params: dict | None = None) -> Any:
    if company_id == ALL:
        linked = gifting.accounts(user)  # role checked; a KAM only their own clients
        data = combined.read(linked, what, lambda tenant, query: _call("GET", f"/{tenant}/{what}", params=query), params or {})
    else:
        data = _call("GET", f"/{tenant_for(user, company_id)}/{what}", params=params)
    # Whether this person may change things: Gifting OS's switch, and the CRM's pilot list.
    if isinstance(data, dict) and "actionsEnabled" in data:
        data["actionsEnabled"] = bool(data["actionsEnabled"]) and gifting.may_act(user)
    return data


def gift_ideas(user: Profile, page: int, limit: int, search: str | None) -> Any:
    require_role(user)
    admin = user.role == Role.ADMIN
    data = _call("GET", "/gift-ideas", params={"page": page, "limit": limit, "search": search, "includeHidden": admin or None})
    # Whether this person may add, change and delete ideas.
    data["actionsEnabled"] = admin and bool(data.get("actionsEnabled")) and gifting.may_act(user)
    return data


def write_idea(user: Profile, method: str, idea_id: str | None = None, payload: dict | None = None) -> Any:
    """Gift ideas show to every client, so only an admin changes them (Gifting OS: only its super admin)."""
    if user.role != Role.ADMIN:
        raise ForbiddenError("Only an admin manages gift ideas.")
    gifting.require_may_act(user)
    path = f"/gift-ideas/{idea_id}" if idea_id else "/gift-ideas"
    actor = {"actorId": user.id, "actorName": (user.full_name or "TOFAA team")[:100]}
    if method == "DELETE":
        return _call(method, path, params=actor)
    return _call(method, path, body={**(payload or {}), **actor})


def write(user: Profile, company_id: str, method: str, what: str, payload: dict | None = None) -> Any:
    gifting.require_may_act(user)
    path = f"/{tenant_for(user, company_id)}/{what}"
    actor = {"actorId": user.id, "actorName": (user.full_name or "TOFAA team")[:100]}
    if method == "DELETE":
        return _call(method, path, params=actor)
    return _call(method, path, body={**(payload or {}), **actor})
