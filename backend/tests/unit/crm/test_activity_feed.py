from fastapi.testclient import TestClient

from src.main import app
from src.modules.activity_feed.service import merge


def test_merge_is_newest_first_across_both_sources_and_capped():
    deals = [{"created_at": "2026-11-21T10:00:00+00:00", "id": "d1"}, {"created_at": "2026-11-19T10:00:00+00:00", "id": "d2"}]
    clients = [{"created_at": "2026-11-20T10:00:00+00:00", "id": "c1"}]
    assert [r["id"] for r in merge(deals, clients, 10)] == ["d1", "c1", "d2"]
    assert [r["id"] for r in merge(deals, clients, 2)] == ["d1", "c1"]


def test_activity_needs_sign_in():
    assert TestClient(app).get("/api/v1/activity").status_code == 401
