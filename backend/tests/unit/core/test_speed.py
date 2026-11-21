import threading
import time

import pytest

from src.core import cache
from src.core.parallel import bg, par
from src.modules.auth import service as auth_service
from src.modules.auth.schemas import Profile
from src.modules.tasks import service as tasks


@pytest.fixture(autouse=True)
def fresh_cache():
    cache.clear()
    yield
    cache.clear()


def counter():
    calls = []

    def loader():
        calls.append(1)
        return {"n": len(calls)}

    return calls, loader


# --- per-user results ---------------------------------------------------------------------------

def test_memo_serves_the_second_read_from_memory():
    calls, loader = counter()
    a = cache.memo("today", "u1", None, 20, loader)
    b = cache.memo("today", "u1", None, 20, loader)
    assert a == b and len(calls) == 1


def test_memo_is_per_user_and_per_parameters():
    calls, loader = counter()
    cache.memo("leads", "u1", {"page": 1}, 20, loader)
    cache.memo("leads", "u2", {"page": 1}, 20, loader)
    cache.memo("leads", "u1", {"page": 2}, 20, loader)
    assert len(calls) == 3


def test_a_write_makes_cached_results_unusable():
    calls, loader = counter()
    cache.memo("today", "u1", None, 20, loader)
    cache.bump()  # what the middleware does after any successful POST/PATCH
    cache.memo("today", "u1", None, 20, loader)
    assert len(calls) == 2


def test_result_loaded_while_a_write_lands_is_not_cached():
    calls = []

    def loader():
        calls.append(1)
        cache.bump()  # a write happens mid-load, so this result may already be stale
        return "maybe stale"

    cache.memo("x", "u1", None, 20, loader)
    cache.memo("x", "u1", None, 20, loader)
    assert len(calls) == 2


def test_memo_expires():
    calls, loader = counter()
    cache.memo("x", "u1", None, 0.05, loader)
    time.sleep(0.08)
    cache.memo("x", "u1", None, 0.05, loader)
    assert len(calls) == 2


# --- reference data -------------------------------------------------------------------------------

def test_reference_survives_writes_until_invalidated():
    calls, loader = counter()
    cache.reference("stages", "meta", 300, loader)
    cache.bump()
    cache.reference("stages", "meta", 300, loader)
    assert len(calls) == 1
    cache.invalidate_reference("stages")
    cache.reference("stages", "meta", 300, loader)
    assert len(calls) == 2


def test_profile_is_cached_between_requests(monkeypatch):
    loads = []
    monkeypatch.setattr(auth_service, "_load_profile", lambda uid: loads.append(uid) or Profile(id=uid, role="sales_executive"))
    for _ in range(5):
        auth_service.get_profile("u1")
    assert loads == ["u1"]
    cache.invalidate_reference("profile", "u1")
    auth_service.get_profile("u1")
    assert loads == ["u1", "u1"]


# --- parallel ----------------------------------------------------------------------------------------

def test_par_overlaps_slow_calls_and_keeps_order():
    def slow(v):
        return lambda: (time.sleep(0.15), v)[1]

    start = time.perf_counter()
    assert par(slow(1), slow(2), slow(3), slow(4)) == [1, 2, 3, 4]
    assert time.perf_counter() - start < 0.4  # four 150 ms calls would take 600 ms in a row


def test_par_raises_the_first_error():
    def boom():
        raise ValueError("nope")

    with pytest.raises(ValueError):
        par(lambda: 1, boom)


def test_bg_never_raises_to_the_caller():
    done = threading.Event()
    bg(lambda: (_ for _ in ()).throw(RuntimeError("audit down")))
    bg(done.set)
    assert done.wait(2)


# --- a write is one round trip ---------------------------------------------------------------------------

class FakeQuery:
    def __init__(self, log, table):
        self.log, self.table, self.op, self.filters = log, table, None, []

    def update(self, row):
        self.op = ("update", row)
        return self

    def insert(self, row):
        self.op = ("insert", row)
        return self

    def __getattr__(self, name):  # eq, is_, in_, neq ... all just record the filter
        if name == "not_":
            return self
        return lambda *a, **k: (self.filters.append((name, a)), self)[1]

    def execute(self):
        self.log.append((self.table, self.op[0], self.op[1], self.filters))
        return type("R", (), {"data": [self.op[1]]})()


def test_set_next_action_never_closes_its_own_new_task(monkeypatch):
    log = []
    db = type("Db", (), {"table": lambda self, t: FakeQuery(log, t)})()
    monkeypatch.setattr(tasks, "get_service_client", lambda: db)
    task = tasks.set_next_action("lead-1", "owner-1", __import__("datetime").date(2026, 11, 23), keep=("other",))
    assert sorted((t, op) for t, op, *_ in log) == [("leads", "update"), ("tasks", "insert"), ("tasks", "update")]
    supersede = next(f for t, op, _, f in log if t == "tasks" and op == "update")
    excluded = next(a for name, a in supersede if name == "in_")
    assert task["id"] in excluded[1] and "other" in excluded[1]
