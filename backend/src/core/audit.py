import logging

from src.core.parallel import bg
from src.core.supabase import get_service_client

log = logging.getLogger(__name__)


def _write(actor_id: str, action: str, entity: str, entity_id: str | None, details: dict | None) -> None:
    get_service_client().table("audit_log").insert(
        {"actor_id": actor_id or None, "action": action, "entity": entity, "entity_id": entity_id, "details": details or {}}
    ).execute()


def write_audit(actor_id: str, action: str, entity: str, entity_id: str | None, details: dict | None = None) -> None:
    """Runs in the background: the audit trail is complete but never makes the user wait for it."""
    bg(_write, actor_id, action, entity, entity_id, details)
