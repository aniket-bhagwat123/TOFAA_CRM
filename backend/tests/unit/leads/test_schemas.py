import pytest
from pydantic import ValidationError

from src.modules.leads.schemas import LeadCreate, StageMove


def lead(**over):
    return LeadCreate.model_validate({"companyName": "Acme", "contactName": "Asha", "phone": "9876543210", **over})


def test_three_mandatory_fields_are_enough():
    assert lead().company_name == "Acme"
    assert lead(phone=None, email="a@b.co").email == "a@b.co"


def test_needs_phone_or_email():
    with pytest.raises(ValidationError):
        lead(phone=None)


@pytest.mark.parametrize("field", ["companyName", "contactName"])
def test_blank_required_fields_rejected(field):
    with pytest.raises(ValidationError):
        lead(**{field: "   "})


def test_blank_optional_values_become_none():
    assert lead(email="", city=" ").email is None


def test_bad_value_band():
    with pytest.raises(ValidationError):
        lead(valueBand="huge")


def test_stage_move_validates_stage_and_reason():
    assert StageMove.model_validate({"stage": "connected"}).stage == "connected"
    with pytest.raises(ValidationError):
        StageMove.model_validate({"stage": "nope"})
    with pytest.raises(ValidationError):
        StageMove.model_validate({"stage": "closed_lost", "lostReason": "Because"})
