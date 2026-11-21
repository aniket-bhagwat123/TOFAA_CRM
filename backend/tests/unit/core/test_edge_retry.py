import httpx
import pytest

from src.core import supabase as sb


class Script(httpx.BaseTransport):
    """Answers from a list, so we can play back what the proxy did."""

    def __init__(self, answers):
        self.answers, self.calls = list(answers), 0

    def handle_request(self, request):
        self.calls += 1
        status, ctype = self.answers.pop(0)
        return httpx.Response(status, headers={"content-type": ctype}, content=b"x", request=request)


def transport(answers, monkeypatch):
    script = Script(answers)
    # Route the retry logic's "real" send to our script.
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", lambda self, request: script.handle_request(request))
    return sb._EdgeRetryTransport(), script


HTML, JSON = "text/html", "application/json"


def test_html_400_from_the_edge_is_retried_then_succeeds(monkeypatch):
    t, script = transport([(400, HTML), (400, HTML), (200, JSON)], monkeypatch)
    assert t.handle_request(httpx.Request("GET", "https://x/rest/v1/profiles")).status_code == 200
    assert script.calls == 3


def test_a_json_400_is_a_real_answer_and_is_not_retried(monkeypatch):
    t, script = transport([(400, JSON)], monkeypatch)
    assert t.handle_request(httpx.Request("GET", "https://x/rest/v1/profiles")).status_code == 400
    assert script.calls == 1


def test_writes_retry_only_the_edge_400_never_a_gateway_error(monkeypatch):
    t, script = transport([(400, HTML), (201, JSON)], monkeypatch)
    assert t.handle_request(httpx.Request("POST", "https://x/rest/v1/leads")).status_code == 201
    t, script = transport([(502, HTML)], monkeypatch)  # might have reached the database: do not repeat a write
    assert t.handle_request(httpx.Request("POST", "https://x/rest/v1/leads")).status_code == 502
    assert script.calls == 1


def test_gives_up_after_the_retries(monkeypatch):
    t, script = transport([(400, HTML)] * 3, monkeypatch)
    assert t.handle_request(httpx.Request("GET", "https://x/")).status_code == 400
    assert script.calls == 3
