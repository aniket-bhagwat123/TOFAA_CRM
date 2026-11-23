import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from src.api.router import api_router
from src.core import warmup
from src.core.cache import install_cache_invalidation
from src.core.config import settings
from src.core.errors import register_error_handlers
from src.core.schema import ok
from src.core.supabase import get_service_client
from src.core.telemetry import install_telemetry


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not os.environ.get("PYTEST_CURRENT_TEST"):  # tests must not open real connections
        warmup.start()
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=None if settings.is_production else f"{settings.API_V1_STR}/openapi.json",
    docs_url=None if settings.is_production else f"{settings.API_V1_STR}/docs",
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.BACKEND_CORS_ORIGIN_REGEX or None,  # e.g. every Vercel preview of the frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)  # the board and lists are large JSON
install_cache_invalidation(app)
install_telemetry(app)
register_error_handlers(app)
app.include_router(api_router, prefix=settings.API_V1_STR)


@app.get("/health")
@app.get("/health/live")
def live():
    return ok({"status": "ok"})


@app.get("/health/ready")
def ready():
    try:
        get_service_client().table("profiles").select("id").limit(1).execute()
    except Exception:  # noqa: BLE001
        from fastapi.responses import JSONResponse

        return JSONResponse({"data": {"status": "unavailable"}, "message": "Database unreachable."}, status_code=503)
    return ok({"status": "ready"})
