import pytest
from fastapi.testclient import TestClient

from src.main import app

client = TestClient(app)


def test_live():
    r = client.get("/health/live")
    assert r.status_code == 200 and r.json()["data"]["status"] == "ok"


def test_requires_auth():
    r = client.get("/api/v1/auth/me")
    assert r.status_code == 401
    assert r.json()["message"]


def test_validation_envelope():
    r = client.post("/api/v1/auth/otp/request", json={})
    assert r.status_code == 422
    assert r.json()["message"] == "Request validation failed."
    assert r.json()["data"]["errors"]


def test_bad_identifier_is_422():
    assert client.post("/api/v1/auth/otp/request", json={"identifier": "12345"}).status_code == 422


def test_logout_requires_auth():
    assert client.post("/api/v1/auth/logout").status_code == 401


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/v1/today"), ("get", "/api/v1/leads"), ("post", "/api/v1/leads"),
        ("get", "/api/v1/leads/board"), ("get", "/api/v1/meetings"), ("get", "/api/v1/notifications"),
        ("post", "/api/v1/imports/preview"), ("get", "/api/v1/whatsapp/usage"), ("get", "/api/v1/users"),
    ],
)
def test_crm_routes_are_protected(method, path):
    assert getattr(client, method)(path).status_code == 401


def test_webhook_rejects_unsigned_posts():
    assert client.post("/api/v1/whatsapp/webhook", json={"entry": []}).status_code == 403


def test_webhook_verification_needs_token():
    r = client.get("/api/v1/whatsapp/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "1"})
    assert r.status_code == 403
