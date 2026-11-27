"""A KAM archives instead of deleting people and groups. (Banners: see test_people_banners.py.)"""
import pytest

from src.core.errors import ForbiddenError
from src.modules.auth.schemas import Profile, Role
from src.modules.people import groups, service as people

KAM = Profile.model_construct(id="k", role=Role.KAM)


@pytest.mark.parametrize("call", [
    lambda: people.delete(KAM, "p"), lambda: people.bulk_delete(KAM, ["p"]), lambda: groups.delete(KAM, "g"),
    lambda: groups.bulk_delete(KAM, ["g"]),
])
def test_a_kam_is_refused(call):
    with pytest.raises(ForbiddenError):
        call()


@pytest.mark.parametrize("role", [Role.ADMIN, Role.SALES_MANAGER])
def test_managers_and_admins_may_delete_people(role):
    people.require_delete(Profile.model_construct(id="x", role=role))


def test_gifting_os_users_keep_their_rights():
    actor = people.ExternalActor(id="gifting:c", role=Role.KAM, company_id="c", full_name="Asha")
    people.require_delete(actor)
