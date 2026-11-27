"""Bulk lead reassignment: managers and KAMs (own leads) only, fair shares, everything checked before any write. No real database."""
import pytest

from src.core.errors import AppError, ForbiddenError
from src.modules.auth.schemas import Profile, Role
from src.modules.leads import schemas, service

MANAGER = Profile.model_construct(id="m", role=Role.SALES_MANAGER)


class Db:
    """Records writes; reads answer from `people` and `leads`."""

    def __init__(self, people, leads):
        self.rows = {"profiles": people, "leads": leads}
        self.writes = []

    def table(self, name):
        db = self

        class Query:
            def __init__(self):
                self.write, self.ids = None, None

            def __getattr__(self, attr):
                def call(*args, **kwargs):
                    if attr in ("update", "insert"):
                        self.write = (name, attr, args[0])
                    if attr == "in_":
                        self.ids = list(args[1])
                    return self
                return call

            def execute(self):
                if self.write:
                    db.writes.append((*self.write, self.ids))
                    return type("R", (), {"data": []})()
                data = [r for r in db.rows[name] if self.ids is None or r["id"] in self.ids]
                return type("R", (), {"data": data})()

        return Query()


def person(pid, role="kam", active=True):
    return {"id": pid, "full_name": pid.upper(), "role": role, "is_active": active}


@pytest.fixture
def setup(monkeypatch):
    def make(people, leads):
        db = Db(people, leads)
        monkeypatch.setattr(service, "get_service_client", lambda: db)
        monkeypatch.setattr(service, "live", lambda q, table: q)
        monkeypatch.setattr(service, "write_audit", lambda *a: None)
        return db
    return make


def run(lead_ids, owner_ids, user=MANAGER):
    return service.bulk_reassign(user, schemas.BulkReassign(lead_ids=lead_ids, owner_ids=owner_ids))


def test_leads_are_shared_in_turn():
    assert service.share_out(["1", "2", "3", "4", "5"], ["a", "b"]) == {"1": "a", "2": "b", "3": "a", "4": "b", "5": "a"}


def test_leads_move_with_their_open_work_and_history(setup):
    db = setup([person("a"), person("b")], [{"id": str(n), "owner_id": "x"} for n in range(1, 4)])
    assert run(["1", "2", "3"], ["a", "b"]) == {"reassigned": 3, "unchanged": 0, "missing": 0}
    updates = {(t, v["owner_id"], tuple(ids)) for t, op, v, ids in db.writes if op == "update"}
    assert ("leads", "a", ("1", "3")) in updates and ("leads", "b", ("2",)) in updates
    assert {t for t, *_ in db.writes} == {"leads", "tasks", "meetings", "activities"}
    history = [row for t, op, rows, _ in db.writes if t == "activities" for row in rows]
    assert [(h["lead_id"], h["meta"]["to"]) for h in history] == [("1", "a"), ("3", "a"), ("2", "b")]


def test_unchanged_and_missing_leads_are_counted_not_written(setup):
    db = setup([person("a")], [{"id": "1", "owner_id": "a"}])
    assert run(["1", "gone"], ["a"]) == {"reassigned": 0, "unchanged": 1, "missing": 1}
    assert db.writes == []


@pytest.mark.parametrize("bad", [person("b", role="finance"), person("b", active=False), None])
def test_one_unsuitable_person_stops_everything(setup, bad):
    db = setup([person("a")] + ([bad] if bad else []), [{"id": "1", "owner_id": "x"}])
    with pytest.raises(AppError):
        run(["1"], ["a", "b"])
    assert db.writes == []


KAM = Profile.model_construct(id="e", role=Role.KAM)


@pytest.mark.parametrize("role", [Role.FINANCE])
def test_other_roles_cannot_reassign(setup, role):
    db = setup([person("a")], [])
    with pytest.raises(ForbiddenError):
        run(["1"], ["a"], Profile.model_construct(id="k", role=role))
    assert db.writes == []


def test_a_kam_assigns_their_own_leads(setup):
    setup([person("a")], [{"id": "1", "owner_id": "e"}])
    assert run(["1"], ["a"], KAM)["reassigned"] == 1


def test_a_kam_cannot_move_someone_elses_lead(setup):
    db = setup([person("a")], [{"id": "1", "owner_id": "x"}])
    with pytest.raises(ForbiddenError):
        run(["1"], ["a"], KAM)
    assert db.writes == []
