"""Response caching for the API.

Two kinds, both in memory and thread-safe:

* `reference`: rarely changing data (profile, team, stage settings, templates). Kept for minutes and
  invalidated explicitly by the code that changes it.
* `memo`: what a user sees (Today, leads, board ...). Keyed by user and parameters, and by a data
  version that goes up after ANY successful write, so a user never reads their own stale data. The
  short TTL covers writes made by another server process.
"""
import json
import threading
import time
from typing import Any, Callable

from fastapi import FastAPI, Request

_lock = threading.RLock()
_store: dict[str, tuple[float, Any]] = {}
_version = 0
MAX_ITEMS = 5000


def _get(key: str) -> tuple[bool, Any]:
    with _lock:
        item = _store.get(key)
        if item and item[0] > time.monotonic():
            return True, item[1]
        _store.pop(key, None)
        return False, None


def _set(key: str, value: Any, ttl: float) -> None:
    with _lock:
        if len(_store) >= MAX_ITEMS:
            now = time.monotonic()
            for k in [k for k, (exp, _) in _store.items() if exp < now] or [next(iter(_store))]:
                _store.pop(k, None)
        _store[key] = (time.monotonic() + ttl, value)


# --- reference data -----------------------------------------------------------------------------

def reference(name: str, key: str, ttl: float, loader: Callable[[], Any]) -> Any:
    full = f"ref:{name}:{key}"
    hit, value = _get(full)
    if hit:
        return value
    value = loader()
    _set(full, value, ttl)
    return value


def invalidate_reference(name: str, key: str | None = None) -> None:
    prefix = f"ref:{name}:" + (key or "")
    with _lock:
        for k in [k for k in _store if k.startswith(prefix)]:
            del _store[k]


# --- per-user results ----------------------------------------------------------------------------

def data_version() -> int:
    return _version


def bump() -> None:
    """Call after any successful write: every cached per-user result becomes unusable."""
    global _version
    with _lock:
        _version += 1


def memo(name: str, user_id: str, params: Any, ttl: float, loader: Callable[[], Any]) -> Any:
    key = f"memo:{_version}:{name}:{user_id}:{json.dumps(params, sort_keys=True, default=str)}"
    hit, value = _get(key)
    if hit:
        return value
    version_at_start = _version
    value = loader()
    if version_at_start == _version:  # a write landed while we were loading: do not cache a possibly stale result
        _set(key, value, ttl)
    return value


def clear() -> None:
    global _version
    with _lock:
        _store.clear()
        _version += 1


def install_cache_invalidation(app: FastAPI) -> None:
    """Any successful POST / PATCH / PUT / DELETE bumps the data version (including WhatsApp webhooks)."""

    @app.middleware("http")
    async def _bump_on_write(request: Request, call_next):
        response = await call_next(request)
        if request.method in ("POST", "PATCH", "PUT", "DELETE") and response.status_code < 400:
            bump()
        return response


def peek(name: str, key: str) -> Any | None:
    """Read reference data without loading it on a miss."""
    hit, value = _get(f"ref:{name}:{key}")
    return value if hit else None


def store(name: str, key: str, ttl: float, value: Any) -> None:
    _set(f"ref:{name}:{key}", value, ttl)
