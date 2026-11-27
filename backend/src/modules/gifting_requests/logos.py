"""What Gifting OS holds about each linked client that the CRM's client screens show: its logo, and whether it is
switched on there."""
import logging

import httpx

from src.core import cache
from src.core.config import settings
from src.core.supabase import get_service_client

log = logging.getLogger(__name__)
PATH = "/api/v1/integrations/crm/clients/list"
TIMEOUT_SECONDS = 4  # a slow Gifting OS must not hold up the client screens
KEEP_SECONDS = 60


def by_company() -> dict[str, dict]:
    """CRM account id -> {logo_url, active} for linked clients. Empty when Gifting OS cannot be asked."""

    def load() -> dict[str, dict]:
        if not settings.GIFTING_OS_API_URL or len(settings.GIFTING_OS_API_KEY) < 32:
            return {}
        try:
            res = httpx.post(settings.GIFTING_OS_API_URL.rstrip("/") + PATH, json={},
                             headers={"X-API-Key": settings.GIFTING_OS_API_KEY}, timeout=TIMEOUT_SECONDS, follow_redirects=False)
            res.raise_for_status()
            found = {str(t["id"]): t for t in res.json()["data"]["items"]}
            if not found:
                return {}
            rows = get_service_client().table("companies").select("id,gifting_tenant_id").in_("gifting_tenant_id", list(found)).limit(1000).execute().data
            out = {}
            for row in rows:
                tenant = found[str(row["gifting_tenant_id"])]
                logo = str(tenant.get("logo_url") or "")
                out[row["id"]] = {"logo_url": logo if logo.startswith("http") else None, "active": tenant.get("status") != "DEACTIVATED"}
            return out
        except Exception as exc:  # noqa: BLE001 - a logo is never worth failing a screen for
            log.warning("client details from Gifting OS unavailable: %s", type(exc).__name__)
            return {}

    return cache.reference("gifting-logos", "all", KEEP_SECONDS, load)


def fields(found: dict[str, dict], company_id: str) -> dict:
    info = found.get(company_id) or {}
    return {"logo_url": info.get("logo_url"), "gifting_inactive": info.get("active") is False}


def forget() -> None:
    cache.invalidate_reference("gifting-logos", "all")
