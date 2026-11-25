"""People import, export and the import template. All three use the same columns, so an exported file can be edited
and imported again. Files are read with the CRM's existing reader (CSV, XLSX, XLS)."""
import csv
import io
import re
from datetime import date, datetime

from pydantic import ValidationError

from src.core.errors import AppError, ConflictError
from src.modules.auth.schemas import Profile
from src.modules.imports.service import parse_file
from src.modules.people import groups, schemas, service

# (column header, field). "*" marks a column the import needs.
COLUMNS = [
    ("Name*", "name"), ("Mobile Number*", "mobile_number"), ("Email", "email"), ("Designation", "designation"),
    ("Department", "department"), ("City", "city"), ("Relationship", "relationship"), ("Date of Birth", "date_of_birth"),
    ("Anniversary Date", "anniversary_date"), ("Budget", "budget"), ("Birthday Budget", "birthday_budget"),
    ("Anniversary Budget", "anniversary_budget"), ("Gifting Occasion", "gifting_occasion"), ("Address", "address_line1"),
    ("Pincode", "postal_code"), ("State", "state"), ("Group", "group"), ("Remark", "remark"),
]
HEADERS = [h for h, _ in COLUMNS]

# Other header names people use for the same column.
ALIASES = {
    "name": ["name", "full name", "recipient", "recipient name", "person", "employee name"],
    "mobile_number": ["mobile", "mobile number", "phone", "phone number", "contact", "contact number", "whatsapp"],
    "email": ["email", "email id", "e-mail", "mail"],
    "designation": ["designation", "title", "job title", "role"],
    "department": ["department", "dept", "team"],
    "city": ["city", "town", "location"],
    "relationship": ["relationship", "relation", "type"],
    "date_of_birth": ["date of birth", "dob", "birthday", "birth date"],
    "anniversary_date": ["anniversary date", "anniversary", "date of anniversary", "wedding anniversary"],
    "budget": ["budget", "gift budget"],
    "birthday_budget": ["birthday budget"],
    "anniversary_budget": ["anniversary budget"],
    "gifting_occasion": ["gifting occasion", "occasion"],
    "address_line1": ["address", "address line 1", "street", "delivery address"],
    "postal_code": ["pincode", "pin code", "pin", "postal code", "zip"],
    "state": ["state"],
    "group": ["group", "group name"],
    "remark": ["remark", "remarks", "note", "notes", "comment"],
}
RELATIONSHIPS = {"client", "employee", "partner", "advisor", "vendor", "family", "spouse", "child", "parent", "sibling", "friend", "other"}


def _key(header: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", (header or "").lower().replace("*", "")).strip()


def auto_map(headers: list[str]) -> dict[str, str]:
    """field -> the file's header for it, matched by name or a known alias."""
    by_key = {_key(h): h for h in headers}
    out = {}
    for field, names in ALIASES.items():
        for n in names:
            if n in by_key:
                out[field] = by_key[n]
                break
    return out


def parse_date(v: str) -> str | None:
    """A date from a spreadsheet cell: 2026-01-31, 31/01/2026, 31-01-2026, 31.01.2026, or an Excel date-time."""
    v = (v or "").strip()
    if not v:
        return None
    v = v.split(" ")[0] if re.match(r"^\d{4}-\d{2}-\d{2} ", v) else v
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%y", "%d-%b-%Y", "%d %b %Y"):
        try:
            return datetime.strptime(v, fmt).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f"'{v}' is not a date (use 31/01/1990)")


def _num(v: str) -> str | None:
    v = re.sub(r"[₹,\s]|Rs\.?", "", v or "")
    return v or None


def build(row: dict, mapping: dict[str, str], company_id: str) -> tuple[schemas.RecipientCreate | None, str | None, str | None]:
    """(create body, group name, problem) for one spreadsheet row."""
    get = lambda f: (row.get(mapping[f]) or "").strip() if f in mapping else ""  # noqa: E731
    if not get("name"):
        return None, None, "Name is missing"
    if not get("mobile_number"):
        return None, None, "Mobile number is missing"
    try:
        rel = get("relationship").lower()
        body = {
            "company_id": company_id, "name": get("name"), "mobile_number": get("mobile_number"),
            "email": get("email") or None, "designation": get("designation") or None, "department": get("department") or None,
            "city": get("city") or None, "relationship": rel.upper() if rel in RELATIONSHIPS else None,
            "date_of_birth": parse_date(get("date_of_birth")), "anniversary_date": parse_date(get("anniversary_date")),
            "budget": _num(get("budget")), "birthday_budget": _num(get("birthday_budget")), "anniversary_budget": _num(get("anniversary_budget")),
            "gifting_occasion": get("gifting_occasion") or None, "remark": get("remark") or None,
        }
        line, pin = get("address_line1"), re.sub(r"\D", "", get("postal_code"))
        if line and pin and (get("city")):
            body["address"] = {"label": "OFFICE", "address_line1": line, "city": get("city"), "postal_code": pin, "state": get("state") or None}
        return schemas.RecipientCreate(**body), get("group") or None, None
    except ValueError as exc:
        return None, None, str(exc)
    except ValidationError as exc:
        e = exc.errors()[0]
        where = " ".join(str(p) for p in e.get("loc", ()) if isinstance(p, str)).replace("_", " ")
        return None, None, f"{where.capitalize() + ': ' if where else ''}{e['msg'].removeprefix('Value error, ')}"


def import_file(user: Profile, company_id: str, filename: str, content: bytes) -> dict:
    """Create a person per valid row. Invalid rows and people already there are skipped with a reason, never stop the rest."""
    service.client_account(user, company_id)
    parsed = parse_file(filename, content)
    mapping = auto_map(parsed["headers"])
    if "name" not in mapping or "mobile_number" not in mapping:
        raise AppError("The file needs a Name column and a Mobile Number column. Download the template to see the columns.", status_code=422)
    created, skipped = 0, []
    by_group: dict[str, list[str]] = {}
    seen: set[str] = set()
    for n, row in enumerate(parsed["rows"], start=2):  # row 1 is the header
        body, group, problem = build(row, mapping, company_id)
        if problem:
            skipped.append({"row": n, "name": row.get(mapping.get("name", ""), ""), "reason": problem})
            continue
        key = re.sub(r"\D", "", body.mobile_number or "")[-10:]
        if key in seen:
            skipped.append({"row": n, "name": body.name, "reason": "Same mobile number as an earlier row in this file"})
            continue
        seen.add(key)
        try:
            person = service.create(user, body, source="IMPORT")
        except ConflictError as exc:
            dups = (exc.data or {}).get("duplicates") or []
            strong = [d for d in dups if {"SAME_MOBILE", "SAME_EMAIL"} & set(d.get("reasons", []))]
            if strong or not dups:  # the same mobile or email: this person is already there
                skipped.append({"row": n, "name": body.name, "reason": f"Already in this client's people ({strong[0]['name']})" if strong else exc.message})
                continue
            person = service.create(user, body.model_copy(update={"allow_duplicate": True}), source="IMPORT")  # only a similar name: a different person
        except AppError as exc:
            skipped.append({"row": n, "name": body.name, "reason": exc.message})
            continue
        created += 1
        if group:
            by_group.setdefault(group, []).append(person["id"])
    group_results = []
    if by_group:
        existing = {g["name"].lower(): g for g in groups.list_groups(user, company_id)}
        for name, ids in by_group.items():
            g = existing.get(name.lower())
            if g:
                groups.update(user, g["id"], schemas.GroupUpdate(add_recipient_ids=ids))
            else:
                groups.create(user, schemas.GroupIn(company_id=company_id, name=name, recipient_ids=ids))
            group_results.append({"name": name, "added": len(ids), "new": not g})
    return {"total": parsed["total"], "created": created, "skipped": skipped, "groups": group_results}


def _cells(p: dict) -> list:
    group = ", ".join(g["name"] for g in p.get("groups") or [])
    return [p.get("name"), p.get("mobile_number"), p.get("email"), p.get("designation"), p.get("department"), p.get("city"),
            (p.get("relationship") or "").capitalize() or None, p.get("date_of_birth"), p.get("anniversary_date"),
            p.get("budget"), p.get("birthday_budget"), p.get("anniversary_budget"), p.get("gifting_occasion"),
            None, None, None, group or None, p.get("remark")]


def _file(rows: list[list], fmt: str, name: str) -> tuple[bytes, str, str]:
    if fmt == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(HEADERS)
        w.writerows([["" if c is None else c for c in r] for r in rows])
        return buf.getvalue().encode("utf-8-sig"), "text/csv", f"{name}.csv"
    from openpyxl import Workbook
    from openpyxl.styles import Font

    wb = Workbook()
    ws = wb.active
    ws.title = "People"
    ws.append(HEADERS)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for r in rows:
        ws.append(["" if c is None else c for c in r])
    for col in ws.columns:
        ws.column_dimensions[col[0].column_letter].width = max(12, min(40, max(len(str(c.value or "")) for c in col) + 2))
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", f"{name}.xlsx"


def template(fmt: str) -> tuple[bytes, str, str]:
    example = ["Asha Mehta", "98765 43210", "asha@example.com", "HR Manager", "Human Resources", "Pune", "Employee", "14/02/1990",
               "", "2500", "", "", "Diwali", "601 Business Zone, Baner", "411045", "Maharashtra", "Leadership", ""]
    return _file([example], fmt, "people-import-template")


def export(user: Profile, fmt: str, **filters) -> tuple[bytes, str, str]:
    # page by page: the database returns at most 1,000 rows per request
    people, page, size = [], 1, 1000
    while True:
        data = service.list_people(user, page=page, limit=size, **filters)
        people += data["items"]
        if len(people) >= data["total"] or not data["items"] or len(people) >= service.MEMORY_LIMIT:
            break
        page += 1
    return _file([_cells(p) for p in people], fmt, f"people-{date.today().isoformat()}")
