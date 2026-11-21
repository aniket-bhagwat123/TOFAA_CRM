"""Single place that writes to a lead's timeline (call, WhatsApp, meeting, note, stage change ...)."""
from src.core.dates import now_ist
from src.core.parallel import par
from src.core.supabase import get_service_client


def add_activity(
    lead_id: str,
    actor_id: str | None,
    kind: str,
    outcome: str | None = None,
    note: str | None = None,
    meta: dict | None = None,
) -> dict:
    db = get_service_client()
    # The two writes do not depend on each other, so they share one round trip.
    row, _ = par(
        lambda: db.table("activities")
        .insert({"lead_id": lead_id, "actor_id": actor_id, "kind": kind, "outcome": outcome, "note": note, "meta": meta or {}})
        .execute()
        .data[0],
        lambda: db.table("leads").update({"last_activity_at": now_ist().isoformat()}).eq("id", lead_id).execute(),
    )
    return row


def add_company_activity(
    company_id: str, actor_id: str | None, kind: str, outcome: str | None = None, note: str | None = None, meta: dict | None = None
) -> dict:
    """A timeline entry that belongs to a client rather than one deal (an occasion call, a new contact ...)."""
    return (
        get_service_client().table("activities")
        .insert({"lead_id": None, "company_id": company_id, "actor_id": actor_id, "kind": kind, "outcome": outcome, "note": note, "meta": meta or {}})
        .execute()
        .data[0]
    )
