"""Who may see which leads. Services call these because the service-role client bypasses RLS.

Executives: own leads. Managers and Admin: everything, whoever added it (a manager's reach is set by the modules
their role has, not by whose data it is).
KAM (key account manager): what they own: their client accounts, those accounts' projects and follow-ups
(orders for their accounts are scoped by account in orders.service). Finance has no lead access.
"""
from src.core.cache import reference
from src.core.errors import ForbiddenError
from src.core.supabase import get_service_client
from src.modules.auth.schemas import Profile, Role

LEAD_ROLES = {Role.ADMIN, Role.SALES_MANAGER, Role.SALES_EXECUTIVE, Role.KAM}
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
    if user.role in (Role.ADMIN, Role.SALES_MANAGER):
        return None  # all data, like the Superadmin
    return [user.id]


def can_access_owner(user: Profile, owner_id: str | None) -> bool:
    ids = visible_owner_ids(user)
    return ids is None or owner_id in ids


def assert_can_access_lead(user: Profile, lead: dict) -> None:
    if not can_access_owner(user, lead.get("owner_id")):
        raise ForbiddenError("This lead belongs to someone else.")
