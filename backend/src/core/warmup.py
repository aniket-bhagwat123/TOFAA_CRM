"""Keep the first request after a quiet period as fast as the rest.

A cold request pays DNS, TLS and HTTP/2 setup to Supabase (well over a second on a distant region).
We open the connection at startup, and a light ping keeps it open while the server is idle.
"""
import logging
import threading
import time

from src.core.supabase import get_service_client

log = logging.getLogger(__name__)
PING_EVERY_SECONDS = 30  # shorter than the pool keep-alive (45 s), so one connection is always warm


def _ping() -> None:
    get_service_client().table("profiles").select("id").limit(1).execute()


def _loop() -> None:
    while True:
        try:
            _ping()
        except Exception:  # noqa: BLE001 - never let a failed ping stop the loop
            log.warning("warm-up ping failed", exc_info=True)
        time.sleep(PING_EVERY_SECONDS)


def start() -> None:
    threading.Thread(target=_loop, name="warmup", daemon=True).start()
