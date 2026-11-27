"""Order stages, who may move an order where, and the money. Pure: no database."""
from decimal import Decimal

from src.core.money import to_money

# new (draft) -> ready (released to OMS) -> accepted -> production -> quality_check -> packed -> dispatched -> delivered
FLOW = ["new", "ready", "accepted", "production", "quality_check", "packed", "dispatched", "delivered"]
STATUSES = [*FLOW, "rejected", "on_hold", "cancelled"]
LABEL = {
    "new": "Not started", "ready": "Ready for OMS", "accepted": "Accepted", "rejected": "Rejected", "production": "Production",
    "quality_check": "Quality check", "packed": "Packed", "dispatched": "Dispatched", "delivered": "Delivered",
    "on_hold": "On hold", "cancelled": "Cancelled",
}
ITEMS_LOCKED = {"accepted", "production", "quality_check", "packed", "dispatched", "delivered", "cancelled"}  # being made, or over
DELIVERY_LOCKED = {"dispatched", "delivered", "cancelled"}
DELETABLE = {"new", "ready", "rejected", "cancelled"}  # an order being fulfilled is cancelled first

# What the order management system may do: one step at a time, in order.
OMS_MOVES = {
    "ready": {"accepted", "rejected"},
    "accepted": {"production", "on_hold"},
    "production": {"quality_check", "on_hold"},
    "quality_check": {"packed", "production", "on_hold"},  # production again: the check failed
    "packed": {"dispatched", "on_hold"},
    "dispatched": {"delivered"},
}


def crm_moves(current: str, held_from: str | None = None) -> list[str]:
    """Where a CRM user (KAM or admin) may take an order: any stage, to carry it through or correct a mistake, except
    that a cancelled order only reopens as a draft and a delivered one cannot be cancelled."""
    if current == "cancelled":
        return ["new"]
    blocked = {current} | ({"cancelled", "on_hold"} if current == "delivered" else set())
    return [s for s in STATUSES if s not in blocked]


def oms_moves(current: str, held_from: str | None = None) -> set[str]:
    if current == "on_hold":
        return {held_from} if held_from else set()
    return OMS_MOVES.get(current, set())


def missing_for_release(order: dict) -> list[str]:
    """What an order still needs before OMS can work on it."""
    out = []
    if not order.get("items"):
        out.append("at least one item")
    if not order.get("expected_delivery"):
        out.append("a delivery date")
    if not (order.get("delivery_address") or "").strip():
        out.append("a delivery address")
    return out


def status_patch(order: dict, status: str, now: str) -> dict:
    """The columns a stage change writes."""
    patch = {"status": status, "status_updated_at": now, "updated_at": now, "delivered_at": now if status == "delivered" else None}
    if status == "ready" and not order.get("released_at"):
        patch["released_at"] = now
    patch["held_from"] = order.get("status") if status == "on_hold" else None
    return patch


def money(items: list[dict], transportation, gst_rate) -> dict:
    """Each line's amount, GST and total, then the order's. GST is charged on the items plus transportation."""
    rate = Decimal(str(gst_rate or 0))
    lines = []
    for item in items:
        amount = to_money(Decimal(str(item["quantity"])) * Decimal(str(item["unit_price"])))
        gst = to_money(amount * rate / 100)
        lines.append({**item, "amount": float(amount), "gst_amount": float(gst), "line_total": float(amount + gst)})
    subtotal = to_money(sum((Decimal(str(x["amount"])) for x in lines), Decimal("0")))
    transport = to_money(Decimal(str(transportation or 0)))
    gst_amount = to_money((subtotal + transport) * rate / 100)
    return {
        "lines": lines, "units": float(sum((Decimal(str(x["quantity"])) for x in lines), Decimal("0"))),
        "subtotal": float(subtotal), "transportation": float(transport), "gst_rate": float(rate),
        "gst_amount": float(gst_amount), "total": float(subtotal + transport + gst_amount),
    }
