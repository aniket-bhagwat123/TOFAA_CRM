"""Who may see which leads. Services call these because the service-role client bypasses RLS.

Executives: own leads. Managers: themselves + the executives who report to them. Admin: everything.
Finance and KAM have no lead access in Phase 1.
"""
from src.core.cache import reference
from src.core.errors import ForbiddenError
from src.core.supabase import get_service_client
from src.modules.auth.schemas import Profile, Role

LEAD_ROLES = {Role.ADMIN, Role.SALES_MANAGER, Role.SALES_EXECUTIVE}
TEAM_TTL = 30  # seconds. User edits invalidate it immediately (see users.service).


def require_lead_role(user: Profile) -> None:
    if user.role not in LEAD_ROLES:
        raise ForbiddenError("Your role has no access to leads.")


def team_ids(user: Profile) -> list[str]:
    """The manager's own id plus everyone reporting to them."""

    def load() -> list[str]:
        rows = get_service_client().table("profiles").select("id").eq("manager_id", user.id).execute().data
        return [user.id, *[r["id"] for r in rows]]

    return reference("team", user.id, TEAM_TTL, load)


def visible_owner_ids(user: Profile) -> list[str] | None:
    """Owner ids whose leads the user may see. None means everyone (admin)."""
    require_lead_role(user)
    if user.role == Role.ADMIN:
        return None
    if user.role == Role.SALES_MANAGER:
        return team_ids(user)
    return [user.id]


def can_access_owner(user: Profile, owner_id: str | None) -> bool:
    ids = visible_owner_ids(user)
    return ids is None or owner_id in ids


def assert_can_access_lead(user: Profile, lead: dict) -> None:
    if not can_access_owner(user, lead.get("owner_id")):
        raise ForbiddenError("This lead belongs to someone else.")
