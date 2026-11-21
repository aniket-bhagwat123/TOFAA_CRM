"""Sending email through Resend (already a dependency). Used for quotations."""
import logging

from src.core.config import settings
from src.core.errors import AppError

log = logging.getLogger(__name__)


def email_enabled() -> bool:
    return bool(settings.RESEND_API_KEY and settings.RESEND_FROM_EMAIL)


def send_email(to: str, subject: str, html: str, attachments: list[tuple[str, bytes]] | None = None) -> None:
    if not email_enabled():
        raise AppError("Email is not set up yet. Add RESEND_API_KEY and RESEND_FROM_EMAIL on the server, or send by WhatsApp.", status_code=503)
    import resend

    resend.api_key = settings.RESEND_API_KEY
    params = {
        "from": settings.RESEND_FROM_EMAIL, "to": [to], "subject": subject, "html": html,
        "attachments": [{"filename": name, "content": list(content)} for name, content in (attachments or [])],
    }
    try:
        resend.Emails.send(params)
    except Exception as exc:  # noqa: BLE001
        log.exception("email send failed")
        raise AppError("The email could not be sent. Check the address and try again.", status_code=502) from exc
