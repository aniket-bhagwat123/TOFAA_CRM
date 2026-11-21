from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

T = TypeVar("T")


class CamelModel(BaseModel):
    """camelCase on the wire, snake_case in Python."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Envelope(BaseModel, Generic[T]):
    data: T
    message: str = "OK"


def camelize(value):
    """Recursively convert dict keys to camelCase (database rows come back snake_case)."""
    if isinstance(value, dict):
        # Keys without an underscore are already fine (to_camel would lowercase their inner capitals).
        return {to_camel(k) if isinstance(k, str) and "_" in k else k: camelize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [camelize(v) for v in value]
    return value


def ok(data, message: str = "OK") -> dict:
    return {"data": camelize(data), "message": message}
