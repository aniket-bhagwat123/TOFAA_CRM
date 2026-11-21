"""Field rules shared by every module, so the form, the import and the API all agree."""
import re
from typing import Annotated

from pydantic import AfterValidator

from src.core.keys import normalize_phone10

# Deliberately lenient: something@something.something. Test addresses (test@test.com, a@b.test, user+tag@x.io) pass.
# Whether the mailbox exists is not something a format check can tell.
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PHONE_MESSAGE = "Enter a 10-digit mobile number."
EMAIL_MESSAGE = "Enter a valid email address."


def is_email(value: str | None) -> bool:
    return bool(value and EMAIL_RE.match(value.strip()))


def clean_email(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    value = value.strip().lower()
    if not EMAIL_RE.match(value):
        raise ValueError(EMAIL_MESSAGE)
    return value


def clean_phone(value: str | None) -> str | None:
    """Blank becomes None; otherwise exactly the 10 digits, or a friendly error."""
    if value is None or not value.strip():
        return None
    number = normalize_phone10(value)
    if not number:
        raise ValueError(PHONE_MESSAGE)
    return number


Email = Annotated[str, AfterValidator(clean_email)]
Phone = Annotated[str, AfterValidator(clean_phone)]
