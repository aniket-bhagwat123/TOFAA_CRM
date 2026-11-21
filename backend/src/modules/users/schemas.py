import re
from datetime import datetime

from pydantic import Field, field_validator

from src.core.schema import CamelModel
from src.core.validators import Email, clean_phone
from src.modules.auth.schemas import Role


def strong_password(v: str | None) -> str | None:
    if v is not None and not (re.search(r"[a-z]", v) and re.search(r"[A-Z]", v) and re.search(r"\d", v)):
        raise ValueError("Use upper and lower case letters and a number.")
    return v


class UserCreate(CamelModel):
    """People sign in with their email and a password, so both are set when the account is made (the admin can
    generate the password and share it)."""

    email: Email
    password: str = Field(min_length=8, max_length=72)
    phone: str | None = Field(default=None, max_length=20)
    full_name: str = Field(min_length=1, max_length=200)
    role: Role = Role.SALES_EXECUTIVE
    manager_id: str | None = None

    @field_validator("phone")
    @classmethod
    def _ten_digit_phone(cls, v):
        return clean_phone(v)  # exactly 10 digits, or a friendly error

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str | None) -> str | None:
        return v.lower() if v else None

    @field_validator("full_name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name is required.")
        return v

    @field_validator("password")
    @classmethod
    def _strong(cls, v: str) -> str:
        return strong_password(v)


class UserUpdate(CamelModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    email: Email | None = None
    phone: str | None = Field(default=None, max_length=20)
    password: str | None = Field(default=None, min_length=8, max_length=72)  # an admin setting a new password
    role: Role | None = None
    manager_id: str | None = None
    is_active: bool | None = None
    clear_manager: bool = False

    @field_validator("phone")
    @classmethod
    def _ten_digit_phone(cls, v):
        return clean_phone(v)

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str | None) -> str | None:
        return v.lower() if v else None

    @field_validator("password")
    @classmethod
    def _strong(cls, v: str | None) -> str | None:
        return strong_password(v)


class UserOut(CamelModel):
    id: str
    email: str | None = None
    phone: str | None = None
    full_name: str | None = None
    role: Role
    manager_id: str | None = None
    is_active: bool = True
    avatar_url: str | None = None
    created_at: datetime | None = None
