import logging

from src.core.supabase import get_service_client

log = logging.getLogger(__name__)


def record_activity(actor_id: str, kind: str, summary: str, ref_id: str | None = None) -> None:
    """Best-effort write to the activity feed."""
    try:
        get_service_client().table("activity_feed").insert(
            {"actor_id": actor_id, "kind": kind, "summary": summary, "ref_id": ref_id}
        ).execute()
    except Exception:  # noqa: BLE001 - never fail a request over feed logging
        log.exception("activity write failed")
