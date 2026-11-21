import re
from decimal import Decimal

from pydantic import Field, field_validator

from src.core.schema import CamelModel


class TargetSet(CamelModel):
    user_id: str
    month: str = Field(description="YYYY-MM")
    target_amount: Decimal = Field(ge=0, le=Decimal("100000000000"))
    discount_limit: Decimal = Field(ge=0, le=100, description="percent")

    @field_validator("month")
    @classmethod
    def _month(cls, v: str) -> str:
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", v):
            raise ValueError("Use the format YYYY-MM.")
        return v
