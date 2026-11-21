"""Normalisation used for duplicate detection."""
import re


def phone_key(phone: str | None) -> str | None:
    """Last 10 digits, so +91 98765 43210 and 09876543210 match."""
    digits = re.sub(r"\D", "", phone or "")
    return digits[-10:] if len(digits) >= 7 else None


def email_key(email: str | None) -> str | None:
    e = (email or "").strip().lower()
    return e or None


def company_key(name: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def normalize_phone10(phone: str | None) -> str | None:
    """The 10-digit mobile number, or None if it is not one.

    Spaces, dashes and brackets are ignored. A leading +91 / 91 (12 digits) or 0 (11 digits) is dropped,
    so "+91 98765 43210", "098765 43210" and "9876543210" are all the same number.
    """
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits if len(digits) == 10 else None
