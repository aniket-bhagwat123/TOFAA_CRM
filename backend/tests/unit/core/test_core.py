import pytest

from src.core.concurrency import check_version
from src.core.errors import AppError, ConflictError
from src.core.images import validate_image
from src.core.pagination import PageParams, page_meta, parse_sort
from src.core.ttl_cache import TTLCache


def test_page_meta_rounds_up():
    assert page_meta(PageParams(page=1, limit=10), 25)["pages"] == 3
    assert page_meta(PageParams(), 0)["pages"] == 1


def test_page_range():
    p = PageParams(page=3, limit=10)
    assert (p.start, p.end) == (20, 29)


def test_parse_sort():
    assert parse_sort("-budget", {"budget"}) == ("budget", True)
    assert parse_sort("budget", {"budget"}) == ("budget", False)
    assert parse_sort("evil", {"budget"}) == ("created_at", True)


def test_check_version_conflict_carries_latest():
    with pytest.raises(ConflictError) as e:
        check_version({"version": 3, "id": "x"}, 2)
    assert e.value.data["latest"]["version"] == 3
    check_version({"version": 2}, 2)


def test_validate_image():
    validate_image("image/png", b"x")
    with pytest.raises(AppError):
        validate_image("text/html", b"x")
    with pytest.raises(AppError):
        validate_image("image/png", b"")


def test_ttl_cache():
    c = TTLCache(ttl_seconds=60)
    c.set("a:1", 1)
    assert c.get("a:1") == 1
    c.invalidate_prefix("a:")
    assert c.get("a:1") is None
