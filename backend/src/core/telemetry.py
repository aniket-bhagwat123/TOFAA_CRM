import logging
import time

from fastapi import FastAPI, Request

log = logging.getLogger("telemetry")


def install_telemetry(app: FastAPI) -> None:
    @app.middleware("http")
    async def _timing(request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        ms = (time.perf_counter() - start) * 1000
        response.headers["X-Process-Time-Ms"] = f"{ms:.1f}"
        log.info("%s %s -> %s %.1fms", request.method, request.url.path, response.status_code, ms)
        return response
