"""Order management: the list, one order in full, create, change, delete and move through the stages.

An order keeps its own copy of what was agreed (items, transport, GST), taken from the prepared agreement, else the
latest quotation. It needs migration 20261129100000_order_flow.sql; before it, orders show read-only with the items
taken from the deal, and the earlier four delivery steps keep working (service.py).
"""
import logging

from src.core import cache
from src.core.access import require_lead_role, visible_owner_ids
from src.core.audit import write_audit
from src.core.dates import now_ist
from src.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from src.core.pagination import PageParams, page_meta
from src.core.soft_delete import live
from src.core.storage import CLIENT_IMAGES, DOCUMENTS, signed_urls
from src.core.supabase import get_service_client
from src.core.timeline import add_activity
from src.modules.auth.schemas import Profile, Role
from src.modules.notifications.service import notify
from src.modules.orders import rules

log = logging.getLogger(__name__)
NOT_READY = "Deal management is not set up yet. An admin needs to apply the database migration 20261129100000_order_flow.sql, then try again."
NOWHERE = "00000000-0000-0000-0000-000000000000"
SELECT = (
    "*, company:companies(id,name,city,account_owner_id), owner:profiles!owner_id(id,full_name),"
    " lead:leads(id,owner_id,pipeline,contact:contacts(id,name,designation,phone,email,photo_path),owner:profiles!owner_id(id,full_name))"
)
DETAIL_FIELDS = ("expected_delivery", "delivery_address", "receiver_name", "receiver_phone", "instructions", "billing_name",
                 "billing_gstin", "notes")
SHIPMENT_FIELDS = ("courier", "tracking_number", "tracking_url", "oms_reference")


def upgraded() -> bool:
    """True once the order flow migration is applied. Re-checked every minute, so no restart is needed."""

    def check() -> bool:
        try:
            get_service_client().table("orders").select("items,deleted_at").limit(1).execute()
            return True
        except Exception:  # noqa: BLE001 - the columns are missing before the migration
            return False

    return cache.reference("order-flow-ready", "orders", 60, check)


def require_upgraded() -> None:
    if not upgraded():
        raise AppError(NOT_READY, status_code=503)


# --- what was agreed --------------------------------------------------------------------------------------------------

def _item(name, quantity, unit_price, details=None, photos=None) -> dict:
    return {"name": str(name)[:200], "quantity": float(quantity), "unit_price": float(unit_price),
            "details": [{"name": d.get("name"), "description": d.get("description"),
                         **{k: d[k] for k in ("unit_price", "quantity_per_kit") if d.get(k) is not None}} for d in details or [] if d.get("name")],
            "photos": [p for p in photos or [] if p]}


def agreed_for(lead_id: str) -> dict:
    """The deal's items, transport and GST: the prepared agreement when there is one (what the client paid against),
    else the latest sent quotation, else the latest quotation."""
    db = get_service_client()
    rows = db.table("agreements").select("details").eq("lead_id", lead_id).limit(1).execute().data
    details = (rows[0] if rows else {}).get("details") or {}
    if details.get("packages"):
        return {"items": [_item(p["name"], p["quantity"], p["unit_price"], p.get("items"), p.get("photos")) for p in details["packages"]],
                "transportation": details.get("transportation") or 0, "gst_rate": details.get("gstRate", 18), "from": "agreement"}
    found = db.table("quotations").select("id,status,version").eq("lead_id", lead_id).order("version", desc=True).limit(20).execute().data
    quotation = next((q for q in found if q["status"] == "sent"), found[0] if found else None)
    if not quotation:
        return {"items": [], "transportation": 0, "gst_rate": 0, "from": None}
    packages = db.table("quotation_packages").select("*").eq("quotation_id", quotation["id"]).order("position").execute().data
    if packages:
        items = [_item(p["name"], p["quantity"], p["unit_price"], p.get("items"), p.get("photo_paths")) for p in packages]
    else:
        flat = db.table("quotation_items").select("description,quantity,unit_price").eq("quotation_id", quotation["id"]).order("position").execute().data
        items = [_item(i["description"], i["quantity"], i["unit_price"]) for i in flat]
    # A quotation has no GST of its own: its total is what was asked to be paid, so none is added on top.
    return {"items": items, "transportation": 0, "gst_rate": 0, "from": "quotation"}


def _totals(order: dict) -> dict:
    return rules.money(order.get("items") or [], order.get("transportation"), order.get("gst_rate"))


def _stored_money(items: list[dict], transportation, gst_rate) -> dict:
    items = [{**i, "quantity": float(i["quantity"]), "unit_price": float(i["unit_price"])} for i in items]  # typed values arrive as text
    sums = rules.money(items, transportation, gst_rate)
    return {"items": items, "transportation": sums["transportation"], "gst_rate": sums["gst_rate"],
            "subtotal": sums["subtotal"], "gst_amount": sums["gst_amount"], "total": sums["total"]}


def keep_item_prices(before: list[dict], after: list[dict]) -> list[dict]:
    """The edit form does not ask item prices: they stay while the requirement's rate is unchanged. A new rate is one
    price for the requirement, so its item prices are dropped."""
    old = {i["name"]: i for i in before}
    out = []
    for item in after:
        was = old.get(item["name"])
        if was and float(was["unit_price"]) == float(item["unit_price"]):
            known = {d["name"]: d for d in was.get("details") or []}
            item = {**item, "details": [{**known.get(d["name"], {}), **{k: v for k, v in d.items() if v is not None or k == "description"}}
                                        for d in item.get("details") or []]}
        else:
            item = {**item, "details": [{"name": d["name"], "description": d.get("description")} for d in item.get("details") or []]}
        out.append(item)
    return out


def snapshot(order: dict) -> dict:
    """Give an order its own copy of the items, once. Safe to repeat."""
    if order.get("items") or not order.get("lead_id"):
        return order
    agreed = agreed_for(order["lead_id"])
    if not agreed["items"]:
        return order
    patch = _stored_money(agreed["items"], agreed["transportation"], agreed["gst_rate"])
    get_service_client().table("orders").update(patch).eq("id", order["id"]).is_("items", "null").execute()
    return {**order, **patch}


def on_payment(lead_id: str) -> None:
    """A deal's payment is complete: its order (made by the database when the deal became Won) gets the items."""
    if not upgraded():
        return
    db = get_service_client()
    rows = db.table("orders").select("*").eq("lead_id", lead_id).limit(1).execute().data
    if not rows:
        lead = db.table("leads").select("id,company_id,owner_id,paid_amount").eq("id", lead_id).limit(1).execute().data[0]
        rows = db.table("orders").insert({"lead_id": lead_id, "company_id": lead.get("company_id"), "amount": lead.get("paid_amount")}).execute().data
    order = snapshot(rows[0])
    if not order.get("owner_id"):
        lead = db.table("leads").select("owner_id").eq("id", lead_id).limit(1).execute().data
        if lead and lead[0].get("owner_id"):
            db.table("orders").update({"owner_id": lead[0]["owner_id"]}).eq("id", order["id"]).execute()


# --- access -----------------------------------------------------------------------------------------------------------

def _kam_companies(user: Profile) -> list[str]:
    rows = live(get_service_client().table("companies").select("id"), "companies").eq("account_owner_id", user.id).limit(5000).execute().data
    return [r["id"] for r in rows]


def _lead_ids_of(owner_id: str) -> list[str]:
    rows = get_service_client().table("orders").select("lead_id,lead:leads!inner(owner_id)").eq("lead.owner_id", owner_id).limit(1000).execute().data
    return [r["lead_id"] for r in rows]


def _owned_by(owner_id: str, companies: list[str]) -> str:
    clauses = [f"owner_id.eq.{owner_id}"]
    if companies:
        clauses.append(f"company_id.in.({','.join(companies)})")
    leads = _lead_ids_of(owner_id)
    if leads:
        clauses.append(f"lead_id.in.({','.join(leads)})")
    return ",".join(clauses)


def can_see(user: Profile, order: dict, kam_companies: list[str] | None = None) -> bool:
    """Admins and managers see every order; a KAM those of their accounts, of their deals, or that they made."""
    require_lead_role(user)
    if user.role != Role.KAM:
        owners = visible_owner_ids(user)
        return owners is None or order.get("owner_id") in owners or ((order.get("lead") or {}).get("owner_id") in owners)
    companies = _kam_companies(user) if kam_companies is None else kam_companies
    return (order.get("owner_id") == user.id or (order.get("lead") or {}).get("owner_id") == user.id
            or order.get("company_id") in companies)


def load(user: Profile, order_id: str) -> dict:
    require_lead_role(user)
    q = get_service_client().table("orders")
    try:
        rows = q.select(SELECT if upgraded() else "*, company:companies(id,name,city,account_owner_id), lead:leads(id,owner_id,pipeline,contact:contacts(id,name,designation,phone,email,photo_path),owner:profiles!owner_id(id,full_name))").eq("id", order_id).limit(1).execute().data
    except Exception as exc:  # noqa: BLE001 - not an id
        if "22P02" in str(exc):
            raise NotFoundError("Deal not found.") from exc
        raise
    if not rows or rows[0].get("deleted_at"):
        raise NotFoundError("Deal not found. It may have been deleted.")
    if not can_see(user, rows[0]):
        raise ForbiddenError("This deal is for another client.")
    return rows[0]


# --- reading ----------------------------------------------------------------------------------------------------------

def _person(order: dict) -> tuple[dict | None, dict | None]:
    lead = order.get("lead") or {}
    return lead.get("contact"), order.get("owner") or lead.get("owner")


def row(order: dict, photo_urls: dict[str, str]) -> dict:
    """An order as the list shows it."""
    contact, owner = _person(order)
    company = order.get("company") or {}
    return {
        "id": order.get("lead_id") or order["id"], "order_id": order["id"], "lead_id": order.get("lead_id"),
        "pipeline": (order.get("lead") or {}).get("pipeline"), "source": order.get("source") or "payment",
        "order_number": rules.number(order), "order_amount": order.get("total") or order.get("amount"),
        "handover_number": order.get("handover_number"), "oms_order_number": order.get("oms_order_number"),
        "company": {"id": company.get("id"), "name": company.get("name") or "Client removed"},
        "contact": {"name": (contact or {}).get("name") or order.get("receiver_name") or "", "photo_url": photo_urls.get((contact or {}).get("photo_path") or "")},
        "owner": owner, "delivery_status": None if order["status"] == "new" else order["status"],
        "delivery_updated_at": order.get("status_updated_at"), "expected_delivery": order.get("expected_delivery"),
        "delivered_at": order.get("delivered_at"), "closed_at": order.get("created_at"),
    }


def list_orders(user: Profile, page: PageParams, *, status: str | None = None, owner_id: str | None = None) -> dict:
    require_lead_role(user)

    def load_page() -> dict:
        db = get_service_client()
        companies = _kam_companies(user) if user.role == Role.KAM else []

        def scoped(q):
            q = q.is_("deleted_at", "null")
            if user.role == Role.KAM:
                return q.or_(_owned_by(user.id, companies))
            if owner_id:
                return q.or_(_owned_by(owner_id, []))
            owners = visible_owner_ids(user)
            return q if owners is None else q.in_("owner_id", owners or [NOWHERE])

        q = scoped(db.table("orders").select(SELECT, count="exact"))
        if status in rules.STATUSES:
            q = q.eq("status", status)
        term = (page.search or "").strip()
        if term:
            from src.modules.leads import service as leads

            found_companies, contacts = leads._matching_ids(term)
            clauses = [f"company_id.in.({','.join(found_companies)})"] if found_companies else []
            if contacts:
                matched = db.table("orders").select("id,lead:leads!inner(contact_id)").in_("lead.contact_id", contacts).limit(500).execute().data
                if matched:
                    clauses.append(f"id.in.({','.join(r['id'] for r in matched)})")
            safe = "".join(ch for ch in term if ch.isalnum() or ch == "-")
            if safe:
                clauses.append(f"order_number.ilike.%{safe}%")  # also finds a Legacy ID
                if _numbered():
                    clauses += [f"{column}.ilike.%{safe}%" for column in ("deal_number", "handover_number", "oms_order_number")]
            # A second "or" narrows the first (the access rule above stays in force).
            q = q.or_(",".join(clauses)) if clauses else q.eq("id", NOWHERE)
        res = q.order("created_at", desc=True).range(page.start, page.end).execute()
        urls = signed_urls(CLIENT_IMAGES, [((r.get("lead") or {}).get("contact") or {}).get("photo_path") for r in res.data])
        counts = {s: 0 for s in rules.STATUSES}
        for r in scoped(db.table("orders").select("status")).limit(5000).execute().data:
            counts[r["status"]] = counts.get(r["status"], 0) + 1
        return {"items": [row(r, urls) for r in res.data], "meta": page_meta(page, res.count or 0), "counts": counts, "managed": True}

    return cache.memo("orders-flow", user.id, {"p": page.page, "l": page.limit, "q": page.search, "s": status, "o": owner_id}, 20, load_page)


def detail(user: Profile, order_id: str) -> dict:
    order = load(user, order_id)
    ready = upgraded()
    db = get_service_client()
    if ready:
        order = snapshot(order)
        agreed = None
    else:  # read-only until the migration: show what the deal agreed
        agreed = agreed_for(order["lead_id"]) if order.get("lead_id") else None
        if agreed:
            order = {**order, "items": agreed["items"], "transportation": agreed["transportation"], "gst_rate": agreed["gst_rate"]}
    sums = _totals(order)
    photo_paths = [p for item in sums["lines"] for p in item.get("photos") or []]
    urls = signed_urls(DOCUMENTS, photo_paths) if photo_paths else {}
    lines = [{**item, "photos": [urls[p] for p in item.get("photos") or [] if p in urls]} for item in sums["lines"]]
    payments = db.table("payment_requests").select("invoice_number,amount,amount_paid,status,confirmed_at").eq("lead_id", order["lead_id"]).order("requested_at", desc=True).limit(20).execute().data if order.get("lead_id") else []
    history = []
    try:
        columns = "from_status,to_status,note,created_at,by:profiles!changed_by(full_name)" + (",actor_name" if ready else "")
        history = db.table("order_status_history").select(columns).eq("order_id", order["id"]).order("created_at", desc=True).limit(100).execute().data
    except Exception:  # noqa: BLE001
        log.warning("could not read order history", exc_info=True)
    contact, owner = _person(order)
    contact_urls = signed_urls(CLIENT_IMAGES, [(contact or {}).get("photo_path")])
    company = order.get("company") or {}
    status = order["status"]
    moves = rules.crm_moves(status) if ready else [s for s in ("production", "quality_check", "dispatched", "delivered") if s != status]
    live_handover = ready and _handover_live()
    handed = ready and _handover_order(order)
    published = bool(order.get("published"))
    if live_handover:  # the status comes from OMS: nothing is moved by hand
        moves = []
    paid = sum(float(p.get("amount_paid") or 0) for p in payments)
    return {
        "id": order["id"], "order_number": rules.number(order), "legacy_id": order.get("legacy_id"),
        "handover_number": order.get("handover_number"), "oms_order_number": order.get("oms_order_number"), "status": status, "source": order.get("source") or "payment",
        "created_at": order.get("created_at"), "status_updated_at": order.get("status_updated_at"), "delivered_at": order.get("delivered_at"),
        "released_at": order.get("released_at"),
        "lead_id": order.get("lead_id"), "pipeline": (order.get("lead") or {}).get("pipeline"),
        "company": {"id": order.get("company_id"), "name": company.get("name") or "Client removed", "city": company.get("city")},
        "contact": {k: contact.get(k) for k in ("name", "designation", "phone", "email")} | {"photo_url": contact_urls.get(contact.get("photo_path") or "")} if contact else None,
        "owner": owner,
        **{k: order.get(k) for k in (*DETAIL_FIELDS, *SHIPMENT_FIELDS)},
        "items": lines, "items_from": agreed["from"] if agreed else None,
        **{k: sums[k] for k in ("units", "subtotal", "transportation", "gst_rate", "gst_amount", "total")},
        "agreed_amount": order.get("amount"), "paid_amount": paid, "balance": max(0.0, round(sums["total"] - paid, 2)) if payments else None,
        "payments": payments, "history": history,
        "managed": ready, "moves": moves, "handover": handed,
        "handover_status": (order.get("handover_status") or "draft") if handed else None,
        "payment_status": order.get("oms_payment_status") or "pending",  # reported by OMS
        "missing": rules.missing_for_release(order) if ready and not live_handover else [],
        "can_edit_items": ready and status not in rules.ITEMS_LOCKED,
        "can_edit_delivery": ready and status not in rules.DELIVERY_LOCKED,
        "can_delete": ready and status in rules.DELETABLE and not published,
    }


# --- writing ----------------------------------------------------------------------------------------------------------

def _record(order: dict, to: str, actor_id: str | None, actor_name: str | None, note: str | None) -> None:
    """Keep the change in the order's history and the deal's timeline."""
    db = get_service_client()
    entry = {"order_id": order["id"], "from_status": order.get("status"), "to_status": to, "changed_by": actor_id, "note": note}
    if actor_name:
        entry["actor_name"] = actor_name
    db.table("order_status_history").insert(entry).execute()
    if order.get("lead_id"):
        try:
            add_activity(order["lead_id"], actor_id, "order", outcome=to,
                         note=f"Deal {rules.number(order)}: {rules.LABEL.get(order.get('status'), order.get('status'))} -> {rules.LABEL[to]}",
                         meta={"orderId": order["id"], "from": order.get("status"), "to": to})
        except Exception:  # noqa: BLE001 - the order itself is saved either way
            log.warning("could not add the deal timeline entry", exc_info=True)


def move(order: dict, status: str, *, actor_id: str | None, actor_name: str | None = None, note: str | None = None,
         extra: dict | None = None) -> None:
    """Write one stage change, only if nobody else moved the order meanwhile."""
    now = now_ist().isoformat()
    patch = {**rules.status_patch(order, status, now), **(extra or {})}
    done = get_service_client().table("orders").update(patch).eq("id", order["id"]).eq("status", order["status"]).execute().data
    if not done:
        raise ConflictError("This deal changed just now. Refresh and try again.")
    _record(order, status, actor_id, actor_name, note)
    write_audit(actor_id or "", "order_status", "orders", order["id"], {"from": order["status"], "to": status, "by": actor_name})
    cache.clear()


def _numbered() -> bool:
    from src.modules.orders import handover  # local import: handover imports this module

    return handover.numbered()


def _handover_live() -> bool:
    """True once the database has the OMS handover: from then on only an approval releases an order to OMS."""
    from src.modules.orders import handover  # local import: handover imports this module

    return handover.ready()


def _handover_order(order: dict) -> bool:
    """True for an order that reaches OMS through an approved handover (one from a deal)."""
    return bool(order.get("lead_id")) and order.get("source") != "manual" and _handover_live()


def set_status(user: Profile, order_id: str, status: str, note: str | None) -> dict:
    require_upgraded()
    if _handover_live():
        raise ConflictError("The status comes from the OMS. To stop a deal, cancel its handover.")
    order = snapshot(load(user, order_id))
    if status == order["status"]:
        return detail(user, order_id)
    if status not in rules.crm_moves(order["status"]):
        raise ConflictError(f"A {rules.LABEL[order['status']].lower()} deal cannot move to {rules.LABEL.get(status, status)}.")
    if status == "ready":
        missing = rules.missing_for_release(order)
        if missing:
            raise AppError(f"Add {', '.join(missing)} before releasing this deal to OMS.", status_code=422)
    if status in ("cancelled", "on_hold", "rejected") and not (note or "").strip():
        raise AppError("Add a short note saying why.", status_code=422)
    move(order, status, actor_id=user.id, note=note)
    return detail(user, order_id)


def _company(user: Profile, company_id: str) -> dict:
    rows = live(get_service_client().table("companies").select("id,name,account_owner_id,client_since").eq("id", company_id), "companies").limit(1).execute().data
    if not rows or not rows[0].get("client_since"):
        raise NotFoundError("Client not found.")
    if user.role == Role.KAM and rows[0].get("account_owner_id") != user.id:
        raise ForbiddenError("You can create deals for your own clients only.")
    return rows[0]


def create(user: Profile, company_id: str, items: list[dict], transportation, gst_rate, details: dict) -> dict:
    """An order made by hand (a client order that did not come through a deal)."""
    require_upgraded()
    require_lead_role(user)
    if _handover_live():
        raise ConflictError("Deals come from leads: they can't be created by hand.")
    company = _company(user, company_id)
    values = {"company_id": company_id, "source": "manual", "owner_id": company.get("account_owner_id") or user.id,
              **_stored_money(items, transportation, gst_rate), **{k: details.get(k) for k in DETAIL_FIELDS}}
    values["amount"] = values["total"]
    made = get_service_client().table("orders").insert(values).execute().data[0]
    _record({**made, "status": None}, "new", user.id, None, "Deal created")
    write_audit(user.id, "create", "orders", made["id"], {"client": company["name"], "total": values["total"]})
    cache.clear()
    return detail(user, made["id"])


def update(user: Profile, order_id: str, changes: dict) -> dict:
    require_upgraded()
    order = snapshot(load(user, order_id))
    status = order["status"]
    patch = {k: v for k, v in changes.items() if k in (*DETAIL_FIELDS, *SHIPMENT_FIELDS) and v != order.get(k)}
    if any(k in patch for k in DETAIL_FIELDS if k != "notes") and status in rules.DELIVERY_LOCKED:
        raise ConflictError(f"A {rules.LABEL[status].lower()} deal's delivery details can no longer change.")
    money_keys = [k for k in ("items", "transportation", "gst_rate") if k in changes]
    if money_keys:
        items = changes.get("items", order.get("items") or [])
        # Photos come from the deal and are not typed in: keep them for items that keep their name.
        photos = {i["name"]: i.get("photos") or [] for i in order.get("items") or []}
        items = [{**i, "photos": photos.get(i["name"], [])} for i in items]
        items = keep_item_prices(order.get("items") or [], items)
        new = _stored_money(items, changes.get("transportation", order.get("transportation")), changes.get("gst_rate", order.get("gst_rate")))
        different = any(rules.money(new["items"], new["transportation"], new["gst_rate"])[k] != _totals(order)[k] for k in ("lines", "total"))
        if different:
            if status in rules.ITEMS_LOCKED:
                raise ConflictError("Items and prices are locked once OMS is working on them.")
            if not items:
                raise AppError("A deal needs at least one item.", status_code=422)
            patch.update(new)
    if not patch:
        return detail(user, order_id)
    # What OMS reads changed: the handover must be approved again (OMS keeps the last approved version meanwhile).
    if order.get("handover_status") in ("pending_approval", "approved") and {"expected_delivery", "instructions"} & set(patch):
        patch["handover_status"] = "draft"
    if order.get("published") and "oms_reference" in patch:
        raise ConflictError("The OMS reference is set by OMS.")
    patch["updated_at"] = now_ist().isoformat()
    get_service_client().table("orders").update(patch).eq("id", order_id).execute()
    write_audit(user.id, "update", "orders", order_id, {"fields": sorted(patch)})
    cache.clear()
    return detail(user, order_id)


def delete(user: Profile, order_id: str) -> dict:
    """Hidden everywhere, kept in the database. The deal and its payment are not touched."""
    require_upgraded()
    order = load(user, order_id)
    if order.get("published"):
        raise ConflictError("OMS has this handover, so the deal can't be deleted. Cancel the handover instead.")
    if order["status"] not in rules.DELETABLE:
        raise ConflictError("Cancel this deal first: it is already being fulfilled.")
    now = now_ist().isoformat()
    get_service_client().table("orders").update({"deleted_at": now, "deleted_by": user.id, "updated_at": now}).eq("id", order_id).execute()
    write_audit(user.id, "delete", "orders", order_id, {"orderNumber": order["order_number"]})
    cache.clear()
    return {"id": order_id, "deleted": True}


def tell_owner(order: dict, status: str, note: str | None) -> None:
    owner = order.get("owner_id") or (order.get("lead") or {}).get("owner_id")
    if owner:
        company = (order.get("company") or {}).get("name") or "A client"
        notify(owner, f"order:{order['id']}:{status}:{now_ist().date()}", f"Deal {rules.number(order)}: {rules.LABEL[status]}",
               f"{company}" + (f": {note}" if note else ""), f"/deals/{order['id']}")
