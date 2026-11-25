"""Soft delete of leads and clients: only when nothing is connected, with a message that says what is."""
import pytest

from src.core.errors import ConflictError, ForbiddenError
from src.modules.auth.schemas import Profile, Role
from src.modules.clients import service as clients
from src.modules.leads import service as leads

MGR = Profile(id="m1", role=Role.SALES_MANAGER, full_name="Manager")
EXEC = Profile(id="e1", role=Role.SALES_EXECUTIVE, full_name="Exec")


def lead(stage="new_lead", owner="e1"):
    return {"id": "L1", "stage": stage, "owner_id": owner, "company_id": "C1", "pipeline": "new_business",
            "company": {"name": "Acme", "client_since": None}}


@pytest.fixture(autouse=True)
def ready(monkeypatch):
    monkeypatch.setattr(leads, "require_ready", lambda *t: None)
    monkeypatch.setattr(clients, "require_ready", lambda *t: None)


def test_lead_with_connected_records_is_kept_with_a_clear_message(monkeypatch):
    monkeypatch.setattr(leads, "get_lead_row", lambda u, i: lead("quotation_sent"))
    monkeypatch.setattr(leads, "lead_blockers", lambda i: [{"what": "quotations", "count": 2}, {"what": "meeting", "count": 1}])
    with pytest.raises(ConflictError) as e:
        leads.delete_lead(MGR, "L1")
    assert "Acme can't be deleted because it has 2 quotations and 1 meeting" in e.value.message
    assert "Close it as Lost instead" in e.value.message
    assert e.value.data["blockers"][0] == {"what": "quotations", "count": 2}


def test_won_deal_is_never_deleted(monkeypatch):
    monkeypatch.setattr(leads, "get_lead_row", lambda u, i: lead("closed_won"))
    with pytest.raises(ConflictError) as e:
        leads.delete_lead(MGR, "L1")
    assert "won deal" in e.value.message


def test_executive_may_delete_only_their_own_lead(monkeypatch):
    monkeypatch.setattr(leads, "get_lead_row", lambda u, i: lead(owner="someone-else"))
    with pytest.raises(ForbiddenError):
        leads.delete_lead(EXEC, "L1")


def test_join_reads_like_a_sentence():
    assert leads._join(["2 quotations"]) == "2 quotations"
    assert leads._join(["2 quotations", "1 order", "3 meetings"]) == "2 quotations, 1 order and 3 meetings"


class _Q:
    def __init__(self, rows):
        self.rows = rows

    def __getattr__(self, _):
        return lambda *a, **k: self

    def execute(self):
        return type("R", (), {"data": self.rows})()


def test_client_with_business_is_kept(monkeypatch):
    monkeypatch.setattr(clients, "_client", lambda u, i: {"id": "C1", "name": "Horizon Retail Group"})
    monkeypatch.setattr(clients, "live", lambda q, table="leads": q)
    deals = [{"id": "a", "pipeline": "new_business", "stage": "closed_won"}, {"id": "b", "pipeline": "client", "stage": "project_follow_up"},
             {"id": "c", "pipeline": "client", "stage": "project_proposal"}]
    monkeypatch.setattr(clients, "get_service_client", lambda: type("DB", (), {"table": lambda self, t: _Q(deals)})())
    with pytest.raises(ConflictError) as e:
        clients.delete_client(MGR, "C1")
    assert "Horizon Retail Group can't be deleted because it has 1 won order and 2 projects" in e.value.message


def test_only_managers_delete_clients():
    with pytest.raises(ForbiddenError):
        clients.delete_client(EXEC, "C1")
