"""Snooze to a date and time the person picked: it must be later than now."""
from datetime import timedelta

import pytest

from src.core.dates import now_ist
from src.core.errors import AppError
from src.modules.auth.schemas import Profile, Role
from src.modules.tasks import service

KAM = Profile.model_construct(id="k", role=Role.KAM)


def test_a_picked_time_must_be_later_than_now(monkeypatch):
    class Query:
        def __getattr__(self, _):
            return lambda *a, **k: self

        def execute(self):
            return type("R", (), {"data": [{"id": "t", "owner_id": "k", "due_date": "2027-01-01"}]})()

    monkeypatch.setattr(service, "get_service_client", lambda: type("Db", (), {"table": lambda self, n: Query()})())
    monkeypatch.setattr(service, "can_access_owner", lambda *a: True)
    monkeypatch.setattr(service, "is_client_requested", lambda t: False)
    with pytest.raises(AppError) as error:
        service.snooze_task(KAM, "t", now_ist().date(), now_ist() - timedelta(minutes=1), None, "snooze", True)
    assert error.value.data["errors"][0]["field"] == "dueTime"
