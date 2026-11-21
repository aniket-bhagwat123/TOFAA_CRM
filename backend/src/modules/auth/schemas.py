import re
from enum import StrEnum

from pydantic import Field, field_validator

from src.core.schema import CamelModel


class Role(StrEnum):
    ADMIN = "admin"
    SALES_MANAGER = "sales_manager"
    SALES_EXECUTIVE = "sales_executive"
    FINANCE = "finance"
    KAM = "kam"


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
