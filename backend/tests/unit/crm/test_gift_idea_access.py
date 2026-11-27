"""Only an admin changes gift ideas: they show to every client."""
import pytest

from src.core.errors import ForbiddenError
from src.modules.auth.schemas import Profile, Role
from src.modules.os_modules import service


@pytest.mark.parametrize("role", [Role.KAM, Role.SALES_MANAGER, Role.FINANCE])
def test_only_an_admin_changes_gift_ideas(monkeypatch, role):
    monkeypatch.setattr(service, "_call", lambda *a, **k: pytest.fail("nothing may be sent"))
    with pytest.raises(ForbiddenError):
        service.write_idea(Profile.model_construct(id="u", role=role), "DELETE", "i")
