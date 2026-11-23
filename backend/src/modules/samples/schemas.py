from datetime import date
from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from src.core.schema import CamelModel

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Detail = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]


class SampleFileIn(CamelModel):
    """A file already uploaded with POST /leads/{id}/sample-files."""
    path: str = Field(min_length=1, max_length=300)
    name: str = Field(min_length=1, max_length=200)
    mime: str | None = Field(default=None, max_length=100)


class SampleItemIn(CamelModel):
    """One item of the quotation (or one added here) with its sample images and files."""
    package_name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)] | None = None
    item_name: Name
    description: Detail | None = None
    files: list[SampleFileIn] = Field(default_factory=list, max_length=20)


class SamplesSave(CamelModel):
    items: list[SampleItemIn] = Field(default_factory=list, max_length=100)


class SamplesSend(CamelModel):
    channel: Literal["whatsapp", "email"]
    next_follow_up: date
    message: str | None = Field(default=None, max_length=1000)  # a line for the client, above the links
