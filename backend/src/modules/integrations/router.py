"""Read-only endpoints for other TOFAA systems (server to server), not for people signing in.

A caller proves itself with the shared secret in the X-API-Key header (settings.GIFTING_OS_API_KEY). The key belongs
on the caller's server only: never in a browser, a frontend bundle or a URL.
"""
import hmac
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Response

from src.core.config import settings
from src.core.errors import UnauthorizedError
from src.core.schema import ok
from src.modules.banners import service as banners

log = logging.getLogger(__name__)
MIN_KEY_LENGTH = 32


def key_matches(sent: str | None, expected: str) -> bool:
    """True only for a configured key of real length that matches exactly (compared in constant time)."""
    if len(expected) < MIN_KEY_LENGTH or not sent:
        return False
    return hmac.compare_digest(sent.encode(), expected.encode())


def require_gifting_os_key(x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None) -> None:
    expected = settings.GIFTING_OS_API_KEY
    if len(expected) < MIN_KEY_LENGTH:
        log.warning("GIFTING_OS_API_KEY is not set (or under %s characters): integration call refused.", MIN_KEY_LENGTH)
    if not key_matches(x_api_key, expected):
        raise UnauthorizedError("A valid API key is required.")


router = APIRouter(prefix="/integrations", tags=["integrations"], dependencies=[Depends(require_gifting_os_key)])


@router.get("/banners")
def shared_banners(response: Response):
    """Live Dashboard banners with audience ALL, for the TOFAA Gifting OS dashboard."""
    response.headers["Cache-Control"] = "no-store"  # the picture links are signed: keep them out of shared caches
    return ok(banners.shared_live())
