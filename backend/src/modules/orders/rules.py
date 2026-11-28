"""Order stages, who may move an order where, and the money. Pure: no database."""
from decimal import Decimal

from src.core.money import to_money

# new (draft) -> ready (handover approved, or released) -> accepted -> production -> quality_check -> packed -> dispatched -> delivered
FLOW = ["new", "ready", "accepted", "production", "quality_check", "packed", "dispatched", "delivered"]
STATUSES = [*FLOW, "rejected", "on_hold", "cancelled"]
LABEL = {
    "new": "Not started", "ready": "Handover Approved", "accepted": "Accepted", "rejected": "Rejected", "production": "Production",
    "quality_check": "Quality check", "packed": "Packed", "dispatched": "Dispatched", "delivered": "Delivered",
    "on_hold": "On hold", "cancelled": "Cancelled",
}
ITEMS_LOCKED = {"accepted", "production", "quality_check", "packed", "dispatched", "delivered", "cancelled"}  # being made, or over
DELIVERY_LOCKED = {"dispatched", "delivered", "cancelled"}
DELETABLE = {"new", "ready", "rejected", "cancelled"}  # an order being fulfilled is cancelled first

def number(order: dict) -> str:
    """The number people see: the Deal number. Before migration 20261202100000 only the old ORD- number exists.
    (The `order_number` column stays as the internal key.)"""
    return order.get("deal_number") or order["order_number"]


def crm_moves(current: str, held_from: str | None = None) -> list[str]:
    """Where a CRM user (KAM or admin) may take an order: any stage, to carry it through or correct a mistake, except
    that a cancelled order only reopens as a draft and a delivered one cannot be cancelled."""
    if current == "cancelled":
        return ["new"]
    blocked = {current} | ({"cancelled", "on_hold"} if current == "delivered" else set())
    return [s for s in STATUSES if s not in blocked]


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


def priced_details(details: list[dict], quantity, rate: Decimal, amount: Decimal, gst: Decimal) -> list[dict]:
    """Each item's quantity, amount, GST and total, when every item has its own rate and together they make up the
    requirement's amount. Otherwise the items share one price and are returned as they are."""
    if any(d.get("unit_price") is None for d in details):
        return details
    pieces = [Decimal(str(quantity)) * Decimal(str(d.get("quantity_per_kit") or 1)) for d in details]
    amounts = [to_money(q * Decimal(str(d["unit_price"]))) for q, d in zip(pieces, details)]
    if abs(sum(amounts, Decimal("0")) - amount) > Decimal("1"):  # the requirement was repriced since
        return details
    taxes = [to_money(a * rate / 100) for a in amounts]
    taxes[-1] += gst - sum(taxes, Decimal("0"))  # rounding: the items add up to the requirement exactly
    return [{**d, "quantity": float(q), "amount": float(a), "gst_amount": float(t), "line_total": float(a + t)}
            for d, q, a, t in zip(details, pieces, amounts, taxes)]


def money(items: list[dict], transportation, gst_rate) -> dict:
    """Each line's amount, GST and total, then the order's. GST is charged on the items plus transportation."""
    rate = Decimal(str(gst_rate or 0))
    lines = []
    for item in items:
        amount = to_money(Decimal(str(item["quantity"])) * Decimal(str(item["unit_price"])))
        gst = to_money(amount * rate / 100)
        line = {**item, "amount": float(amount), "gst_amount": float(gst), "line_total": float(amount + gst)}
        if item.get("details"):
            line["details"] = priced_details(item["details"], item["quantity"], rate, amount, gst)
        lines.append(line)
    subtotal = to_money(sum((Decimal(str(x["amount"])) for x in lines), Decimal("0")))
    transport = to_money(Decimal(str(transportation or 0)))
    gst_amount = to_money((subtotal + transport) * rate / 100)
    return {
        "lines": lines, "units": float(sum((Decimal(str(x["quantity"])) for x in lines), Decimal("0"))),
        "subtotal": float(subtotal), "transportation": float(transport), "gst_rate": float(rate),
        "gst_amount": float(gst_amount), "total": float(subtotal + transport + gst_amount),
    }
