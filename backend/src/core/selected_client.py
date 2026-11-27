"""The client a KAM or admin has picked in the header of the OS-side screens (People, recipient groups, Gift Requests). The app
sends it as X-Client-Id with those requests, and they then show that client only. The CRM side is not filtered.

It can only narrow what someone sees: each query still applies its own access rules first. Other roles ignore it."""
import contextvars
import uuid

from fastapi import FastAPI, Request

HEADER = "x-client-id"
_current: contextvars.ContextVar[str | None] = contextvars.ContextVar("selected_client", default=None)


def current() -> str | None:
    return _current.get()


def selected_client(user) -> str | None:
    """The picked client's id for a KAM or admin; None means all they may see. (Not for someone from Gifting OS.)"""
    return _current.get() if user.role in ("kam", "admin") and not getattr(user, "company_id", None) else None


def parse(value: str | None) -> str | None:
    """Only a real id is accepted: it goes into database filters."""
    try:
        return str(uuid.UUID(value)) if value else None
    except ValueError:
        return None


def install_selected_client(app: FastAPI) -> None:
    @app.middleware("http")
    async def _selected(request: Request, call_next):
        token = _current.set(parse(request.headers.get(HEADER)))
        try:
            return await call_next(request)
        finally:
            _current.reset(token)
