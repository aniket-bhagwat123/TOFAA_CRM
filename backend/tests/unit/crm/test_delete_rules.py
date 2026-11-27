"""What may not be deleted: sent quotations, payments with money in them, and users with work. No real database."""
import pytest

from src.core.errors import AppError, ConflictError, ForbiddenError
from src.modules.auth.schemas import Profile, Role
from src.modules.payments import service as payments
from src.modules.quotations import service as quotations
from src.modules.users import service as users

ADMIN = Profile.model_construct(id="a", role=Role.ADMIN)
KAM = Profile.model_construct(id="k", role=Role.KAM)


def test_a_sent_quotation_is_kept(monkeypatch):
    monkeypatch.setattr(quotations, "_load", lambda user, qid: ({"status": "sent", "sent_at": "2026-11-01"}, {}, [], []))
    monkeypatch.setattr(quotations, "get_service_client", lambda: pytest.fail("nothing may be written"))
    with pytest.raises(ConflictError):
        quotations.delete_quotation(ADMIN, "q1")


@pytest.mark.parametrize("status,paid", [("partial", 100), ("confirmed", 1000), ("requested", 1)])
def test_a_payment_with_money_is_kept(monkeypatch, status, paid):
    monkeypatch.setattr(payments, "_load", lambda **kw: {"status": status, "amount_paid": paid})
    monkeypatch.setattr(payments, "get_service_client", lambda: pytest.fail("nothing may be written"))
    with pytest.raises(AppError):
        payments.delete_request(ADMIN, "p1")


def test_only_finance_or_admin_deletes_a_payment_request():
    with pytest.raises(ForbiddenError):
        payments.delete_request(KAM, "p1")


def test_only_an_admin_deletes_users_and_never_themselves():
    with pytest.raises(ForbiddenError):
        users.delete_user(KAM, "x")
    with pytest.raises(AppError):
        users.delete_user(ADMIN, "a")
