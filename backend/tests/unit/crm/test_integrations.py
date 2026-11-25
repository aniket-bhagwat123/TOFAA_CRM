"""Server-to-server banners for TOFAA Gifting OS: the API key gate and what the shared list contains."""
import pytest
from fastapi.testclient import TestClient

from src.core import cache
from src.core.config import settings
from src.main import app
from src.modules.banners import service as banners
from src.modules.integrations.router import key_matches

KEY = "k" * 40
URL = "/api/v1/integrations/banners"


@pytest.fixture(autouse=True)
def _fresh_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def rows(monkeypatch):
    live = [
        {"id": "1", "audience": "ALL", "title": "Diwali", "sort_order": 0, "image_path": "banners/a.png", "created_by": "u1"},
        {"id": "2", "audience": "KAM", "title": "KAM only", "sort_order": 1, "image_path": "banners/b.png"},
        {"id": "3", "audience": "ADMIN", "title": "Admin only", "sort_order": 2, "image_path": "banners/c.png"},
        {"id": "4", "audience": "ALL", "title": "No picture link", "sort_order": 3, "image_path": "banners/gone.png"},
    ]
    monkeypatch.setattr(banners, "_live_rows", lambda: live)
    urls = {"banners/a.png": "https://x.supabase.co/a?token=t", "banners/b.png": "https://x.supabase.co/b?token=t", "banners/c.png": "https://x.supabase.co/c?token=t"}
    monkeypatch.setattr(banners, "signed_urls", lambda _bucket, paths: {p: urls[p] for p in paths if p in urls})
    return live


def test_key_must_be_configured_long_enough_and_match():
    assert key_matches(KEY, KEY)
    assert not key_matches(KEY, "")                  # not configured: refuse everything
    assert not key_matches("short", "short")         # a weak key is treated as not configured
    assert not key_matches(None, KEY)
    assert not key_matches("", KEY)
    assert not key_matches(KEY + "x", KEY)
    assert not key_matches(KEY.upper(), KEY)


def test_shared_list_has_every_live_banner_and_only_display_fields(rows):
    shared = banners.shared_live()
    assert [b["id"] for b in shared] == ["1", "2", "3"]  # banners are only for Gifting OS now; one without a link is skipped
    assert shared[0] == {"id": "1", "title": "Diwali", "sort_order": 0, "image_url": "https://x.supabase.co/a?token=t"}


def test_endpoint_refuses_without_the_right_key(rows, monkeypatch):
    client = TestClient(app)
    monkeypatch.setattr(settings, "GIFTING_OS_API_KEY", "")
    assert client.get(URL, headers={"X-API-Key": ""}).status_code == 401
    monkeypatch.setattr(settings, "GIFTING_OS_API_KEY", KEY)
    assert client.get(URL).status_code == 401
    assert client.get(URL, headers={"X-API-Key": "wrong"}).status_code == 401
    assert client.get(URL, headers={"Authorization": f"Bearer {KEY}"}).status_code == 401  # only the header counts


def test_endpoint_answers_with_the_right_key(rows, monkeypatch):
    monkeypatch.setattr(settings, "GIFTING_OS_API_KEY", KEY)
    res = TestClient(app).get(URL, headers={"X-API-Key": KEY})
    assert res.status_code == 200
    assert res.headers["cache-control"] == "no-store"
    assert res.json()["data"][0] == {"id": "1", "title": "Diwali", "sortOrder": 0, "imageUrl": "https://x.supabase.co/a?token=t"}
