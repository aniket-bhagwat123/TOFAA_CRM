import time
from typing import Any


class TTLCache:
    def __init__(self, ttl_seconds: float = 30.0, max_items: int = 1024):
        self.ttl = ttl_seconds
        self.max_items = max_items
        self._store: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        item = self._store.get(key)
        if not item:
            return None
        expires, value = item
        if expires < time.monotonic():
            self._store.pop(key, None)
            return None
        return value

    def set(self, key: str, value: Any) -> None:
        if len(self._store) >= self.max_items:
            self._store.pop(next(iter(self._store)))
        self._store[key] = (time.monotonic() + self.ttl, value)

    def invalidate_prefix(self, prefix: str) -> None:
        for k in [k for k in self._store if k.startswith(prefix)]:
            del self._store[k]

    def clear(self) -> None:
        self._store.clear()
