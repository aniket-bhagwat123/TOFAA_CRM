"""Copy every person from TOFAA Gifting OS into the CRM, once. CRM becomes the master copy of People.

    # from TOFAA_CRM/backend, with the CRM environment (PYTHONPATH=.venv/Lib/site-packages;.)
    python scripts/copy_gifting_people.py --gifting-env ../../TOFAA_Gifting_OS/backend/.env --owner "Sanket Parbat"
    python scripts/copy_gifting_people.py ... --apply      # really write (without it: a dry run that writes nothing)

What it does (needs migration 20261126100000_gifting_os_people.sql in the CRM):
  1. Each Gifting OS client tenant (not the INTERNAL one) is linked to the CRM client account with the same name
     (compared like the CRM does: lower case, letters and digits only). With no match, a client account is created,
     owned by --owner. A matching company that is not yet a client becomes one.
  2. People are copied with the SAME ids (deleted ones stay deleted), so Gifting OS gift requests keep pointing at them.
  3. Addresses (same ids), plus one default address built from the old per-person address where the person has none.
  4. Preferences and relationships (same ids).
  5. Change history (only for people with no CRM history yet, so a second run never doubles it).
  6. Photos: downloaded from Gifting OS and stored in the CRM's private client-images bucket.
Every step is an upsert by id: running it again only fills what is missing. Writes nothing without --apply.
"""
import argparse
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import dotenv_values
from supabase import create_client

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.core.keys import company_key, phone_key  # noqa: E402
from src.core.storage import CLIENT_IMAGES  # noqa: E402
from src.core.supabase import get_service_client  # noqa: E402

PAGE = 1000
BATCH = 500
ADDRESS_NS = uuid.UUID("6f6a1c4e-1a1b-4a0e-9a57-5d3f4b2a7c10")  # ids for addresses built from the old per-person address
RELATIONSHIPS = {"CLIENT", "EMPLOYEE", "PARTNER", "ADVISOR", "VENDOR", "FAMILY", "SPOUSE", "CHILD", "PARENT", "SIBLING", "FRIEND", "OTHER"}
LINK_TYPES = {"SPOUSE", "SON", "DAUGHTER", "PARENT", "SIBLING", "BUSINESS_ASSOCIATE", "COLLEAGUE", "OTHER"}
AUDIT_ACTIONS = {"CREATE", "EDIT", "IMPORT", "ARCHIVE", "RESTORE", "DELETE"}


def read_all(db, table: str, cols: str = "*", **eq) -> list[dict]:
    out, start = [], 0
    while True:
        q = db.table(table).select(cols)
        for k, v in eq.items():
            q = q.eq(k, v)
        rows = q.order("created_at" if table != "recipient_preferences" else "updated_at").range(start, start + PAGE - 1).execute().data
        out += rows
        if len(rows) < PAGE:
            return out
        start += PAGE


def in_chunks(db, table: str, col: str, values: list, cols: str = "*") -> list[dict]:
    """Every row whose `col` is one of `values`: ids in groups of 150, each group paged (the API returns 1,000 at most)."""
    out = []
    for i in range(0, len(values), 150):
        start = 0
        while True:
            rows = db.table(table).select(cols).in_(col, values[i:i + 150]).order(col).range(start, start + PAGE - 1).execute().data
            out += rows
            if len(rows) < PAGE:
                break
            start += PAGE
    return out


def upsert(db, table: str, rows: list[dict], conflict: str = "id") -> None:
    for i in range(0, len(rows), BATCH):
        db.table(table).upsert(rows[i:i + BATCH], on_conflict=conflict).execute()


def find_owner(crm, who: str) -> dict:
    rows = crm.table("profiles").select("id,full_name,email,role").in_("role", ["kam", "admin"]).execute().data
    hit = [p for p in rows if who.lower() in ((p.get("full_name") or "").lower(), (p.get("email") or "").lower())]
    if len(hit) != 1:
        sys.exit(f"--owner {who!r} must match exactly one KAM or admin; found {[p['full_name'] for p in hit] or 'none'}")
    return hit[0]


def person_row(r: dict, company_id: str) -> tuple[dict, list[str]]:
    """The CRM row for a Gifting OS person, and anything that had to be dropped to fit the CRM rules."""
    notes = []
    rel = r.get("relationship")
    if rel and rel not in RELATIONSHIPS:
        notes.append(f"relationship {rel!r} not allowed: left empty")
        rel = None
    name = (r.get("name") or "").strip() or "Unnamed"
    if name == "Unnamed":
        notes.append("no name: saved as 'Unnamed'")
    return {
        "id": r["id"], "company_id": company_id, "name": name[:200],
        "mobile_number": r.get("mobile_number"), "mobile_key": phone_key(r.get("mobile_number")),
        "email": (r.get("email") or "").strip().lower() or None, "company_name": r.get("company"),
        "designation": r.get("designation"), "city": r.get("city"),
        "date_of_birth": r.get("date_of_birth"), "anniversary_date": r.get("anniversary_date"),
        "budget": r.get("budget"), "birthday_budget": r.get("birthday_budget"), "anniversary_budget": r.get("anniversary_budget"),
        "gifting_occasion": r.get("gifting_occasion"), "remark": r.get("remark"), "relationship": rel,
        "recipient_type": r.get("recipient_type") if r.get("recipient_type") in ("INTERNAL", "EXTERNAL") else "INTERNAL",
        "status": r.get("status") if r.get("status") in ("ACTIVE", "ARCHIVED") else "ACTIVE",
        "is_primary": bool(r.get("is_primary")), "version": r.get("version") or 1,
        "source": "IMPORT" if r.get("import_batch_id") else "MANUAL",
        "added_by": "CLIENT" if r.get("source") == "CLIENT" else "TOFAA",
        "created_by": None, "updated_by": None,
        "deleted_at": r.get("deleted_at"), "created_at": r["created_at"], "updated_at": r["updated_at"],
    }, notes


def inline_address(r: dict) -> dict | None:
    """The old per-person address as a CRM address row, or None when it is missing or does not fit the CRM rules."""
    a = r.get("address")
    if not isinstance(a, dict):
        return None
    line1, city, pin = (a.get("address_line1") or "").strip(), (a.get("city") or "").strip(), (a.get("postal_code") or "").strip()
    country = (a.get("country") or "IN").strip().upper()
    if len(line1) < 3 or not city or not (len(pin) == 6 and pin.isdigit()) or not (len(country) == 2 and country.isalpha()):
        return None
    return {
        "id": str(uuid.uuid5(ADDRESS_NS, r["id"])), "recipient_id": r["id"], "label": "OFFICE",
        "address_line1": line1[:300], "address_line2": (a.get("address_line2") or "").strip()[:300] or None,
        "city": city[:100], "state": (a.get("state") or "").strip()[:100] or None, "postal_code": pin, "country": country,
        "is_default": True, "created_at": r["created_at"], "updated_at": r["updated_at"],
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gifting-env", required=True, help="path to TOFAA_Gifting_OS/backend/.env")
    ap.add_argument("--owner", required=True, help="KAM (or admin) who owns new client accounts: full name or email")
    ap.add_argument("--apply", action="store_true", help="really write to the CRM (default: dry run)")
    ap.add_argument("--groups-only", action="store_true", help="copy only the recipient groups (people already copied)")
    args = ap.parse_args()

    env = dotenv_values(args.gifting_env)
    gifting = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
    crm = get_service_client()
    if env["SUPABASE_URL"].strip().rstrip("/") == str(crm.supabase_url).rstrip("/"):
        sys.exit("The Gifting OS and CRM settings point at the same database. Stopping.")
    try:
        crm.table("companies").select("gifting_tenant_id").limit(1).execute()
        crm.table("recipients").select("added_by").limit(1).execute()
        migrated = True
    except Exception:  # noqa: BLE001
        migrated = False
        if args.apply:
            sys.exit("Apply migration 20261126100000_gifting_os_people.sql to the CRM database first.")
        print("   (the CRM migration 20261126100000_gifting_os_people.sql is not applied yet: fine for a dry run)")
    owner = find_owner(crm, args.owner)
    mode = "APPLY" if args.apply else "DRY RUN (nothing is written)"
    print(f"== {mode}\n   owner of new client accounts: {owner['full_name']} ({owner['role']})")

    # 1. tenants -> client accounts --------------------------------------------------------------------------------------
    tenants = [t for t in gifting.table("tenants").select("id,name,tenant_type").execute().data if t["tenant_type"] != "INTERNAL"]
    cols = "id,name,name_key,client_since,account_owner_id,deleted_at" + (",gifting_tenant_id" if migrated else "")
    companies = crm.table("companies").select(cols).execute().data
    by_tenant = {c["gifting_tenant_id"]: c for c in companies if c.get("gifting_tenant_id")}
    by_key = {c["name_key"]: c for c in companies if not c.get("deleted_at")}
    company_of: dict[str, str] = {}
    now = datetime.now(timezone.utc).isoformat()
    print("\n== client accounts")
    for t in sorted(tenants, key=lambda t: t["name"].lower()):
        c = by_tenant.get(t["id"]) or by_key.get(company_key(t["name"]))
        if c and c.get("gifting_tenant_id") not in (None, t["id"]):
            sys.exit(f"CRM account {c['name']!r} is already linked to another Gifting OS tenant. Resolve it by hand first.")
        if c:
            patch = {"gifting_tenant_id": t["id"]}
            if not c.get("client_since"):
                patch["client_since"] = now
            if not c.get("account_owner_id"):
                patch["account_owner_id"] = owner["id"]
            print(f"   link    {t['name']!r} -> existing {c['name']!r}" + ("  (becomes a client)" if "client_since" in patch else ""))
            if args.apply and (len(patch) > 1 or c.get("gifting_tenant_id") != t["id"]):
                crm.table("companies").update(patch).eq("id", c["id"]).execute()
            company_of[t["id"]] = c["id"]
        else:
            print(f"   create  {t['name']!r} (owner {owner['full_name']})")
            new_id = str(uuid.uuid4())
            if args.apply:
                new_id = crm.table("companies").insert({
                    "name": t["name"], "name_key": company_key(t["name"]), "created_by": owner["id"],
                    "client_since": now, "account_owner_id": owner["id"], "gifting_tenant_id": t["id"],
                }).execute().data[0]["id"]
            company_of[t["id"]] = new_id

    if args.groups_only:
        problems: list[str] = []
        copy_groups(gifting, crm, company_of, args.apply, problems)
        report(problems, args.apply)
        return

    # 2. people ----------------------------------------------------------------------------------------------------------
    people_src = [r for r in read_all(gifting, "recipients") if r["tenant_id"] in company_of]
    rows, problems = [], []
    for r in people_src:
        row, notes = person_row(r, company_of[r["tenant_id"]])
        rows.append(row)
        problems += [f"{r['id']} {r.get('name')!r}: {n}" for n in notes]
    live_keys: dict[tuple, str] = {}
    for row in rows:  # the CRM refuses two live people of one client with the same mobile
        if row["deleted_at"] or not row["mobile_key"]:
            continue
        k = (row["company_id"], row["mobile_key"])
        if k in live_keys:
            problems.append(f"{row['id']} {row['name']!r}: same mobile as {live_keys[k]} -> mobile left empty")
            row["mobile_number"] = row["mobile_key"] = None
        else:
            live_keys[k] = row["id"]
    live_n = sum(1 for r in rows if not r["deleted_at"])
    print(f"\n== people: {len(rows)} ({live_n} live, {len(rows) - live_n} deleted)")
    if args.apply:
        upsert(crm, "recipients", [{k: v for k, v in r.items() if k != "photo_path"} for r in rows])

    ids = [r["id"] for r in rows]

    # 3. addresses -------------------------------------------------------------------------------------------------------
    addr_rows = in_chunks(gifting, "recipient_addresses", "recipient_id", ids)
    has_addr = {a["recipient_id"] for a in addr_rows}
    addresses = [{k: a[k] for k in ("id", "recipient_id", "label", "address_line1", "address_line2", "city", "state", "postal_code",
                                    "country", "is_default", "created_at", "updated_at")} for a in addr_rows]
    built, skipped = 0, 0
    for r in people_src:
        if r["id"] in has_addr or not r.get("address"):
            continue
        a = inline_address(r)
        if a:
            addresses.append(a)
            built += 1
        else:
            skipped += 1
            problems.append(f"{r['id']} {r.get('name')!r}: old address incomplete or invalid -> not copied")
    print(f"== addresses: {len(addr_rows)} copied + {built} built from the old per-person address ({skipped} unusable)")
    if args.apply:
        upsert(crm, "recipient_addresses", addresses)

    # 4. preferences and relationships -----------------------------------------------------------------------------------
    prefs = [{k: p[k] for k in ("recipient_id", "interests", "preferred_brands", "gift_preferences", "dietary_preferences",
                                "gifts_to_avoid", "special_instructions", "updated_at")} | {"updated_by": None}
             for p in in_chunks(gifting, "recipient_preferences", "recipient_id", ids)]
    links = [{k: x[k] for k in ("id", "recipient_id", "related_recipient_id", "relationship_type", "created_at")} | {"created_by": None}
             for x in in_chunks(gifting, "recipient_relationships", "recipient_id", ids) if x["relationship_type"] in LINK_TYPES]
    print(f"== preferences: {len(prefs)}   relationships: {len(links)}")
    if args.apply:
        upsert(crm, "recipient_preferences", prefs, "recipient_id")
        upsert(crm, "recipient_relationships", links)

    # 5. history ---------------------------------------------------------------------------------------------------------
    already = {a["recipient_id"] for a in in_chunks(crm, "recipient_audit", "recipient_id", ids, "recipient_id")} if args.apply else set()
    audit_src = [a for a in in_chunks(gifting, "recipient_audit", "recipient_id", ids) if a["recipient_id"] not in already]
    audit = [{
        "recipient_id": a["recipient_id"], "created_at": a["created_at"], "actor_id": None,
        "actor_name": a.get("actor_name"), "actor_role": a.get("actor_role"),
        "action": "EDIT" if a["action"] == "UPDATE" else a["action"] if a["action"] in AUDIT_ACTIONS else "EDIT",
        "field": a.get("field"), "old_value": a.get("old_value"), "new_value": a.get("new_value"),
        "source": "IMPORT" if a.get("source") == "EXCEL_IMPORT" else "MANUAL",
    } for a in audit_src]
    print(f"== history entries: {len(audit)}" + (f" (skipped people who already have CRM history: {len(already)})" if already else ""))
    if args.apply:
        for i in range(0, len(audit), BATCH):
            crm.table("recipient_audit").insert(audit[i:i + BATCH]).execute()

    # 6. photos ----------------------------------------------------------------------------------------------------------
    with_photo = [r for r in people_src if r.get("avatar_url")]
    have = {r["id"] for r in in_chunks(crm, "recipients", "id", [r["id"] for r in with_photo], "id,photo_path") if r.get("photo_path")} if args.apply else set()
    copied = 0
    for r in with_photo:
        if r["id"] in have:
            continue
        if not args.apply:
            copied += 1
            continue
        try:
            res = httpx.get(r["avatar_url"], timeout=30, follow_redirects=True)
            res.raise_for_status()
            mime = res.headers.get("content-type", "image/jpeg").split(";")[0]
            ext = {"image/png": "png", "image/webp": "webp"}.get(mime, "jpg")
            path = f"people/{company_of[r['tenant_id']]}/{uuid.uuid4().hex}.{ext}"
            crm.storage.from_(CLIENT_IMAGES).upload(path, res.content, {"content-type": mime, "cache-control": "31536000"})
            crm.table("recipients").update({"photo_path": path}).eq("id", r["id"]).execute()
            copied += 1
        except Exception as exc:  # noqa: BLE001
            problems.append(f"{r['id']} {r.get('name')!r}: photo not copied ({type(exc).__name__})")
    print(f"== photos: {copied} of {len(with_photo)}")

    # 7. groups ----------------------------------------------------------------------------------------------------------
    copy_groups(gifting, crm, company_of, args.apply, problems)
    report(problems, args.apply)


def copy_groups(gifting, crm, company_of: dict[str, str], apply: bool, problems: list[str]) -> None:
    """Gifting OS recipient groups -> CRM People groups (same ids, same members). Members must already be in the CRM."""
    groups = [g for g in gifting.table("spend_recipient_groups").select("id,tenant_id,name,created_at,updated_at").execute().data
              if g["tenant_id"] in company_of]
    members = in_chunks(gifting, "spend_recipient_group_members", "group_id", [g["id"] for g in groups], "group_id,recipient_id,created_at")
    in_crm = {r["id"] for r in in_chunks(crm, "recipients", "id", sorted({m["recipient_id"] for m in members}), "id")} if members else set()
    taken = {(g["company_id"], g["name"].strip().lower()): g["id"] for g in crm.table("recipient_groups").select("id,company_id,name").execute().data}
    rows = []
    for g in groups:
        company, name = company_of[g["tenant_id"]], g["name"].strip()[:120]
        clash = taken.get((company, name.lower()))
        if clash and clash != g["id"]:  # the CRM allows one group of a name per client
            problems.append(f"group {name!r}: the client already has a CRM group with this name -> not copied")
            continue
        rows.append({"id": g["id"], "company_id": company, "name": name, "created_by": None, "created_at": g["created_at"], "updated_at": g["updated_at"]})
    copied = {r["id"] for r in rows}
    links = [m for m in members if m["group_id"] in copied]
    missing = [m for m in links if m["recipient_id"] not in in_crm]
    for m in missing:
        problems.append(f"group member {m['recipient_id']} is not in the CRM -> left out of the group")
    links = [{"group_id": m["group_id"], "recipient_id": m["recipient_id"], "created_at": m["created_at"]} for m in links if m["recipient_id"] in in_crm]
    print(f"== groups: {len(rows)} of {len(groups)}, with {len(links)} memberships")
    if apply:
        upsert(crm, "recipient_groups", rows)
        upsert(crm, "recipient_group_members", links, "group_id,recipient_id")


def report(problems: list[str], apply: bool) -> None:
    print(f"\n== notes ({len(problems)})")
    for p in problems[:50]:
        print("   " + p)
    if len(problems) > 50:
        print(f"   ... and {len(problems) - 50} more")
    print("\nDone." if apply else "\nDry run finished. Nothing was written. Add --apply to copy.")


if __name__ == "__main__":
    main()
