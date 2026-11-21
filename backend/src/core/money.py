"""Money in rupees. Decimal for arithmetic (never float), two decimal places."""
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

TWO = Decimal("0.01")


def to_money(value) -> Decimal:
    """A Decimal rounded to paise. Raises ValueError for anything that is not a finite number."""
    try:
        d = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError("Enter a valid amount.") from exc
    if not d.is_finite():
        raise ValueError("Enter a valid amount.")
    return d.quantize(TWO, rounding=ROUND_HALF_UP)


def indian_grouping(n: int) -> str:
    """1234567 -> 12,34,567 (lakh and crore grouping)."""
    s = str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts + [tail])
    return ("-" if n < 0 else "") + s


def format_inr(value, *, symbol: str = "₹", paise: bool = False) -> str:
    d = to_money(value)
    whole = int(d)
    text = indian_grouping(whole)
    if paise:
        text += f".{int((d - whole) * 100):02d}"
    return f"{symbol}{text}"


# Midpoints of the rough value bands, used only when nothing better is known about a deal.
BAND_MIDPOINT = {"under_1l": Decimal("50000"), "1_5l": Decimal("300000"), "5_20l": Decimal("1250000"), "20l_plus": Decimal("3000000")}
