"""Soft delete for leads and companies (migration 20260119000000_soft_delete.sql).

A deleted row keeps its data (deleted_at, deleted_by) and is hidden everywhere. Every list, count and duplicate check
reads live rows through `live()`. Until the migration is applied the columns do not exist: then nothing is filtered
(nothing can have been deleted yet) and deleting asks for the migration, so the app keeps working either way.
"""
import logging

from src.core import cache
from src.core.errors import AppError
from src.core.supabase import get_service_client

log = logging.getLogger(__name__)
CHECK_EVERY = 300  # seconds; re-checked so the app notices the migration without a restart
NOT_READY = "Deleting is not set up yet. An admin needs to apply the database migration 20260119000000_soft_delete.sql, then try again."


def ready(table: str) -> bool:
    """True when `table` has the soft-delete columns."""

    def check() -> bool:
        try:
            get_service_client().table(table).select("deleted_at").limit(1).execute()
            return True
        except Exception:  # noqa: BLE001 - the column is missing before the migration
            log.info("%s.deleted_at not available yet (migration 20260119000000_soft_delete.sql)", table)
            return False

    return cache.reference("soft-delete-ready", table, CHECK_EVERY, check)


def live(q, table: str = "leads"):
    """Only rows that are not deleted (a no-op before the migration)."""
    return q.is_("deleted_at", "null") if ready(table) else q


def require_ready(*tables: str) -> None:
    if not all(ready(t) for t in tables):
        raise AppError(NOT_READY, status_code=503)


def is_deleted(row: dict | None) -> bool:
    return bool((row or {}).get("deleted_at"))
