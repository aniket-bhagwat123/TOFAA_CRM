import pytest
from pydantic import ValidationError

from src.core.errors import AppError
from src.core.keys import normalize_phone10
from src.core.validators import clean_email, clean_phone, is_email
from src.modules.auth.service import normalize_identifier
from src.modules.leads.schemas import LeadCreate, LeadUpdate
from src.modules.users.schemas import UserCreate


@pytest.mark.parametrize(
    "raw",
    ["9876543210", "98765 43210", "(650) 555-0842", "+91 98765 43210", "919876543210", "09876543210", "98765-43210"],
)
def test_ten_digit_mobiles_are_accepted_in_any_common_format(raw):
    assert len(normalize_phone10(raw)) == 10


@pytest.mark.parametrize("raw", ["", "12345", "987654321", "98765432101", "+1 650 555 0842 99", "abcdefghij", "12345678901234"])
def test_anything_else_is_not_a_ten_digit_mobile(raw):
    assert normalize_phone10(raw) is None


def test_the_same_number_in_different_formats_is_one_number():
    assert normalize_phone10("+91 98765 43210") == normalize_phone10("09876543210") == "9876543210"


@pytest.mark.parametrize(
    "email",
    ["maya.patel@mailinator.com", "test@test.com", "test@example.com", "a@b.test", "user+tag@gmail.com", "Test.User@Example.ORG", "first.last@sub.domain.co.in", "x@y.z"],
)
def test_any_normal_looking_email_is_accepted_including_test_addresses(email):
    assert is_email(email)
    assert clean_email(email) == email.lower()


@pytest.mark.parametrize("email", ["test", "test@", "@test.com", "test@test", "a b@c.com", "a@@b.com"])
def test_obviously_broken_emails_are_rejected(email):
    assert not is_email(email)
    with pytest.raises(ValueError):
        clean_email(email)


def test_blank_email_and_phone_mean_not_given():
    assert clean_email("  ") is None and clean_phone("") is None


def lead(**over):
    return {"companyName": "Acme", "contactName": "Asha", **over}


def test_lead_form_enforces_both_rules():
    ok = LeadCreate.model_validate(lead(phone="+91 98765 43210", email="Test@Test.test"))
    assert ok.phone == "9876543210" and ok.email == "test@test.test"
    with pytest.raises(ValidationError):
        LeadCreate.model_validate(lead(phone="12345"))
    with pytest.raises(ValidationError):
        LeadCreate.model_validate(lead(email="nope"))


def test_editing_a_lead_enforces_both_rules():
    assert LeadUpdate.model_validate({"version": 1, "phone": "9876543210", "email": "a@b.test"}).phone == "9876543210"
    with pytest.raises(ValidationError):
        LeadUpdate.model_validate({"version": 1, "phone": "98765"})


def test_new_user_mobile_must_be_ten_digits():
    base = {"fullName": "A", "email": "a@b.co", "password": "Tofaa2026x"}
    assert UserCreate.model_validate({**base, "phone": "98765 43210"}).phone == "9876543210"
    with pytest.raises(ValidationError):
        UserCreate.model_validate({**base, "phone": "98765"})


def test_sign_in_identifier_accepts_email_or_ten_digit_mobile():
    assert normalize_identifier("Test@Test.test") == ("email", "test@test.test")
    assert normalize_identifier("98765 43210") == ("phone", "+919876543210")
    assert normalize_identifier("+91-98765-43210") == ("phone", "+919876543210")
    for bad in ("12345", "98765432", "not an email@"):
        with pytest.raises(AppError):
            normalize_identifier(bad)
