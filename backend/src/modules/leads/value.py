"""What a deal is worth right now. The best figure we have wins: paid > quotation total > estimate > rough band."""
from decimal import Decimal

from src.core.money import BAND_MIDPOINT, to_money


def deal_value(lead: dict) -> float | None:
    for key in ("paid_amount", "quote_amount", "estimate_amount"):
        v = lead.get(key)
        if v:
            return float(to_money(v))
    band = BAND_MIDPOINT.get(lead.get("value_band") or "")
    return float(band) if band else None


def value_source(lead: dict) -> str | None:
    """Where the figure comes from, so the screen can say 'estimate' or 'quoted' honestly."""
    for key, label in (("paid_amount", "paid"), ("quote_amount", "quoted"), ("estimate_amount", "estimate")):
        if lead.get(key):
            return label
    return "rough band" if lead.get("value_band") else None


def decimal_value(lead: dict) -> Decimal:
    v = deal_value(lead)
    return to_money(v) if v else Decimal("0.00")
