"""Pure rules for People (tested without a database): the next occasion, the completeness score and the change diff."""
import calendar
from datetime import date

# Fields whose changes are kept in the history (recipient_audit).
TRACKED = (
    "name", "mobile_number", "email", "company_name", "designation", "department", "city", "date_of_birth", "anniversary_date",
    "budget", "birthday_budget", "anniversary_budget", "gifting_occasion", "remark", "relationship", "recipient_type", "status", "is_primary",
)


def _on(year: int, month: int, day: int) -> date:
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))  # 29 Feb -> 28 Feb in a common year


def next_date(d: date | str | None, today: date) -> date | None:
    """The next time a yearly date (birthday, anniversary) comes round, today included."""
    if not d:
        return None
    d = date.fromisoformat(str(d)[:10])
    this_year = _on(today.year, d.month, d.day)
    return this_year if this_year >= today else _on(today.year + 1, d.month, d.day)


def next_occasion(row: dict, today: date) -> dict | None:
    """The sooner of the birthday and the anniversary: {kind, label, date, days_away}."""
    found = []
    for kind, label, key in (("BIRTHDAY", "Birthday", "date_of_birth"), ("ANNIVERSARY", "Anniversary", "anniversary_date")):
        n = next_date(row.get(key), today)
        if n:
            found.append({"kind": kind, "label": label, "date": n.isoformat(), "days_away": (n - today).days})
    return min(found, key=lambda o: o["days_away"]) if found else None


# Sections of a complete profile and their weights (sum 100).
SECTIONS = [("basic", "Basic details", 30), ("relationships", "Relationships", 15), ("occasions", "Occasions", 20),
            ("preferences", "Preferences", 15), ("addresses", "Delivery address", 20)]


def completeness(row: dict, *, links: int, addresses: int, has_preferences: bool) -> dict:
    """How complete a person's profile is, by section, so the team knows what to ask for next."""
    basic_need = {"name": bool(row.get("name")), "contact": bool(row.get("mobile_number") or row.get("email")), "city": bool(row.get("city"))}
    if row.get("recipient_type") == "EXTERNAL":
        basic_need["company"] = bool(row.get("company_name"))
    sections = []
    total = 0.0
    for key, label, weight in SECTIONS:
        if key == "basic":
            missing = [k for k, v in basic_need.items() if not v]
            share = 1 - len(missing) / len(basic_need)
        elif key == "relationships":
            missing, share = ([] if links else ["relationship"]), (1.0 if links else 0.0)
        elif key == "occasions":
            has = bool(row.get("date_of_birth") or row.get("anniversary_date"))
            missing, share = ([] if has else ["birthday or anniversary"]), (1.0 if has else 0.0)
        elif key == "preferences":
            missing, share = ([] if has_preferences else ["gift preferences"]), (1.0 if has_preferences else 0.0)
        else:
            missing, share = ([] if addresses else ["delivery address"]), (1.0 if addresses else 0.0)
        total += weight * share
        sections.append({"key": key, "label": label, "percent": round(share * 100), "missing": missing})
    percent = round(total)
    return {"percent": percent, "sections": sections, "needs_attention": percent < 50}


def _norm(v):
    return None if v in ("", None) else str(v)


def diff(old: dict, new: dict) -> list[tuple[str, object, object]]:
    """(field, old, new) for every tracked field that changed."""
    return [(f, old.get(f), new.get(f)) for f in TRACKED if f in new and _norm(old.get(f)) != _norm(new.get(f))]
