"""Tell TOFAA Gifting OS when People change, so its mirror updates straight away.

After any successful write to People (CRM screens or the Gifting OS integration), a short background call goes to
POST {GIFTING_OS_API_URL}/api/v1/integrations/crm/people-changed with the shared key. Gifting OS then asks
/people-sync for what changed. Bursts (a bulk delete, an import) become one call. The CRM response never waits for
it, and a failed call is only logged: Gifting OS also catches up on its own.
"""
import logging
import threading

import httpx
from fastapi import FastAPI, Request

from src.core.config import settings

log = logging.getLogger(__name__)
WRITES = ("POST", "PATCH", "PUT", "DELETE")
PEOPLE_PATHS = (
    "/people", "/integrations/gifting/people",
    "/people-groups", "/integrations/gifting/people-groups",
    "/integrations/gifting/tenant",  # a newly linked account has people and groups to copy
)
DEBOUNCE_SECONDS = 0.3
PATH = "/api/v1/integrations/crm/people-changed"


def is_people_write(method: str, path: str, status: int) -> bool:
    if method not in WRITES or status >= 400:
        return False
    rest = path.removeprefix(settings.API_V1_STR)
    return any(rest == p or rest.startswith(p + "/") for p in PEOPLE_PATHS)


class Notifier:
    def __init__(self) -> None:
        self._wake = threading.Event()
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None

    def poke(self) -> None:
        if not settings.GIFTING_OS_API_URL or len(settings.GIFTING_OS_API_KEY) < 32:
            return
        with self._lock:
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(target=self._run, name="gifting-people-notice", daemon=True)
                self._thread.start()
        self._wake.set()

    def _run(self) -> None:
        while self._wake.wait(timeout=60):
            self._wake.clear()
            self._wake.wait(DEBOUNCE_SECONDS)  # gather a burst into one call
            self._wake.clear()
            self.send()

    @staticmethod
    def send() -> bool:
        url = settings.GIFTING_OS_API_URL.rstrip("/") + PATH
        try:
            res = httpx.post(url, headers={"X-API-Key": settings.GIFTING_OS_API_KEY}, timeout=5, follow_redirects=False)
            res.raise_for_status()
            return True
        except Exception as exc:  # noqa: BLE001
            log.warning("Gifting OS people notice failed: %s", type(exc).__name__)
            return False


notifier = Notifier()


def install_people_notice(app: FastAPI) -> None:
    @app.middleware("http")
    async def _notice(request: Request, call_next):
        response = await call_next(request)
        if is_people_write(request.method, request.url.path, response.status_code):
            notifier.poke()
        return response
