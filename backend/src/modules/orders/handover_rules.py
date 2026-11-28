"""OMS handover rules. Pure: no database. The contract is in backend/OMS_ORDER_API.md.

A handover is what OMS reads about an order: kits, items, delivery places and design details, never money.
"""
from datetime import date, datetime, timezone
from uuid import uuid4

# --- stages: the one place OMS stages become CRM statuses ---------------------------------------------------------------

OMS_STAGES = ("accepted", "design_and_procurement", "warehouse_ready", "packing", "dispatched", "delivered", "on_hold", "cancelled")
STAGE_STATUS = {
    "accepted": "accepted", "design_and_procurement": "production", "warehouse_ready": "production", "packing": "packed",
    "dispatched": "dispatched", "delivered": "delivered", "on_hold": "on_hold", "cancelled": "cancelled",
}
# The forward line an OMS update walks. quality_check is a CRM-only status: OMS has no stage for it, so it is not filled in.
PATH = ("ready", "accepted", "production", "packed", "dispatched", "delivered")
RANK = {"new": 0, "rejected": 0, "ready": 1, "accepted": 2, "production": 3, "quality_check": 3.5, "packed": 4, "dispatched": 5,
        "delivered": 6}


def new_ref(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:10]}"


def steps_between(current: str, target: str) -> list[str]:
    """Every status to record on the way forward from `current` to `target` (target included). Empty = not forward."""
    if RANK[target] <= RANK[current]:
        return []
    return [s for s in PATH if RANK[current] < RANK[s] <= RANK[target]]


def merge_shipments(existing: list[dict], updates: list[dict]) -> list[dict]:
    """Shipments are told apart by location and tracking number, so a repeated message changes nothing. An update with
    no tracking number belongs to the location's only shipment. Raises ValueError when that is ambiguous."""
    out = [dict(s) for s in existing]
    for update in updates:
        ref, tracking = update["location_ref"], update.get("tracking_number")
        here = [s for s in out if s["location_ref"] == ref]
        if tracking:
            found = next((s for s in here if s.get("tracking_number") == tracking), None)
            if not found:  # a tracking number given later for the one shipment that had none
                found = next((s for s in here if not s.get("tracking_number")), None)
        else:
            if len(here) > 1:
                raise ValueError(f"Location {ref} has more than one shipment: send its tracking_number.")
            found = here[0] if here else None
        values = {k: v for k, v in update.items() if v is not None}
        if found:
            found.update(values)
        else:
            out.append(values)
    return out


def _complete(shipments: list[dict], locations: list[dict], total_kits: int, key: str) -> bool:
    """True when every location has a shipment with `key` and those shipments carry all the kits."""
    done = [s for s in shipments if s.get(key) or (key == "dispatched_at" and s.get("delivered_at"))]
    sent: dict[str, int] = {}
    for s in done:
        sent[s["location_ref"]] = sent.get(s["location_ref"], 0) + int(s.get("kits") or 0)
    if any(sent.get(p["location_ref"], 0) < int(p.get("quantity") or 1) for p in locations):
        return False
    return sum(sent.values()) >= total_kits


def target_status(stage: str, shipments: list[dict], published: dict) -> str:
    """The CRM status an OMS stage leads to. Part dispatched stays "packed"; part delivered stays "dispatched" (or
    "packed" while kits are still to leave)."""
    status = STAGE_STATUS[stage]
    if status not in ("dispatched", "delivered"):
        return status
    locations, kits = published.get("delivery_locations") or [], int(published.get("total_kits") or 0)
    if status == "delivered" and _complete(shipments, locations, kits, "delivered_at"):
        return "delivered"
    return "dispatched" if _complete(shipments, locations, kits, "dispatched_at") else "packed"


def plan(current: str, held_from: str | None, stage: str, shipments: list[dict], published: dict) -> list[str]:
    """The status changes an accepted OMS update makes, in order. Never backwards. Empty = the status stays."""
    if current in ("delivered", "cancelled"):
        return []
    target = target_status(stage, shipments, published)
    if target == "cancelled":
        return ["cancelled"]
    if target == "on_hold":
        return [] if current == "on_hold" else ["on_hold"]
    if current == "on_hold":  # OMS carries on: back to where it was held, then forward
        base = held_from or "ready"
        return [base, *steps_between(base, target)]
    return steps_between(current, target)


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def utc(value) -> str | None:
    """Any stored time as UTC ISO 8601, the format OMS reads."""
    parsed = value if isinstance(value, datetime) else parse_time(value)
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z") if parsed else None


# --- preparing a handover ---------------------------------------------------------------------------------------------

def prefill(order: dict) -> dict:
    """A first draft from what the order already knows (the same rules as the migration's backfill)."""
    packages = order.get("items") or []
    out: dict = {}
    if order.get("handover_items") is None:
        items = []
        for package in packages:
            contents = package.get("details") or [{"name": package.get("name"), "description": None}]
            for content in contents:
                items.append({"item_ref": new_ref("IT"), "product_id": None, "name": content.get("name") or package.get("name"),
                              "description": content.get("description"), "quantity_per_kit": 1, "is_packaging": False,
                              "photos": (package.get("photos") or []) if len(contents) == 1 else []})
        out["handover_items"] = items
    if order.get("total_kits") is None and len(packages) == 1:
        quantity = float(packages[0].get("quantity") or 0)
        if quantity >= 1 and quantity.is_integer():
            out["total_kits"] = int(quantity)
    if order.get("delivery_locations") is None and (order.get("delivery_address") or "").strip():
        out["delivery_locations"] = [{
            "location_ref": new_ref("LOC"), "line": order["delivery_address"], "city": None, "state": None, "pincode": None,
            "contact_name": order.get("receiver_name"), "contact_phone": order.get("receiver_phone"), "quantity": None}]
    if not order.get("campaign_name"):
        lead = order.get("lead") or {}
        name = (lead.get("occasion") or lead.get("project_title") or "").strip()
        if name:
            out["campaign_name"] = name
    return out


def _blank(value) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def problems(order: dict, company_name: str | None, owner: dict | None) -> list[str]:
    """Everything that stops a handover being sent for approval, in words the KAM can act on."""
    out = []
    if order.get("source") == "manual" or not order.get("lead_id"):
        return ["Deals made by hand do not go to OMS."]
    if _blank(company_name):
        out.append("The client has no company name.")
    elif len(company_name) > 200:
        out.append("The company name is longer than 200 characters.")
    if not owner or _blank(owner.get("full_name")) or _blank(owner.get("email")):
        out.append("The deal needs a Sales Owner with a name and email.")
    kits = order.get("total_kits")
    if not kits:
        out.append("Enter the Kit Quantity.")
    if not order.get("expected_delivery"):
        out.append("Enter the Requested Delivery Date.")
    items = order.get("handover_items") or []
    if not items:
        out.append("Add at least one Element.")
    for n, item in enumerate(items, 1):
        if _blank(item.get("name")) or not item.get("quantity_per_kit"):
            out.append(f"Element {n} needs a name and a quantity per kit.")
    places = order.get("delivery_locations") or []
    if not places:
        out.append("Add at least one Delivery Location.")
    for n, place in enumerate(places, 1):
        missing = [label for key, label in (("line", "address"), ("city", "city"), ("state", "state"), ("pincode", "pincode"),
                                            ("contact_name", "contact name"), ("contact_phone", "contact phone"))
                   if _blank(place.get(key))]
        if missing:
            out.append(f"Location {n} needs: {', '.join(missing)}.")
    quantities = [p.get("quantity") for p in places]
    if kits and places:
        given = sum(q for q in quantities if q)
        if all(quantities) and given != kits:
            out.append(f"Location quantities add up to {given}, but there are {kits} kits.")
        elif given > kits or (not all(quantities) and given + sum(1 for q in quantities if not q) > kits):
            out.append("Location quantities leave too few kits for the other locations.")
    sample = order.get("sample") or {}
    if "required" not in sample or sample.get("required") is None:
        out.append("Choose Yes or No for Sample Required.")
    approval = [not _blank(sample.get("approver_name")), bool(sample.get("approved_on")), bool(sample.get("evidence"))]
    if any(approval) and not all(approval):
        out.append("A sample approval needs the approver name, the date and the evidence file.")
    return out


def build(order: dict, company: dict, owner: dict, version: int) -> dict:
    """The handover as OMS reads it, with storage paths in place of links. Money is never put in."""
    sample = order.get("sample") or {}
    approved = None
    if sample.get("approver_name") and sample.get("approved_on") and sample.get("evidence"):
        approved = {"approver_name": sample["approver_name"], "approved_on": sample["approved_on"], "evidence": sample["evidence"]["path"]}
    return {
        "handover_number": order["handover_number"], "deal_number": order.get("deal_number"), "deal_id": order["lead_id"], "version": version,
        "client": {"client_id": order["company_id"], "company_name": company["name"], "client_type": order.get("client_type")},
        "sales_owner": {"name": owner["full_name"], "email": owner["email"]},
        "campaign_name": order.get("campaign_name"), "total_kits": int(order["total_kits"]),
        "delivery_deadline": str(order["expected_delivery"]), "advance_percent": None if order.get("advance_percent") is None else float(order["advance_percent"]),
        "design_brief": {"text": order.get("design_brief"),
                         "reference_files": [f["path"] for f in order.get("reference_files") or []],
                         "logo_files": [f["path"] for f in order.get("logo_files") or []]},
        "sample": {"required": bool(sample["required"]), "approval": approved},
        "items": [{"item_ref": i["item_ref"], "product_id": i.get("product_id"), "name": i["name"], "description": i.get("description"),
                   "quantity_per_kit": int(i["quantity_per_kit"]), "is_packaging": bool(i.get("is_packaging")),
                   "photos": i.get("photos") or []} for i in order["handover_items"]],
        "delivery_locations": [{"location_ref": p["location_ref"],
                                "address": {k: p[k] for k in ("line", "city", "state", "pincode")},
                                "contact_name": p["contact_name"], "contact_phone": p["contact_phone"],
                                "quantity": p.get("quantity")} for p in order["delivery_locations"]],
        "client_instructions": order.get("instructions"),
    }


def paths_in(handover: dict) -> list[str]:
    brief = handover.get("design_brief") or {}
    approval = (handover.get("sample") or {}).get("approval") or {}
    return [*brief.get("reference_files", []), *brief.get("logo_files", []),
            *([approval["evidence"]] if approval.get("evidence") else []),
            *[p for item in handover.get("items") or [] for p in item.get("photos") or []]]


def with_links(handover: dict, urls: dict[str, str]) -> dict:
    """The stored handover with each storage path swapped for a signed link (files that cannot be signed are left out)."""
    def links(paths):
        return [urls[p] for p in paths or [] if p in urls]

    brief = handover["design_brief"]
    approval = handover["sample"]["approval"]
    if approval:
        approval = {"approver_name": approval["approver_name"], "approved_on": approval["approved_on"],
                    "evidence_url": urls.get(approval["evidence"])}
    return {
        **handover,
        "design_brief": {"text": brief["text"], "reference_file_urls": links(brief["reference_files"]),
                         "logo_file_urls": links(brief["logo_files"])},
        "sample": {"required": handover["sample"]["required"], "approval": approval},
        "items": [{**{k: v for k, v in i.items() if k != "photos"}, "photo_urls": links(i.get("photos"))} for i in handover["items"]],
    }


def as_date(value) -> str | None:
    return value.isoformat() if isinstance(value, date) else value


# --- from the agreement -------------------------------------------------------------------------------------------------

def from_agreement(details: dict | None) -> dict:
    """The handover fields the agreement already answers. Only what was filled in is returned."""
    details = details or {}
    packages = details.get("packages") or []
    out: dict = {}
    items = []
    for package in packages:
        contents = package.get("items") or [{"name": package.get("name")}]
        for content in contents:
            own = content.get("photos") or []
            items.append({"item_ref": new_ref("IT"), "product_id": content.get("product_id"), "name": content.get("name"),
                          "description": content.get("description"), "quantity_per_kit": content.get("quantity_per_kit") or 1,
                          "is_packaging": bool(content.get("is_packaging")),
                          "photos": own or ((package.get("photos") or []) if len(contents) == 1 else [])})
    if items:
        out["handover_items"] = items
    if len(packages) == 1:  # several packages: the KAM says how many kits
        quantity = float(packages[0].get("quantity") or 0)
        if quantity >= 1 and quantity.is_integer():
            out["total_kits"] = int(quantity)
    delivery = details.get("handover") or {}
    for key in ("expected_delivery", "advance_percent", "campaign_name", "client_type", "instructions", "design_brief"):
        if delivery.get(key) not in (None, ""):
            out[key] = delivery[key]
    if delivery.get("sample_required") is not None:
        out["sample"] = {"required": delivery["sample_required"]}
    if delivery.get("delivery_locations"):
        out["delivery_locations"] = delivery["delivery_locations"]
    return out


def _bare(items: list[dict]) -> list[dict]:
    return [{k: v for k, v in i.items() if k != "item_ref"} for i in items]


def agreement_changes(order: dict, old: dict | None, new: dict) -> dict:
    """What an agreement edit changes on an existing handover. Only what changed in the agreement is applied, so what
    the KAM filled in on the handover stays. Clearing something in the agreement does not clear the handover."""
    before, after = from_agreement(old), from_agreement(new)
    patch: dict = {}
    for key, value in after.items():
        if key in ("handover_items", "delivery_locations", "sample") or value == before.get(key):
            continue
        if value != order.get(key):
            patch[key] = value
    if "sample" in after and after["sample"] != before.get("sample"):
        sample = {**(order.get("sample") or {}), **after["sample"]}
        if sample != order.get("sample"):
            patch["sample"] = sample
    was = before.get("handover_items") or []
    now = after.get("handover_items") or []
    if now and _bare(now) != _bare(was):
        current = list(order.get("handover_items") or [])
        previous = {i["name"]: i for i in was}
        items = []
        for item in now:
            found = next((c for c in current if c.get("name") == item["name"]), None)
            if not found:
                items.append(item)
                continue
            current.remove(found)
            prior = previous.get(item["name"], {})
            items.append({**found, **{k: v for k, v in item.items() if k != "item_ref" and v != prior.get(k)}})
        items += [c for c in current if c.get("name") not in previous]  # added on the handover itself
        if items != order.get("handover_items"):
            patch["handover_items"] = items
    places = after.get("delivery_locations")
    earlier = before.get("delivery_locations") or []
    if places and places != earlier:
        known = {p["location_ref"] for p in earlier}
        chosen = {p["location_ref"] for p in places}
        shipped = {s["location_ref"] for s in order.get("shipments") or []}
        # Kept: places with shipments, and (once the agreement had places) those added on the handover itself.
        kept = [p for p in order.get("delivery_locations") or [] if p["location_ref"] not in chosen
                and (p["location_ref"] in shipped or (earlier and p["location_ref"] not in known))]
        if places + kept != order.get("delivery_locations"):
            patch["delivery_locations"] = places + kept
    return patch
