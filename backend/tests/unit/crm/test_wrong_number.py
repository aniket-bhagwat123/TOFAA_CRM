import pytest

from src.core.errors import AppError
from src.modules.activities import service
from src.modules.activities.schemas import CallLog


class FakeTable:
    def __init__(self, sink):
        self.sink = sink

    def update(self, patch):
        self.sink.append(patch)
        return self

    def eq(self, *_):
        return self

    def execute(self):
        return self


class FakeDb:
    def __init__(self):
        self.updates = []

    def table(self, _name):
        return FakeTable(self.updates)


@pytest.fixture
def db(monkeypatch):
    fake = FakeDb()
    monkeypatch.setattr(service, "get_service_client", lambda: fake)
    return fake


LEAD = {"contact_id": "c1", "contact": {"name": "Rohan", "phone": "9799329339", "alt_phone": None}}


def test_new_number_becomes_main_and_old_becomes_second(db):
    body = CallLog(outcome="wrong_contact", new_phone="+91 98765 43210")
    assert service._switch_number(LEAD, body) == ("9876543210", "9799329339", None, None)
    assert db.updates == [{"phone": "9876543210", "phone_key": "9876543210", "alt_phone": "9799329339", "alt_phone_key": "9799329339", "alt_name": "Rohan"}]


@pytest.mark.parametrize("bad", ["12345", "abc", "97993 29339"])
def test_bad_or_same_number_is_refused_before_anything_is_saved(db, bad):
    with pytest.raises(AppError):
        service._switch_number(LEAD, CallLog(outcome="wrong_contact", new_phone=bad))
    assert db.updates == []


def test_a_full_name_renames_the_contact(db):
    body = CallLog(outcome="wrong_contact", new_phone="9876543210", new_name="  Priya   Shah ")
    assert service._switch_number(LEAD, body) == ("9876543210", "9799329339", "Priya Shah", "Rohan")
    assert db.updates[0]["name"] == "Priya Shah"


def test_the_same_name_is_not_a_change(db):
    body = CallLog(outcome="wrong_contact", new_phone="9876543210", new_name="Rohan")
    assert service._switch_number(LEAD, body)[2:] == (None, None)
    assert "name" not in db.updates[0]
