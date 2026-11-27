"""Gift requests from Gifting OS: only the signed-in person's own linked accounts are ever asked for."""
import pytest

from src.core.errors import ForbiddenError, NotFoundError
from src.modules.auth.schemas import Profile, Role
from src.modules.gifting_requests import service

LINKED = {"t-1": {"id": "c-1", "name": "Wendy"}}


def test_other_roles_are_refused():
    with pytest.raises(ForbiddenError):
        service.accounts(Profile.model_construct(id="u", role=Role.FINANCE))


def test_only_own_accounts_are_sent_and_names_are_added(monkeypatch):
    sent = {}

    def fake_call(path, body):
        sent.update(body)
        return {"items": [{"id": "r-1", "tenantId": "t-1"}], "total": 1, "page": 1, "limit": 25, "counts": []}

    monkeypatch.setattr(service, "accounts", lambda user: LINKED)
    monkeypatch.setattr(service, "_call", fake_call)
    out = service.search(None, company_id=None, status=None, search=None, page=1, limit=25)
    assert sent["tenantIds"] == ["t-1"]
    assert out["items"][0]["accountName"] == "Wendy"


def test_someone_elses_account_is_not_found_and_nothing_is_sent(monkeypatch):
    monkeypatch.setattr(service, "accounts", lambda user: LINKED)
    monkeypatch.setattr(service, "_call", lambda *a: pytest.fail("must not call Gifting OS"))
    with pytest.raises(NotFoundError):
        service.search(None, company_id="c-9", status=None, search=None, page=1, limit=25)


def test_a_kam_with_no_linked_account_sees_nothing(monkeypatch):
    monkeypatch.setattr(service, "accounts", lambda user: {})
    monkeypatch.setattr(service, "_call", lambda *a: pytest.fail("must not call Gifting OS"))
    assert service.search(None, company_id=None, status=None, search=None, page=1, limit=25)["items"] == []
    with pytest.raises(NotFoundError):
        service.detail(None, "r-1")


def test_an_action_carries_the_signed_in_person_and_only_their_clients(monkeypatch):
    sent = {}

    def fake_call(path, body):
        sent.update(body, path=path)
        return {"request": {"id": "r-1", "tenantId": "t-1"}, "history": []}

    monkeypatch.setattr(service, "accounts", lambda user: LINKED)
    monkeypatch.setattr(service, "_call", fake_call)
    service.act(Profile.model_construct(id="u-9", full_name="Asha", role=Role.KAM), "r-1", "start_review", None, None)
    assert (sent["path"], sent["tenantIds"], sent["actorId"], sent["actorName"]) == ("/r-1/actions", ["t-1"], "u-9", "Asha")


def test_only_recent_submissions_raise_an_alert(monkeypatch):
    from datetime import datetime, timezone

    from src.modules.notifications import service as notifications

    now = datetime.now(timezone.utc).isoformat()
    items = [{"id": "new", "title": "Diwali", "updatedAt": now, "accountName": "Wendy"},
             {"id": "old", "title": "Holi", "updatedAt": "2020-01-01T00:00:00+00:00"}]
    raised = []
    monkeypatch.setattr(service, "search", lambda user, **kw: {"items": items})
    monkeypatch.setattr(notifications, "notify", lambda *a: raised.append(a))
    assert service.raise_alerts(Profile.model_construct(id="u", role=Role.KAM)) == 1
    assert raised[0][4] == "/gifting-requests?open=new"


def test_new_items_are_only_made_for_the_persons_own_account(monkeypatch):
    sent = []
    monkeypatch.setattr(service, "accounts", lambda user: LINKED)
    monkeypatch.setattr(service, "_call", lambda path, body, base=None: sent.append((path, body)) or {})
    user = Profile.model_construct(id="u-9", full_name="Asha", role=Role.KAM)
    service.create_occasion(user, "c-1", {"occasionName": "Holi", "occasionDate": "2027-03-01"})
    assert sent[0][0] == "/occasions" and sent[0][1]["tenantId"] == "t-1" and sent[0][1]["actorId"] == "u-9"
    with pytest.raises(NotFoundError):
        service.create_request(user.model_copy(update={"role": Role.ADMIN}), "c-9", {})
    assert len(sent) == 1


@pytest.mark.parametrize("role", [Role.KAM, Role("sales_executive")])
def test_a_kam_cannot_create_a_gift_request(monkeypatch, role):
    monkeypatch.setattr(service, "_call", lambda *a, **k: pytest.fail("must not call Gifting OS"))
    with pytest.raises(ForbiddenError):
        service.create_request(Profile.model_construct(id="u-9", full_name="Asha", role=role), "c-1", {})
