from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Query

MAX_LIMIT = 100


@dataclass
class PageParams:
    page: int = 1
    limit: int = 20
    search: str | None = None
    sort: str | None = None  # "field" or "-field"

    @property
    def start(self) -> int:
        return (self.page - 1) * self.limit

    @property
    def end(self) -> int:
        return self.start + self.limit - 1


def page_params(
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = 20,
    search: str | None = None,
    sort: str | None = None,
) -> PageParams:
    return PageParams(page=page, limit=limit, search=search, sort=sort)


PageDep = Annotated[PageParams, Depends(page_params)]


def page_meta(params: PageParams, total: int) -> dict:
    pages = max(1, -(-total // params.limit))
    return {"page": params.page, "limit": params.limit, "total": total, "pages": pages}


def parse_sort(sort: str | None, allowed: set[str], default: str = "created_at") -> tuple[str, bool]:
    """Return (column, descending). Unknown columns fall back to the default."""
    if not sort:
        return default, True
    desc = sort.startswith("-")
    col = sort.lstrip("-")
    return (col, desc) if col in allowed else (default, True)
