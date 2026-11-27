"""Excel/CSV import: parse -> (client maps columns) -> preview with validation and duplicates -> commit."""
import csv
import io
import re
from collections import defaultdict


from src.core.access import ASSIGN_ROLES, require_lead_role, visible_owner_ids
from src.core.audit import write_audit
from src.core.dates import next_business_day
from src.core.errors import AppError, ForbiddenError
from src.core.keys import company_key, email_key, normalize_phone10, phone_key
from src.core.validators import is_email
from src.core.supabase import get_service_client
from src.core.soft_delete import live
from src.modules.auth.schemas import Profile
from src.modules.imports.schemas import MAX_ROWS, CommitRequest, ImportRequest, ImportRow
from src.modules.leads.stages import VALUE_BANDS

CHUNK = 100
BAND_ALIASES = {  # compared after removing spaces and the rupee sign, and turning dashes into "-"
    "under_1l": ["under1l", "<1l", "below1l"],
    "1_5l": ["1-5l", "1to5l", "1_5l"],
    "5_20l": ["5-20l", "5to20l", "5_20l"],
    "20l_plus": ["20l+", "20lplus", "above20l", "20l_plus"],
}


# --- parsing -------------------------------------------------------------------------------------

def parse_file(filename: str, content: bytes) -> dict:
    name = (filename or "").lower()
    if name.endswith(".xls"):
        headers, rows = _parse_xls(content)
    elif name.endswith(".xlsx"):
        headers, rows = _parse_xlsx(content)
    elif name.endswith(".csv"):
        headers, rows = _parse_csv(content)
    else:
        raise AppError("Upload a .csv, .xlsx or .xls file.", status_code=422)
    if not headers:
        raise AppError("The file has no header row.", status_code=422)
    if len(rows) > MAX_ROWS:
        raise AppError(f"Import up to {MAX_ROWS} rows at a time. This file has {len(rows)}.", status_code=422)
    return {"headers": headers, "rows": rows, "total": len(rows)}


def _clean(v) -> str:
    return "" if v is None else str(v).strip()


def _parse_csv(content: bytes) -> tuple[list[str], list[dict]]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    reader = csv.reader(io.StringIO(text))
    return _rows_to_dicts(list(reader))


def _parse_xlsx(content: bytes) -> tuple[list[str], list[dict]]:
    from openpyxl import load_workbook

    try:
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001 - corrupt or not really an xlsx
        raise AppError("Could not read that Excel file.", status_code=422) from exc
    return _rows_to_dicts([list(r) for r in wb.worksheets[0].iter_rows(values_only=True)])


def _rows_to_dicts(rows: list[list]) -> tuple[list[str], list[dict]]:
    rows = [r for r in rows if any(_clean(c) for c in r)]
    if not rows:
        return [], []
    headers, seen = [], defaultdict(int)
    for i, h in enumerate(rows[0]):
        h = _clean(h) or f"Column {i + 1}"
        seen[h] += 1
        headers.append(h if seen[h] == 1 else f"{h} ({seen[h]})")
    out = [{h: _clean(r[i]) if i < len(r) else "" for i, h in enumerate(headers)} for r in rows[1:]]
    return headers, out


# --- validation ---------------------------------------------------------------------------------------

def _band(raw: str | None) -> str | None:
    v = re.sub(r"\s+", "", (raw or "").lower()).replace("₹", "").replace("–", "-").replace("—", "-")
    if not v:
        return None
    if v in VALUE_BANDS:
        return v
    for band, aliases in BAND_ALIASES.items():
        if v in aliases:
            return band
    return None


def _normalise(row: ImportRow) -> tuple[dict, list[str]]:
    errors: list[str] = []
    clean = {k: (getattr(row, k) or "").strip() or None for k in ImportRow.model_fields}
    if not clean["company_name"]:
        errors.append("Company name is missing")
    if not clean["contact_name"]:
        errors.append("Contact name is missing")
    if not clean["phone"] and not clean["email"]:
        errors.append("Phone or email is needed")
    if clean["phone"]:
        number = normalize_phone10(clean["phone"])
        if number:
            clean["phone"] = number  # stored as the plain 10 digits
        else:
            errors.append("Mobile number must be 10 digits")
    if clean["email"]:
        if is_email(clean["email"]):
            clean["email"] = clean["email"].lower()
        else:
            errors.append("Email looks wrong")
    if clean["value_band"]:
        band = _band(clean["value_band"])
        if band is None:
            errors.append("Value band not recognised (use under ₹1L, ₹1–5L, ₹5–20L, ₹20L+)")
        clean["value_band"] = band
    return clean, errors


def _chunks(items: list, n: int = CHUNK):
    for i in range(0, len(items), n):
        yield items[i : i + n]


def _existing(clean_rows: list[dict]) -> tuple[dict, dict, dict]:
    """Look up existing phones, emails and companies in a few batched queries. Returns key -> company_id maps."""
    db = get_service_client()
    phones = list({phone_key(r["phone"]) for r in clean_rows if phone_key(r["phone"])})
    emails = list({email_key(r["email"]) for r in clean_rows if email_key(r["email"])})
    names = list({company_key(r["company_name"]) for r in clean_rows if company_key(r["company_name"])})
    by_phone, by_email, by_name = {}, {}, {}
    for part in _chunks(phones):
        for c in db.table("contacts").select("company_id,phone_key").in_("phone_key", part).execute().data:
            by_phone[c["phone_key"]] = c["company_id"]
    for part in _chunks(emails):
        for c in db.table("contacts").select("company_id,email_key").in_("email_key", part).execute().data:
            by_email[c["email_key"]] = c["company_id"]
    for part in _chunks(names):
        for c in live(db.table("companies").select("id,name_key"), "companies").in_("name_key", part).execute().data:
            by_name[c["name_key"]] = c["id"]
    return by_phone, by_email, by_name


def _leads_by_company(company_ids: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for part in _chunks(company_ids):
        rows = (
            live(get_service_client().table("leads")
            .select("id,owner_id,stage,company_id,contact_id,source,notes,owner:profiles!owner_id(full_name)"))
            .in_("company_id", part).order("created_at", desc=True).execute().data
        )
        for r in rows:
            out.setdefault(r["company_id"], r)  # newest lead per company
    return out


def _analyse(user: Profile, rows: list[ImportRow]) -> list[dict]:
    require_lead_role(user)
    analysed = []
    clean_rows = []
    for i, row in enumerate(rows):
        clean, errors = _normalise(row)
        analysed.append({"row": i + 1, "data": clean, "errors": errors, "duplicate": None})
        clean_rows.append(clean)
    by_phone, by_email, by_name = _existing(clean_rows)
    leads_by_company = _leads_by_company(list({*by_phone.values(), *by_email.values(), *by_name.values()}))
    visible = visible_owner_ids(user)

    seen: dict[str, int] = {}
    for item in analysed:
        if item["errors"]:
            continue
        d = item["data"]
        matched, company_id = [], None
        for reason, key, index in (
            ("phone", phone_key(d["phone"]), by_phone),
            ("email", email_key(d["email"]), by_email),
            ("company", company_key(d["company_name"]), by_name),
        ):
            if key and key in index:
                matched.append(reason)
                company_id = company_id or index[key]
        if matched:
            lead = leads_by_company.get(company_id)
            item["duplicate"] = {
                "matchedOn": matched,
                "existingLeadId": lead["id"] if lead else None,
                "ownerName": ((lead or {}).get("owner") or {}).get("full_name"),
                "stage": (lead or {}).get("stage"),
                "canMerge": bool(lead) and (visible is None or lead["owner_id"] in visible),
                "inFile": False,
            }
            item["_lead"] = lead
            continue
        # duplicates inside the file itself: later rows lose to the first
        for key in filter(None, (phone_key(d["phone"]), email_key(d["email"]), company_key(d["company_name"]))):
            if key in seen:
                item["duplicate"] = {"matchedOn": ["file"], "existingLeadId": None, "ownerName": None, "stage": None, "canMerge": False, "inFile": True, "firstRow": seen[key]}
                break
        if not item["duplicate"]:
            for key in filter(None, (phone_key(d["phone"]), email_key(d["email"]), company_key(d["company_name"]))):
                seen[key] = item["row"]
    return analysed


def preview(user: Profile, body: ImportRequest) -> dict:
    analysed = _analyse(user, body.rows)
    for a in analysed:
        a.pop("_lead", None)
    invalid = sum(1 for a in analysed if a["errors"])
    dupes = sum(1 for a in analysed if a["duplicate"])
    return {
        "rows": analysed,
        "summary": {"total": len(analysed), "valid": len(analysed) - invalid - dupes, "invalid": invalid, "duplicates": dupes},
    }


# --- commit ----------------------------------------------------------------------------------------------

def commit(user: Profile, body: CommitRequest) -> dict:
    owner_id = user.id
    if body.owner_id and body.owner_id != user.id:
        if user.role not in ASSIGN_ROLES:
            raise ForbiddenError("You can only import leads for yourself.")
        owner_id = body.owner_id

    analysed = _analyse(user, body.rows)
    db = get_service_client()
    fresh = [a for a in analysed if not a["errors"] and not a["duplicate"]]
    result = {"created": 0, "merged": 0, "skippedDuplicates": 0, "invalid": sum(1 for a in analysed if a["errors"])}

    due = next_business_day().isoformat()
    for part in _chunks(fresh, 50):
        companies = db.table("companies").insert(
            [{"name": a["data"]["company_name"], "name_key": company_key(a["data"]["company_name"]), "city": a["data"]["city"], "created_by": user.id} for a in part]
        ).execute().data
        contacts = db.table("contacts").insert(
            [
                {
                    "company_id": c["id"], "name": a["data"]["contact_name"], "designation": a["data"]["designation"],
                    "phone": a["data"]["phone"], "phone_key": phone_key(a["data"]["phone"]),
                    "email": a["data"]["email"], "email_key": email_key(a["data"]["email"]),
                }
                for a, c in zip(part, companies)
            ]
        ).execute().data
        leads = db.table("leads").insert(
            [
                {
                    "company_id": c["id"], "contact_id": k["id"], "owner_id": owner_id, "stage": "new_lead",
                    "source": a["data"]["source"] or "Excel import", "value_band": a["data"]["value_band"],
                    "notes": a["data"]["notes"], "next_follow_up": due, "created_by": user.id,
                }
                for a, c, k in zip(part, companies, contacts)
            ]
        ).execute().data
        db.table("tasks").insert(
            [{"lead_id": lead["id"], "owner_id": owner_id, "kind": "follow_up", "title": "First follow-up", "due_date": due} for lead in leads]
        ).execute()
        db.table("activities").insert(
            [{"lead_id": lead["id"], "actor_id": user.id, "kind": "import", "note": "Imported from spreadsheet"} for lead in leads]
        ).execute()
        result["created"] += len(leads)

    for a in analysed:
        dup = a["duplicate"]
        if not dup:
            continue
        if body.on_duplicate == "merge" and dup["canMerge"] and a.get("_lead"):
            _merge(a["_lead"], a["data"])
            result["merged"] += 1
        else:
            result["skippedDuplicates"] += 1
    write_audit(user.id, "import", "leads", None, result)
    return result


def _merge(lead: dict, data: dict) -> None:
    """Fill gaps on the existing lead and contact. Never overwrites what is already there."""
    db = get_service_client()
    patch = {}
    if not lead.get("source") and data["source"]:
        patch["source"] = data["source"]
    if data["notes"]:
        patch["notes"] = f"{lead['notes']}\n{data['notes']}" if lead.get("notes") else data["notes"]
    if patch:
        db.table("leads").update(patch).eq("id", lead["id"]).execute()
    contact = db.table("contacts").select("*").eq("id", lead["contact_id"]).limit(1).execute().data[0]
    cpatch = {}
    for field, key_fn, key_col in (("phone", phone_key, "phone_key"), ("email", email_key, "email_key")):
        if not contact.get(field) and data[field]:
            cpatch[field], cpatch[key_col] = data[field], key_fn(data[field])
    if not contact.get("designation") and data["designation"]:
        cpatch["designation"] = data["designation"]
    if cpatch:
        db.table("contacts").update(cpatch).eq("id", contact["id"]).execute()


def _parse_xls(content: bytes) -> tuple[list[str], list[dict]]:
    """Older Excel files (.xls)."""
    import xlrd

    try:
        book = xlrd.open_workbook(file_contents=content)
    except Exception as exc:  # noqa: BLE001 - corrupt or not really an xls
        raise AppError("Could not read that Excel file.", status_code=422) from exc
    sheet = book.sheet_by_index(0)
    rows = []
    for r in range(sheet.nrows):
        row = []
        for c in range(sheet.ncols):
            cell = sheet.cell(r, c)
            v = cell.value
            if cell.ctype == xlrd.XL_CELL_NUMBER and float(v).is_integer():
                v = int(v)  # phone numbers come through as 9876543210, not 9876543210.0
            row.append(v)
        rows.append(row)
    return _rows_to_dicts(rows)
