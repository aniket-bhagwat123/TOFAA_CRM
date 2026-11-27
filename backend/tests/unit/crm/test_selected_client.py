"""The client a KAM picks in the header narrows what they see, and only managers and admins assign clients."""
import pytest

from src.core import cache, selected_client as header
from src.core.errors import ForbiddenError
from src.modules.auth.schemas import Profile, Role
from src.modules.clients import service as clients
from src.modules.people import service as people

KAM = Profile.model_construct(id="k", role=Role.KAM)
MANAGER = Profile.model_construct(id="m", role=Role.SALES_MANAGER)
MINE = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"


@pytest.fixture
def pick():
    tokens = []

    def make(client_id):
        tokens.append(header._current.set(client_id))
    yield make
    for token in reversed(tokens):
        header._current.reset(token)


def test_only_a_real_id_is_accepted():
    assert header.parse(MINE) == MINE
    assert header.parse("x),id.neq.(y") is None and header.parse("") is None


def test_a_kam_and_an_admin_are_narrowed(pick):
    admin = Profile.model_construct(id="a", role=Role.ADMIN)
    assert people.company_scope(admin) is None  # "All clients"
    pick(MINE)
    assert header.selected_client(KAM) == MINE
    assert people.company_scope(admin) == [MINE]
    assert header.selected_client(MANAGER) is None


def test_the_pick_never_widens_a_kams_clients(monkeypatch, pick):
    monkeypatch.setattr(cache, "memo", lambda *a: [MINE])
    pick(MINE)
    assert people.company_scope(KAM) == [MINE]
    pick(OTHER)  # someone else's client: nothing, not theirs
    assert people.company_scope(KAM) == []
    assert people.company_scope(MANAGER) is None  # sales managers work every client


def test_a_kam_cannot_assign_clients():
    with pytest.raises(ForbiddenError):
        clients._assignable_kam(KAM, "someone")
