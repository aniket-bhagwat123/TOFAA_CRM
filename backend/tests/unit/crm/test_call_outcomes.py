"""The call sheet's buttons: what each one requires and what it changes on the lead."""
from datetime import date, datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from src.modules.activities import service
from src.modules.activities.schemas import CallLog, CallOutcome as O

TOMORROW = date.today() + timedelta(days=1)
MEETING = {"startsAt": datetime(2030, 1, 2, 11, 0, tzinfo=timezone.utc).isoformat(), "kind": "physical"}


def fields(**body) -> set[str]:
    return {e["field"] for e in service.check(CallLog.model_validate(body), open_lead=True)}


def test_the_six_buttons():
    assert [o.value for o in O] == [
        "not_reachable", "call_back_later", "future_requirement", "interested", "not_interested", "wrong_contact",
    ]
    with pytest.raises(ValidationError):
        CallLog.model_validate({"outcome": "connected"})  # the old names are gone
    for removed in ("no_requirement_now", "interested_no_requirement"):
        with pytest.raises(ValidationError):
            CallLog.model_validate({"outcome": removed})


@pytest.mark.parametrize("outcome", ["not_reachable", "call_back_later", "future_requirement"])
def test_these_need_a_next_date(outcome):
    assert fields(outcome=outcome) == {"nextFollowUp"}
    assert fields(outcome=outcome, nextFollowUp=TOMORROW.isoformat()) == set()


def test_interested_needs_a_meeting_not_a_date():
    assert fields(outcome="interested") == {"meeting"}
    assert fields(outcome="interested", meeting=MEETING) == set()


def test_not_interested_needs_a_listed_reason():
    assert fields(outcome="not_interested") == {"lostReason"}
    assert fields(outcome="not_interested", lostReason="Made up") == {"lostReason"}
    assert fields(outcome="not_interested", lostReason="No budget") == set()


def test_wrong_contact_needs_nothing_but_a_name_needs_a_number():
    assert fields(outcome="wrong_contact") == set()
    assert fields(outcome="wrong_contact", newName="Priya") == {"newPhone"}


def test_a_closed_lead_only_records_the_call():
    assert service.check(CallLog(outcome=O.INTERESTED), open_lead=False) == []


def test_which_buttons_move_the_lead():
    assert service.ADVANCES == {O.FUTURE_REQUIREMENT, O.INTERESTED}
    assert O.NOT_REACHABLE not in service.ADVANCES and O.CALL_BACK_LATER not in service.ADVANCES


def test_not_reachable_counts_attempts():
    patch = service.lead_patch({"call_attempts": 2}, O.NOT_REACHABLE, swapped=False, open_lead=True)
    assert patch["call_attempts"] == 3 and patch["last_call_outcome"] == "not_reachable"
    assert "call_attempts" not in service.lead_patch({}, O.CALL_BACK_LATER, swapped=False, open_lead=True)


def test_nurture_follows_the_latest_call():
    assert service.lead_patch({"tags": []}, O.FUTURE_REQUIREMENT, False, True)["tags"] == ["nurture"]
    assert "tags" not in service.lead_patch({"tags": ["nurture"]}, O.FUTURE_REQUIREMENT, False, True)  # already there
    for later in (O.INTERESTED, O.NOT_REACHABLE, O.CALL_BACK_LATER, O.NOT_INTERESTED, O.WRONG_CONTACT):
        assert service.lead_patch({"tags": ["nurture", "vip"]}, later, False, True)["tags"] == ["vip"]  # other tags are kept
    assert "tags" not in service.lead_patch({"tags": []}, O.FUTURE_REQUIREMENT, False, False)  # a closed lead gets no tag


def test_a_new_number_resets_the_status():
    patch = service.lead_patch({}, O.WRONG_CONTACT, swapped=True, open_lead=True)
    assert patch["last_call_outcome"] is None and patch["last_call_at"] is None


def test_call_back_later_is_flagged_client_requested():
    assert service.TASK[O.CALL_BACK_LATER] == ("Call back (client requested)", "call")
