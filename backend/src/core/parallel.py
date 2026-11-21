"""Run independent database calls at the same time.

Each Supabase call is a network round trip, so doing five in a row costs five round trips. These
helpers overlap them. Everything shares one small thread pool.
"""
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

log = logging.getLogger(__name__)
_pool = ThreadPoolExecutor(max_workers=24, thread_name_prefix="db")


def par(*calls: Callable[[], Any]) -> list[Any]:
    """Run the callables together and return their results in order. The first error is raised."""
    if len(calls) == 1:
        return [calls[0]()]
    futures = [_pool.submit(c) for c in calls]
    return [f.result() for f in futures]


def bg(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> None:
    """Fire and forget (audit trail, cache warming). Failures are logged, never raised to the caller."""

    def _run() -> None:
        try:
            fn(*args, **kwargs)
        except Exception:  # noqa: BLE001
            log.exception("background task %s failed", getattr(fn, "__name__", fn))

    _pool.submit(_run)
