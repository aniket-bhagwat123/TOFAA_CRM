"""The OMS handover: prepare, send for approval, approve, cancel, and apply what OMS reports.

handover_status is the CRM's working copy (draft -> pending_approval -> approved / rejected, or cancelled).
`published` is the last approved handover, the only thing OMS reads. Editing never changes it until it is approved again.
Needs migration 20261130100000_oms_handover.sql.
"""
import logging
from datetime import timedelta

from src.core import cache
from src.core.audit import write_audit
from src.core.dates import now_ist
from src.core.documents import checked_document
from src.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from src.core.storage import DOCUMENTS, signed_urls, upload_document
from src.core.supabase import get_service_client
from src.core.timeline import add_activity
from src.modules.auth.schemas import Profile, Role
from src.modules.notifications.service import notify
from src.modules.orders import flow, handover_rules as rules

log = logging.getLogger(__name__)
NUMBERS_NOT_READY = "Deal and handover numbers are not set up yet. An admin needs to apply the database migration 20261202100000_deal_numbers.sql, then try again."
PAYMENT_NOT_READY = "Payment status is not set up yet. An admin needs to apply the database migration 20261201100000_oms_payment_status.sql, then try again."
NOT_READY = "The OMS handover is not set up yet. An admin needs to apply the database migration 20261130100000_oms_handover.sql, then try again."
APPROVERS = (Role.SALES_MANAGER, Role.ADMIN)
SELECT = (
    "*, company:companies(id,name,city,account_owner_id), owner:profiles!owner_id(id,full_name,email),"
    " lead:leads(id,owner_id,pipeline,occasion,project_title,contact:contacts(id,name),owner:profiles!owner_id(id,full_name,email))"
)
CHANGED = "This handover changed just now. Refresh and try again."


def ready() -> bool:
    """True once the handover migration is applied. Re-checked every minute, so no restart is needed."""

    def check() -> bool:
        try:
            get_service_client().table("orders").select("handover_status,published").limit(1).execute()
            return True
        except Exception:  # noqa: BLE001 - the columns are missing before the migration
            return False

    return cache.reference("order-handover-ready", "orders", 60, check)


def numbered() -> bool:
    """True once the numbering migration is applied. OMS works by handover number, so it needs this."""

    def check() -> bool:
        try:
            get_service_client().table("orders").select("deal_number,handover_number").limit(1).execute()
            return True
        except Exception:  # noqa: BLE001 - the columns are missing before the migration
            return False

    return cache.reference("order-numbers-ready", "orders", 60, check)


def require_numbered() -> None:
    require_ready()
    if not numbered():
        raise AppError(NUMBERS_NOT_READY, status_code=503)


def require_ready() -> None:
    if not ready():
        raise AppError(NOT_READY, status_code=503)


def _owner(order: dict) -> dict | None:
    return order.get("owner") or (order.get("lead") or {}).get("owner")


def status_of(order: dict) -> str | None:
    """The working status. None for an order that never goes to OMS."""
    if order.get("source") == "manual" or not order.get("lead_id"):
        return None
    return order.get("handover_status") or "draft"


def _fetch(order_id: str) -> dict:
    rows = get_service_client().table("orders").select(SELECT).eq("id", order_id).limit(1).execute().data
    if not rows or rows[0].get("deleted_at"):
        raise NotFoundError("Deal not found. It may have been deleted.")
    return rows[0]


def _load(user: Profile, order_id: str) -> dict:
    """The order, if this person may see it, with its first draft filled in (and saved, so item refs never change)."""
    require_ready()
    flow.load(user, order_id)  # access check
    order = flow.snapshot(_fetch(order_id))
    # Only an untouched draft is filled in: what a KAM saved or cleared stays as they left it.
    if status_of(order) and order.get("handover_items") is None and order["status"] not in ("delivered", "cancelled"):
        draft = {**rules.prefill(order), **rules.from_agreement(_agreement(order.get("lead_id")))}  # the agreement wins
        patch = {k: v for k, v in draft.items() if v not in (None, [])}
        if patch:
            get_service_client().table("orders").update(patch).eq("id", order_id).execute()
            order = {**order, **patch}
    return order


def _agreement(lead_id: str | None) -> dict:
    rows = get_service_client().table("agreements").select("details").eq("lead_id", lead_id).limit(1).execute().data if lead_id else []
    return (rows[0] if rows else {}).get("details") or {}


def from_agreement_change(user: Profile, lead_id: str, old: dict, new: dict) -> None:
    """The agreement was saved again: carry what changed into the deal's order. A changed handover goes back to draft,
    to be approved again (OMS keeps the last approved version until then)."""
    if not ready():
        return
    rows = get_service_client().table("orders").select("*").eq("lead_id", lead_id).limit(1).execute().data
    if not rows or rows[0].get("deleted_at"):
        return  # no order yet: it is filled from the agreement when it is made
    order = rows[0]
    if order["status"] in ("delivered", "cancelled") or order.get("handover_status") == "cancelled":
        return
    # An untouched handover is filled from the agreement when it is first opened.
    patch = rules.agreement_changes(order, old, new) if order.get("handover_items") is not None else {}
    changed = bool(patch)
    money_changed = any(old.get(k) != new.get(k) for k in ("packages", "transportation", "gstRate"))
    if money_changed and order.get("items") and order["status"] not in flow.rules.ITEMS_LOCKED:
        agreed = flow.agreed_for(lead_id)
        patch |= flow._stored_money(agreed["items"], agreed["transportation"], agreed["gst_rate"])
    if not patch:
        return
    if changed:
        patch |= {"handover_status": "draft", "handover_note": None}
    _write(order, patch)
    if changed:
        add_activity(lead_id, user.id, "order", outcome="handover_changed",
                     note=f"Deal {flow.rules.number(order)}: the agreement changed, so the handover needs approval again")


def _view(user: Profile, order: dict) -> dict:
    status = status_of(order)
    open_ = bool(status) and status != "cancelled" and order["status"] not in ("delivered", "cancelled")
    items = order.get("handover_items") or []
    files = [f["path"] for key in ("reference_files", "logo_files") for f in order.get(key) or []]
    sample = order.get("sample") or {}
    if sample.get("evidence"):
        files.append(sample["evidence"]["path"])
    files += [p for i in items for p in i.get("photos") or []]
    urls = signed_urls(DOCUMENTS, files) if files else {}
    owner = _owner(order)
    return {
        "order_id": order["id"], "order_number": flow.rules.number(order), "handover_number": order.get("handover_number"),
        "applies": status is not None, "status": status,
        "version": order.get("handover_version") or 0, "published_status": order.get("published_status"),
        "published_at": order.get("published_at"), "submitted_at": order.get("handover_submitted_at"),
        "decided_at": order.get("handover_decided_at"), "note": order.get("handover_note"),
        "company_name": (order.get("company") or {}).get("name"), "owner_name": (owner or {}).get("full_name"),
        "problems": rules.problems(order, (order.get("company") or {}).get("name"), owner) if open_ else [],
        "can_edit": open_, "can_submit": open_ and status in ("draft", "rejected"),
        "can_decide": open_ and status == "pending_approval" and user.role in APPROVERS,
        "can_cancel": open_,
        "form": {
            "client_type": order.get("client_type"), "campaign_name": order.get("campaign_name"), "total_kits": order.get("total_kits"),
            "expected_delivery": order.get("expected_delivery"), "advance_percent": order.get("advance_percent"),
            "design_brief": order.get("design_brief"), "reference_files": order.get("reference_files") or [],
            "logo_files": order.get("logo_files") or [], "sample": sample, "items": items,
            "delivery_locations": order.get("delivery_locations") or [], "instructions": order.get("instructions"),
        },
        "file_urls": [{"path": p, "url": u} for p, u in urls.items()],  # a list: paths must not be renamed to camelCase
        "oms": {
            "order_id": order.get("oms_reference"), "order_number": order.get("oms_order_number"), "stage": order.get("oms_stage"),
            "changed_at": order.get("oms_changed_at"), "confirmed_deadline": order.get("ops_confirmed_deadline"),
            "shipments": order.get("shipments") or [],
        },
    }


def get(user: Profile, order_id: str) -> dict:
    return _view(user, _load(user, order_id))


def start(user: Profile, lead_id: str) -> dict:
    """Begin the handover of a deal whose agreement is signed. The order is made now if the deal has none yet."""
    require_ready()
    from src.modules.leads import service as leads

    lead = leads.get_lead_row(user, lead_id)
    if lead["stage"] == "closed_lost":
        raise ConflictError("This deal is lost.")
    db = get_service_client()
    signed = db.table("agreements").select("signed_at").eq("lead_id", lead_id).limit(1).execute().data
    if not signed or not signed[0].get("signed_at"):
        raise ConflictError("Upload the signed agreement first. The handover starts once it is signed.")
    rows = db.table("orders").select("id,deleted_at").eq("lead_id", lead_id).limit(1).execute().data
    if rows and rows[0].get("deleted_at"):
        raise ConflictError("This deal was deleted.")
    if not rows:
        agreed = flow.agreed_for(lead_id)
        values = {"lead_id": lead_id, "company_id": lead.get("company_id"), "owner_id": lead.get("owner_id"), "handover_status": "draft"}
        if agreed["items"]:
            values |= flow._stored_money(agreed["items"], agreed["transportation"], agreed["gst_rate"])
            values["amount"] = values["total"]
        rows = db.table("orders").upsert(values, on_conflict="lead_id", ignore_duplicates=True).execute().data
        rows = rows or db.table("orders").select("id").eq("lead_id", lead_id).limit(1).execute().data
        add_activity(lead_id, user.id, "order", outcome="new", note="OMS handover started")
        write_audit(user.id, "create", "orders", rows[0]["id"], {"from": "signed agreement", "lead": lead_id})
        cache.clear()
    return {"order_id": rows[0]["id"]}


# --- preparing --------------------------------------------------------------------------------------------------------

def _check_paths(order: dict, paths: list[str]) -> None:
    """Files must be ones uploaded for this order or its deal."""
    prefixes = (f"{order['id']}/", f"{order.get('lead_id')}/")
    if any(not p.startswith(prefixes) or ".." in p for p in paths):
        raise AppError("One of the files does not belong to this deal. Upload it again.", status_code=422)


def _open(order: dict) -> None:
    if not status_of(order):
        raise ConflictError("Deals made by hand do not go to OMS.")
    if status_of(order) == "cancelled" or order["status"] in ("delivered", "cancelled"):
        raise ConflictError("This deal is finished or cancelled, so its handover can no longer change.")


def _write(order: dict, patch: dict) -> None:
    """Save, only if nobody else moved the handover meanwhile."""
    q = get_service_client().table("orders").update({**patch, "updated_at": now_ist().isoformat()}).eq("id", order["id"])
    if order.get("handover_status"):
        q = q.eq("handover_status", order["handover_status"])
    else:
        q = q.is_("handover_status", "null")
    done = q.eq("handover_version", order.get("handover_version") or 0).execute().data
    if not done:
        raise ConflictError(CHANGED)
    cache.clear()


def upload(user: Profile, order_id: str, data: bytes, filename: str | None) -> dict:
    order = _load(user, order_id)
    _open(order)
    mime, ext = checked_document(data, filename)
    path = upload_document(order_id, data, mime, ext)
    name = (filename or f"file.{ext}").strip()[:200] or f"file.{ext}"
    return {"path": path, "name": name, "url": signed_urls(DOCUMENTS, [path]).get(path)}


def save(user: Profile, order_id: str, body: dict) -> dict:
    """Replace the working copy. An approved or waiting handover goes back to draft, to be approved again."""
    order = _load(user, order_id)
    _open(order)
    items = [{**i, "item_ref": i.get("item_ref") or rules.new_ref("IT")} for i in body.pop("items")]
    places = [{**p, "location_ref": p.get("location_ref") or rules.new_ref("LOC")} for p in body.pop("delivery_locations")]
    for rows, key, label in ((items, "item_ref", "item"), (places, "location_ref", "location")):
        if len({r[key] for r in rows}) != len(rows):
            raise AppError(f"Each {label} needs its own reference.", status_code=422)
    gone = {s["location_ref"] for s in order.get("shipments") or []} - {p["location_ref"] for p in places}
    if gone:
        raise ConflictError("A location that already has a shipment cannot be removed.")
    sample = body.pop("sample") or {}
    if body.get("advance_percent") is not None:
        body["advance_percent"] = float(body["advance_percent"])  # as the database returns it, so "unchanged" is seen
    paths = [f["path"] for key in ("reference_files", "logo_files") for f in body.get(key) or []]
    paths += [p for i in items for p in i.get("photos") or []]
    if sample.get("evidence"):
        paths.append(sample["evidence"]["path"])
    _check_paths(order, paths)
    values = {**body, "handover_items": items, "delivery_locations": places, "sample": sample}
    if all(order.get(k) == v for k, v in values.items()):
        return _view(user, order)  # nothing changed: an approval stays
    _write(order, {**values, "handover_status": "draft", "handover_note": None})
    write_audit(user.id, "handover_save", "orders", order_id, {"dealNumber": flow.rules.number(order)})
    return get(user, order_id)


def submit(user: Profile, order_id: str) -> dict:
    order = _load(user, order_id)
    _open(order)
    if status_of(order) not in ("draft", "rejected"):
        raise ConflictError("This handover is already sent or approved. Change it to send it again.")
    found = rules.problems(order, (order.get("company") or {}).get("name"), _owner(order))
    if found:
        raise AppError("The handover is not complete.", {"errors": [{"field": "handover", "message": m} for m in found]}, 422)
    now = now_ist().isoformat()
    _write(order, {"handover_status": "pending_approval", "handover_submitted_at": now, "handover_submitted_by": user.id,
                   "handover_note": None})
    approvers = (get_service_client().table("profiles").select("id").in_("role", [r.value for r in APPROVERS])
                 .eq("is_active", True).execute().data)
    for row in approvers:
        if row["id"] != user.id:
            notify(row["id"], f"handover:{order_id}:{now}", f"Deal {flow.rules.number(order)}: handover needs approval",
                   (order.get("company") or {}).get("name"), "/approvals")
    write_audit(user.id, "handover_submit", "orders", order_id, {"dealNumber": flow.rules.number(order)})
    return get(user, order_id)


def pending(user: Profile) -> list[dict]:
    """Handovers waiting for a Sales Manager."""
    if user.role not in APPROVERS:
        raise ForbiddenError()
    if not ready():
        return []
    rows = (get_service_client().table("orders").select(SELECT).eq("handover_status", "pending_approval").is_("deleted_at", "null")
            .order("handover_submitted_at").limit(100).execute().data)
    return [{
        "order_id": r["id"], "order_number": flow.rules.number(r), "handover_number": r.get("handover_number"), "company_name": (r.get("company") or {}).get("name"),
        "owner_name": (_owner(r) or {}).get("full_name"), "total_kits": r.get("total_kits"),
        "delivery_deadline": r.get("expected_delivery"), "advance_percent": r.get("advance_percent"),
        "version": r.get("handover_version") or 0, "submitted_at": r.get("handover_submitted_at"),
    } for r in rows]


def decide(user: Profile, order_id: str, approve: bool, version: int, submitted_at: str, note: str | None) -> dict:
    if user.role not in APPROVERS:
        raise ForbiddenError("Only a Sales Manager or an admin can approve a handover.")
    order = _load(user, order_id)
    _open(order)
    current = order.get("handover_version") or 0
    if status_of(order) != "pending_approval":
        raise ConflictError("This handover is not waiting for approval.")
    if current != version or rules.parse_time(submitted_at) != rules.parse_time(order.get("handover_submitted_at")):
        raise ConflictError(CHANGED)
    now = now_ist().isoformat()
    patch = {"handover_decided_at": now, "handover_decided_by": user.id, "handover_note": note}
    if not approve:
        if not note:
            raise AppError("Add a short note saying why.", status_code=422)
        _write(order, {**patch, "handover_status": "rejected"})
    else:
        if not order.get("handover_number"):
            raise AppError(NUMBERS_NOT_READY, status_code=503)
        owner = _owner(order)
        found = rules.problems(order, (order.get("company") or {}).get("name"), owner)
        if found:
            raise AppError("The handover is not complete.", {"errors": [{"field": "handover", "message": m} for m in found]}, 422)
        published = rules.build(order, order["company"], owner, current + 1)
        _write(order, {**patch, "handover_status": "approved", "handover_version": current + 1, "published": published,
                       "published_status": "approved", "published_at": now})
        if order["status"] in ("new", "rejected"):
            flow.move({**order}, "ready", actor_id=user.id, note="Handover approved")
    add_activity(order["lead_id"], user.id, "order", outcome="handover_approved" if approve else "handover_rejected",
                 note=f"Deal {flow.rules.number(order)}: handover {'approved' if approve else 'rejected'}" + (f": {note}" if note else ""))
    owner_id = (_owner(order) or {}).get("id")
    if owner_id and owner_id != user.id:
        notify(owner_id, f"handover-decision:{order_id}:{now}", f"Deal {flow.rules.number(order)}: handover {'approved' if approve else 'rejected'}",
               note or (order.get("company") or {}).get("name"), f"/deals/{order_id}")
    write_audit(user.id, "handover_decision", "orders", order_id, {"approved": approve, "version": current + (1 if approve else 0)})
    return get(user, order_id)


def cancel(user: Profile, order_id: str, note: str) -> dict:
    """Cancel from the CRM. If OMS has seen the handover it reads it as cancelled and decides there (its stage comes
    back through the status API); the CRM status waits for that. If OMS never saw it, the order is cancelled now."""
    order = _load(user, order_id)
    _open(order)
    seen = order.get("published")
    patch = {"handover_status": "cancelled", "handover_note": note}
    if seen:
        version = (order.get("handover_version") or 0) + 1
        patch |= {"handover_version": version, "published": {**seen, "version": version}, "published_status": "cancelled",
                  "published_at": now_ist().isoformat()}
    _write(order, patch)
    if not seen:
        flow.move({**order}, "cancelled", actor_id=user.id, note=note)
    add_activity(order["lead_id"], user.id, "order", outcome="handover_cancelled", note=f"Deal {flow.rules.number(order)}: handover cancelled: {note}")
    write_audit(user.id, "handover_cancel", "orders", order_id, {"sentToOms": bool(seen)})
    return get(user, order_id)


# --- what OMS reports --------------------------------------------------------------------------------------------------

def _published_query():
    return (get_service_client().table("orders").select("*", count="exact").not_.is_("published", "null").is_("deleted_at", "null"))


def find_published(handover_number: str) -> dict:
    require_numbered()
    rows = _published_query().eq("handover_number", handover_number.strip().upper()).limit(1).execute().data
    if not rows:
        raise NotFoundError("No approved handover has that handover number.")
    return rows[0]


def public(rows: list[dict]) -> list[dict]:
    """Handovers as OMS reads them, with fresh file links."""
    paths = [p for r in rows for p in rules.paths_in(r["published"])]
    urls = signed_urls(DOCUMENTS, paths) if paths else {}
    return [{**rules.with_links(r["published"], urls), "status": r["published_status"], "updated_at": rules.utc(r["published_at"])}
            for r in rows]


def list_published(status: str | None, updated_since, page: int, limit: int) -> dict:
    require_numbered()
    q = _published_query()
    if status:
        q = q.eq("published_status", status)
    if updated_since:
        q = q.gte("published_at", updated_since.isoformat())
    res = q.order("published_at").order("handover_number").range((page - 1) * limit, page * limit - 1).execute()
    return {"items": public(res.data), "page": page, "limit": limit, "total": res.count or 0}


def _mark_won(row: dict, oms_order_number: str) -> None:
    """The OMS has made the Order (it sent its TOF-ORD number): the deal is Won, once. The won value is the agreement
    total. A deal already closed is left as it is."""
    from src.modules.clients.service import on_deal_won  # local import: clients imports quotations and leads
    from src.modules.tasks import service as tasks

    lead_id = row.get("lead_id")
    if not lead_id:
        return
    db = get_service_client()
    leads = db.table("leads").select("id,stage,owner_id,company:companies(name)").eq("id", lead_id).limit(1).execute().data
    if not leads or leads[0].get("stage") in ("closed_won", "closed_lost"):
        return
    lead = leads[0]
    agreed = db.table("agreements").select("total_amount").eq("lead_id", lead_id).limit(1).execute().data
    value = (agreed[0].get("total_amount") if agreed else None) or row.get("total") or row.get("amount")
    now = now_ist().isoformat()
    patch = {"stage": "closed_won", "closed_at": now, "next_follow_up": None, "updated_at": now, "lost_reason": None}
    if value:
        patch["paid_amount"] = float(value)  # the column targets and reports count a won deal by
    if not db.table("leads").update(patch).eq("id", lead_id).eq("stage", lead["stage"]).execute().data:
        return  # it moved just now: the next OMS message tries again
    note = f"OMS created Order {oms_order_number}"
    tasks.close_open_tasks(lead_id, "won")
    add_activity(lead_id, None, "stage_change", note=note, meta={"from": lead["stage"], "to": "closed_won", "auto": True})
    if lead.get("owner_id"):
        notify(lead["owner_id"], f"won:{row['id']}", "Deal won", f"{(lead.get('company') or {}).get('name')}: {note}", f"/leads/{lead_id}")
    on_deal_won(lead_id)  # the first won deal makes the company a client
    write_audit("", "deal_won", "leads", lead_id, {"omsOrderNumber": oms_order_number, "value": value})


def _result(handover_number: str, applied: bool, status: str, stage: str | None, steps: list[str]) -> dict:
    return {"handover_number": handover_number, "applied": applied, "crm_status": status, "oms_stage": stage, "recorded_steps": steps}


def apply_oms_update(handover_number: str, update: dict) -> tuple[dict, str]:
    """One status message from OMS. Repeats and older messages change nothing; the status never moves backwards;
    skipped stages are filled in and each is logged."""
    row = find_published(handover_number)
    number, current, stage = row["handover_number"], row["status"], update["stage"]
    if row.get("oms_stage") and row.get("oms_reference") != update["oms_order_id"]:  # linked by an earlier update
        raise ConflictError("This handover is already linked to a different oms_order_id.")
    changed = update["changed_at"]
    if changed > now_ist() + timedelta(minutes=10):
        raise AppError("changed_at is in the future.", status_code=422)
    last = rules.parse_time(row.get("oms_changed_at"))
    if last and changed <= last:
        return _result(number, False, current, row.get("oms_stage"), []), "Ignored: not newer than the last update."

    published = row["published"]
    incoming = [{k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in s.items()} for s in update.get("locations") or []]
    known = {p["location_ref"] for p in published.get("delivery_locations") or []} | {s["location_ref"] for s in row.get("shipments") or []}
    unknown = sorted({s["location_ref"] for s in incoming} - known)
    if unknown:
        raise AppError(f"Unknown location_ref: {', '.join(unknown)}.", status_code=422)
    for s in incoming:
        if stage == "dispatched":
            s["dispatched_at"] = s.get("dispatched_at") or changed.isoformat()
        if stage == "delivered":
            s["delivered_at"] = s.get("delivered_at") or changed.isoformat()
    try:
        shipments = rules.merge_shipments(row.get("shipments") or [], incoming)
    except ValueError as exc:
        raise AppError(str(exc), status_code=422) from exc

    steps = rules.plan(current, row.get("held_from"), stage, shipments, published)
    now = now_ist().isoformat()
    patch = {"oms_reference": update["oms_order_id"], "oms_order_number": update["oms_order_number"], "oms_stage": stage,
             "oms_changed_at": changed.isoformat(), "shipments": shipments, "updated_at": now}
    if update.get("confirmed_delivery_deadline"):
        patch["ops_confirmed_deadline"] = update["confirmed_delivery_deadline"].isoformat()
    if steps:
        final = steps[-1]
        patch |= {"status": final, "status_updated_at": now, "delivered_at": now if final == "delivered" else None,
                  "held_from": current if final == "on_hold" else None}
    if shipments:  # the order's single shipment fields show the latest one
        latest = shipments[-1]
        patch |= {"courier": latest.get("transporter"), "tracking_number": latest.get("tracking_number")}
    q = get_service_client().table("orders").update(patch).eq("id", row["id"]).eq("status", current)
    q = q.eq("oms_changed_at", row["oms_changed_at"]) if row.get("oms_changed_at") else q.is_("oms_changed_at", "null")
    if not q.execute().data:
        raise ConflictError("This handover changed just now. Send the update again.")

    note = update.get("note")
    before = current
    for step in steps:
        filled = step != steps[-1]
        flow._record({**row, "status": before}, step, None, "OMS",
                     f"Filled in: OMS reported {stage}" if filled else note or f"OMS: {stage}")
        before = step
    write_audit("", "oms_update", "orders", row["id"], {"stage": stage, "steps": steps, "changedAt": changed.isoformat()})
    # The KAM is told about every status change, and always about a hold or cancellation (with the OMS note).
    if steps or stage in ("on_hold", "cancelled"):
        flow.tell_owner(row, before, note)
    if stage != "cancelled":
        try:
            _mark_won(row, update["oms_order_number"])
        except Exception:  # noqa: BLE001 - the OMS update is saved; the next message tries again
            log.exception("could not mark the deal as won")
    cache.clear()
    return _result(number, True, before, stage, steps), "Update applied."


def apply_oms_payment(handover_number: str, status: str, changed) -> tuple[dict, str]:
    """The payment status from OMS. The CRM only shows it: no payment request, invoice or deal stage is touched."""
    row = find_published(handover_number)
    number = row["handover_number"]
    if "oms_payment_status" not in row:
        raise AppError(PAYMENT_NOT_READY, status_code=503)
    if changed > now_ist() + timedelta(minutes=10):
        raise AppError("changed_at is in the future.", status_code=422)
    current = row.get("oms_payment_status") or "pending"
    last = rules.parse_time(row.get("oms_payment_changed_at"))
    if last and changed <= last:
        return {"handover_number": number, "applied": False, "payment_status": current}, "Ignored: not newer than the last update."
    q = get_service_client().table("orders").update(
        {"oms_payment_status": status, "oms_payment_changed_at": changed.isoformat(), "updated_at": now_ist().isoformat()}
    ).eq("id", row["id"])
    q = (q.eq("oms_payment_changed_at", row["oms_payment_changed_at"]) if row.get("oms_payment_changed_at")
         else q.is_("oms_payment_changed_at", "null"))
    if not q.execute().data:
        raise ConflictError("This handover changed just now. Send the update again.")
    if status != current:
        word = "successful" if status == "success" else "pending"
        if row.get("lead_id"):
            add_activity(row["lead_id"], None, "order", outcome=f"payment_{status}", note=f"Deal {flow.rules.number(row)}: OMS reports the payment is {word}")
        if row.get("owner_id"):
            notify(row["owner_id"], f"oms-payment:{row['id']}:{changed.isoformat()}", f"Deal {flow.rules.number(row)}: payment {word}", None, f"/deals/{row['id']}")
    write_audit("", "oms_payment", "orders", row["id"], {"status": status, "changedAt": changed.isoformat()})
    cache.clear()
    return {"handover_number": number, "applied": True, "payment_status": status}, "Payment status saved."
