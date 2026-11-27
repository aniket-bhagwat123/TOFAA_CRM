import re
from enum import StrEnum

from pydantic import Field, field_validator

from src.core.schema import CamelModel
from src.core.validators import Email, clean_phone


LEGACY_KAM = "sales_executive"


class Role(StrEnum):
    ADMIN = "admin"
    SALES_MANAGER = "sales_manager"
    FINANCE = "finance"
    KAM = "kam"  # Key Account Manager

    @classmethod
    def _missing_(cls, value):
        """Sales Executive became KAM: an account (or setting) still saved with the old name is read as KAM."""
        return cls.KAM if value == LEGACY_KAM else None


# Every value a KAM can be stored as: for database filters, until all rows are migrated.
KAM_VALUES = (Role.KAM.value, LEGACY_KAM)


class OtpRequest(CamelModel):
    """Email address or mobile number to send a one-time code to."""

    identifier: str = Field(min_length=5, max_length=120)


class OtpVerify(CamelModel):
    identifier: str = Field(min_length=5, max_length=120)
    code: str = Field(min_length=4, max_length=10)


class RefreshRequest(CamelModel):
    refresh_token: str


class Profile(CamelModel):
    id: str
    email: str | None = None
    phone: str | None = None
    full_name: str | None = None
    role: Role
    manager_id: str | None = None
    avatar_url: str | None = None


class TokenPair(CamelModel):
    access_token: str
    refresh_token: str
    expires_in: int | None = None


class LoginResponse(CamelModel):
    profile: Profile
    tokens: TokenPair


class PasswordLogin(CamelModel):
    identifier: str = Field(min_length=5, max_length=120)
    password: str = Field(min_length=1, max_length=72)


class PasswordReset(CamelModel):
    identifier: str = Field(min_length=5, max_length=120)
    code: str = Field(min_length=4, max_length=10)
    new_password: str = Field(min_length=8, max_length=72)

    @field_validator("new_password")
    @classmethod
    def _strong(cls, v: str) -> str:
        if not (re.search(r"[a-z]", v) and re.search(r"[A-Z]", v) and re.search(r"\d", v)):
            raise ValueError("Use upper and lower case letters and a number.")
        return v


class PasswordChange(CamelModel):
    """A signed-in person choosing a new password. Being signed in is the proof of identity."""

    new_password: str = Field(min_length=8, max_length=72)

    @field_validator("new_password")
    @classmethod
    def _strong(cls, v: str) -> str:
        if not (re.search(r"[a-z]", v) and re.search(r"[A-Z]", v) and re.search(r"\d", v)):
            raise ValueError("Use upper and lower case letters and a number.")
        return v


class SignupRequest(CamelModel):
    """Someone creating their own account, with the role they work in. Admin cannot be chosen."""

    full_name: str = Field(min_length=1, max_length=200)
    role: Role = Role.KAM
    email: Email
    password: str = Field(min_length=8, max_length=72)
    phone: str | None = Field(default=None, max_length=20)

    @field_validator("full_name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("Name is required.")
        return v

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.lower()

    @field_validator("role")
    @classmethod
    def _not_admin(cls, v: Role) -> Role:
        if v == Role.ADMIN:
            raise ValueError("Admin accounts are created by an existing admin, not by sign-up.")
        return v

    @field_validator("password")
    @classmethod
    def _strong(cls, v: str) -> str:
        if not (re.search(r"[a-z]", v) and re.search(r"[A-Z]", v) and re.search(r"\d", v)):
            raise ValueError("Use upper and lower case letters and a number.")
        return v

    @field_validator("phone", mode="before")
    @classmethod
    def _phone(cls, v):
        return clean_phone(v.strip() or None if isinstance(v, str) else v)


class SignupResponse(CamelModel):
    """'pending': wait for an admin. 'active': signed in straight away (tokens included)."""

    status: str
    message: str
    profile: Profile | None = None
    tokens: TokenPair | None = None
