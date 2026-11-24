"""Settings admins change in Settings: retry rules, Nurture days, stuck-deal days, lost reasons and lead sources.
Each has a default, so the app works before anything is saved (and before migration 20260114000000_menu_v2.sql)."""
import logging
from typing import Any

from src.core import cache
from src.core.supabase import get_service_client

log = logging.getLogger(__name__)

DEFAULTS: dict[str, Any] = {
    "retry": {"maxAttempts": 5, "gapDays": 1},  # after maxAttempts "Not reachable" calls a lead is Cold; gapDays to the next try
    "nurtureDays": 30,                          # a "Future requirement" lead comes back after this many days
    "stuckDays": 14,                            # an open deal with no progress for this long shows as stuck on the Dashboard
    "lostReasons": ["Price too high", "Chose competitor", "No budget", "No response", "Not a fit", "Postponed", "Invalid contact", "Other"],
    "sources": ["Referral", "Website", "Instagram", "LinkedIn", "Cold call", "Exhibition", "WhatsApp", "Existing client", "Other"],
}


def all_settings() -> dict[str, Any]:
    """Every setting, saved value over default. Cached for a minute; saving clears it."""

    def load() -> dict[str, Any]:
        out = {k: (dict(v) if isinstance(v, dict) else list(v) if isinstance(v, list) else v) for k, v in DEFAULTS.items()}
        try:
            for row in get_service_client().table("app_settings").select("key,value").execute().data:
                if row["key"] in DEFAULTS:
                    out[row["key"]] = row["value"]
        except Exception:  # noqa: BLE001 - before the migration: defaults
            log.warning("app_settings not readable; using defaults", exc_info=True)
        return out

    return cache.reference("app-settings", "all", 60, load)


def get(key: str) -> Any:
    return all_settings().get(key, DEFAULTS.get(key))


def lost_reasons() -> list[str]:
    return list(get("lostReasons") or DEFAULTS["lostReasons"])


def sources() -> list[str]:
    return list(get("sources") or DEFAULTS["sources"])


def save(values: dict[str, Any], user_id: str) -> dict[str, Any]:
    rows = [{"key": k, "value": v, "updated_by": user_id} for k, v in values.items() if k in DEFAULTS]
    if rows:
        get_service_client().table("app_settings").upsert(rows, on_conflict="key").execute()
    cache.invalidate_reference("app-settings")
    cache.invalidate_reference("stages", "meta")  # the lead forms read sources, reasons and rules from there
    return all_settings()
