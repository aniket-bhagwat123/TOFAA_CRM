"""One call for everything the lead card shows about the deal: value, minutes, quotations, agreement, payment."""
from src.core import cache
from src.core.access import require_lead_role
from src.core.parallel import par
from src.modules.agreements import service as agreements
from src.modules.auth.schemas import Profile
from src.modules.leads import service as leads
from src.modules.leads.value import deal_value, value_source
from src.modules.minutes import service as minutes
from src.modules.quotations import service as quotations
from src.modules.targets.service import discount_limit_for


def deal(user: Profile, lead_id: str) -> dict:
    require_lead_role(user)
    return cache.memo("deal", user.id, lead_id, 20, lambda: _build(user, lead_id))


def _build(user: Profile, lead_id: str) -> dict:
    lead = leads.get_lead_row(user, lead_id)  # access check first
    mom, quotes, agreement, limit = par(
        lambda: minutes.list_minutes(lead_id),
        lambda: quotations.list_quotations(lead_id),
        lambda: agreements.state(lead_id),
        lambda: discount_limit_for(lead["owner_id"]) if lead.get("owner_id") else 0,
    )
    return {
        "value": {"amount": deal_value(lead), "source": value_source(lead), "estimate": lead.get("estimate_amount"), "quoted": lead.get("quote_amount"), "paid": lead.get("paid_amount")},
        "minutes": mom, "quotations": quotes, "agreement": agreement, "discountLimit": float(limit),
    }
