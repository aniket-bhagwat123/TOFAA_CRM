"""People for TOFAA Gifting OS: key, tenant link, one-client scope, authorship and the change notice."""
import pytest
from fastapi.testclient import TestClient

from src.core.config import settings
from src.core.errors import NotFoundError
from src.main import app
from src.modules.integrations import gifting_people
from src.modules.integrations.people_notice import is_people_write
from src.modules.people import service
from src.modules.people.service import ExternalActor, company_scope, uid

KEY = "k" * 40
TENANT = "11111111-1111-1111-1111-111111111111"
BASE = "/api/v1/integrations/gifting"
HEADERS = {"X-API-Key": KEY, "X-Tenant-Id": TENANT, "X-Actor-Name": "Asha (client)", "X-Actor-Role": "CLIENT", "X-Actor-Kind": "CLIENT"}


@pytest.fixture
def linked(monkeypatch):
    monkeypatch.setattr(settings, "GIFTING_OS_API_KEY", KEY)
    monkeypatch.setattr(settings, "GIFTING_OS_API_URL", "")  # no outgoing notice in tests
    monkeypatch.setattr(gifting_people, "linked_company", lambda t: {"id": "c-1", "name": "Wendy", "client_since": "2026-01-01"} if t == TENANT else None)
    seen = {}

    def fake_list(user, **kw):
        seen["user"] = user
        return {"items": [], "total": 0, "page": 1, "limit": 20}

    monkeypatch.setattr(service, "list_people", fake_list)
    return seen


def test_external_actor_sees_only_its_own_client_and_writes_no_crm_user_id():
    actor = ExternalActor(id="gifting:c-1", role="kam", company_id="c-1", full_name="Asha", added_by="CLIENT", actor_role="CLIENT")
    assert company_scope(actor) == ["c-1"]
    assert uid(actor) is None


def test_key_and_tenant_are_required(linked):
    client = TestClient(app)
    assert client.get(f"{BASE}/people", headers={**HEADERS, "X-API-Key": "wrong"}).status_code == 401
    assert client.get(f"{BASE}/people", headers={k: v for k, v in HEADERS.items() if k != "X-API-Key"}).status_code == 401
    assert client.get(f"{BASE}/people", headers={k: v for k, v in HEADERS.items() if k != "X-Tenant-Id"}).status_code == 422
    # a normal CRM bearer token is not enough here, and the key is not enough on the normal CRM People endpoint
    assert client.get("/api/v1/people", headers={"X-API-Key": KEY}).status_code == 401


def test_unlinked_tenant_answers_not_linked(linked):
    res = TestClient(app).get(f"{BASE}/people", headers={**HEADERS, "X-Tenant-Id": "22222222-2222-2222-2222-222222222222"})
    assert res.status_code == 404 and res.json()["data"]["code"] == "TENANT_NOT_LINKED"


def test_people_endpoint_runs_as_the_gifting_os_person(linked):
    res = TestClient(app).get(f"{BASE}/people", headers=HEADERS)
    assert res.status_code == 200
    user = linked["user"]
    assert isinstance(user, ExternalActor)
    assert (user.company_id, user.full_name, user.added_by, user.actor_role) == ("c-1", "Asha (client)", "CLIENT", "CLIENT")


def test_another_clients_person_is_not_found(monkeypatch):
    actor = ExternalActor(id="gifting:c-1", role="kam", company_id="c-1", full_name="Asha")

    class Rows:
        def __init__(self, data):
            self.data = data

    class Q:
        def __getattr__(self, _):
            return lambda *a, **k: self

        def execute(self):
            return Rows([{"id": "p-9", "company_id": "c-OTHER", "deleted_at": None}])

    monkeypatch.setattr(service, "get_service_client", lambda: type("C", (), {"table": lambda self, _: Q()})())
    with pytest.raises(NotFoundError):
        service.person_row(actor, "p-9")


@pytest.mark.parametrize("method,path,status,expected", [
    ("POST", "/api/v1/people", 201, True),
    ("PATCH", "/api/v1/people/abc", 200, True),
    ("DELETE", "/api/v1/people/abc/addresses/x", 200, True),
    ("PUT", "/api/v1/integrations/gifting/people/abc/preferences", 200, True),
    ("GET", "/api/v1/people", 200, False),
    ("POST", "/api/v1/people", 409, False),
    ("POST", "/api/v1/people-groups", 201, False),
    ("POST", "/api/v1/leads", 201, False),
])
def test_which_writes_tell_gifting_os(method, path, status, expected):
    assert is_people_write(method, path, status) is expected
