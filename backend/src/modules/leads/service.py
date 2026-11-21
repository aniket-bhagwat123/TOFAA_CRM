from uuid import uuid4

from src.core import cache
from src.core.access import assert_can_access_lead, require_lead_role, visible_owner_ids
from src.core.audit import write_audit
from src.core.concurrency import check_version
from src.core.dates import now_ist, next_business_day, today_ist
from src.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from src.core.images import checked_upload
from src.core.keys import company_key, email_key, phone_key
from src.core.pagination import PageParams, page_meta, parse_sort
from src.core.parallel import par
from src.core.storage import CLIENT_IMAGES, delete_image, guard_photo_write, signed_url, signed_urls, upload_image
from src.core.supabase import get_service_client
from src.core.timeline import add_activity
from src.modules.auth.schemas import Profile, Role
from src.modules.leads import schemas
from src.modules.leads.stages import lost_from, stage_label
from src.modules.leads.stages import (
    CLOSED,
    LOST_REASONS,
    NUMERIC_INPUTS,
    POSITION,
    PREREQUISITES,
    REQUIRED_INPUTS,
    SOURCES,
    STAGES,
    STAGES_FOR,
    stage_for_pipeline,
    VALUE_BANDS,
    is_closed,
    moves_forward,
)
from src.modules.leads.value import deal_value, value_source
from src.modules.tasks import service as tasks

LEAD_SELECT = (
    "*, company:companies(id,name,kind,city,client_since), contact:contacts(*),"
    " owner:profiles!owner_id(id,full_name)"
)
SORTABLE = {"created_at", "updated_at", "next_follow_up", "last_activity_at", "stage"}
VIEW_TTL = 20  # seconds; any write on this server clears cached views at once (core.cache)


# --- helpers ---------------------------------------------------------------------------------

def get_lead_row(user: Profile, lead_id: str) -> dict:
    """The lead with company, contact and owner, after checking the user may see it."""
    require_lead_role(user)
    rows = get_service_client().table("leads").select(LEAD_SELECT).eq("id", lead_id).limit(1).execute().data
    if not rows:
        raise NotFoundError("Lead not found.")
    assert_can_access_lead(user, rows[0])
    return attach_photos(rows)[0]


def _owner_ids_for(user: Profile, owner_id: str | None) -> list[str] | None:
    """Narrow what the user may see to one owner if asked."""
    visible = visible_owner_ids(user)
    if owner_id:
        if visible is not None and owner_id not in visible:
            raise ForbiddenError()
        return [owner_id]
    return visible


def _matching_company_ids(term: str) -> list[str]:
    db = get_service_client()
    like = f"%{term.strip()}%"
    by_company, by_contact = par(
        lambda: db.table("companies").select("id").ilike("name", like).limit(300).execute().data,
        lambda: db.table("contacts").select("company_id").ilike("name", like).limit(300).execute().data,
    )
    return list({r["id"] for r in by_company} | {r["company_id"] for r in by_contact})


def meta() -> dict:
    """Stage settings, sources and so on. Changes rarely, so it is kept for five minutes."""

    def load() -> dict:
        stages = get_service_client().table("stage_config").select("*").order("position").execute().data
        return {
            "stages": stages,
            "sources": SOURCES,
            "lostReasons": LOST_REASONS,
            "valueBands": VALUE_BANDS,
            "requiredInputs": REQUIRED_INPUTS,
        }

    return cache.reference("stages", "meta", 300, load)


# --- duplicates -------------------------------------------------------------------------------

def find_duplicates(user: Profile, company_name: str | None, phone: str | None, email: str | None) -> list[dict]:
    """Existing leads matching on phone, email or company name. Shows the owner, not the full record."""
    db = get_service_client()
    pk, ek, ck = phone_key(phone), email_key(email), company_key(company_name)
    matched: dict[str, set[str]] = {}  # company_id -> reasons

    clauses = []
    if pk:
        clauses.append(f"phone_key.eq.{pk}")
    if ek:
        clauses.append(f"email_key.eq.{ek}")

    def contacts() -> list[dict]:
        if not clauses:
            return []
        return db.table("contacts").select("company_id,phone_key,email_key").or_(",".join(clauses)).limit(50).execute().data

    def companies() -> list[dict]:
        if not ck:
            return []
        return db.table("companies").select("id").eq("name_key", ck).limit(50).execute().data

    contact_rows, company_rows = par(contacts, companies)  # one round trip for both
    for c in contact_rows:
        reasons = matched.setdefault(c["company_id"], set())
        if pk and c["phone_key"] == pk:
            reasons.add("phone")
        if ek and c["email_key"] == ek:
            reasons.add("email")
    for c in company_rows:
        matched.setdefault(c["id"], set()).add("company")
    if not matched:
        return []

    visible = visible_owner_ids(user)
    rows = (
        db.table("leads").select(LEAD_SELECT).in_("company_id", list(matched)).order("created_at", desc=True).limit(20).execute().data
    )
    return [
        {
            "leadId": r["id"],
            "companyName": r["company"]["name"],
            "contactName": r["contact"]["name"],
            "stage": r["stage"],
            "ownerName": (r.get("owner") or {}).get("full_name"),
            "matchedOn": sorted(matched[r["company_id"]]),
            "canOpen": visible is None or r["owner_id"] in visible,
            "companyId": r["company_id"],
            "isClient": bool((r.get("company") or {}).get("client_since")),
            "pipeline": r.get("pipeline") or "new_business",
        }
        for r in rows
    ]


# --- create / read -----------------------------------------------------------------------------

def create_lead(user: Profile, body: schemas.LeadCreate) -> dict:
    require_lead_role(user)
    dups = find_duplicates(user, body.company_name, body.phone, body.email)
    # A second contact at an existing company is allowed only when the executive says so
    # and nothing else (phone / email) matches.
    only_company = bool(dups) and all(d["matchedOn"] == ["company"] for d in dups)
    if dups and not (only_company and body.use_existing_company):
        raise ConflictError("This lead already exists.", data={"duplicates": dups})

    owner_id = user.id
    if body.owner_id and body.owner_id != user.id:
        if user.role == Role.SALES_EXECUTIVE:
            raise ForbiddenError("You can only create leads for yourself.")
        if visible_owner_ids(user) is not None and body.owner_id not in visible_owner_ids(user):
            raise ForbiddenError()
        owner_id = body.owner_id

    db = get_service_client()
    if only_company and body.use_existing_company:
        company = db.table("companies").select("id,name,kind,city").eq("name_key", company_key(body.company_name)).limit(1).execute().data[0]
    else:
        company = (
            db.table("companies")
            .insert({"name": body.company_name, "name_key": company_key(body.company_name), "city": body.city, "created_by": user.id})
            .execute().data[0]
        )
    contact = (
        db.table("contacts")
        .insert(
            {
                "company_id": company["id"], "name": body.contact_name, "designation": body.designation,
                "phone": body.phone, "phone_key": phone_key(body.phone),
                "email": body.email, "email_key": email_key(body.email),
            }
        )
        .execute().data[0]
    )
    due = body.next_follow_up or next_business_day()
    lead = (
        db.table("leads")
        .insert(
            {
                "company_id": company["id"], "contact_id": contact["id"], "owner_id": owner_id, "stage": "new_lead",
                "source": body.source, "value_band": body.value_band, "notes": body.notes, "created_by": user.id,
                "next_follow_up": due.isoformat(),  # set here, so no separate update is needed
            }
        )
        .execute().data[0]
    )
    # The first task and the timeline entry only need the lead to exist: one round trip for both.
    par(
        lambda: db.table("tasks").insert(
            {"id": str(uuid4()), "lead_id": lead["id"], "owner_id": owner_id, "kind": "follow_up", "title": "First follow-up", "due_date": due.isoformat()}
        ).execute(),
        lambda: db.table("activities").insert(
            {"lead_id": lead["id"], "actor_id": user.id, "kind": "created", "note": "Lead created", "meta": {"source": body.source}}
        ).execute(),
    )
    write_audit(user.id, "create", "leads", lead["id"], {"company": body.company_name})
    # Build the response from what we already have instead of reading it all back.
    return {
        **lead,
        "company": {k: company.get(k) for k in ("id", "name", "kind", "city")},
        "contact": {k: contact.get(k) for k in ("id", "name", "designation", "phone", "email")} | {"photo_url": None},
        "owner": {"id": owner_id, "full_name": user.full_name if owner_id == user.id else None},
    }


def _lead_filters(q, user: Profile, *, stage, overdue, source, owner_id, search, pipeline="new_business", company_id=None, occasion=None, origin=None):
    q = q.eq("pipeline", pipeline if pipeline in STAGES_FOR else "new_business")  # Leads and Pipeline show one pipeline at a time
    owners = _owner_ids_for(user, owner_id)
    if owners is not None:
        q = q.in_("owner_id", owners)
    if stage:
        q = q.in_("stage", [s for s in stage.split(",") if s in STAGES_FOR.get(pipeline, STAGES)])
    if source:
        q = q.eq("source", source)
    if company_id:  # one client's projects
        q = q.eq("company_id", company_id)
    if occasion:
        q = q.eq("occasion", occasion)
    if origin:
        q = q.eq("origin", origin)
    if overdue:
        q = q.lt("next_follow_up", today_ist().isoformat()).not_.in_("stage", list(CLOSED))
    if search and search.strip():
        ids = _matching_company_ids(search)
        q = q.in_("company_id", ids or ["00000000-0000-0000-0000-000000000000"])
    return q


def list_leads(user: Profile, page: PageParams, *, stage=None, overdue=False, source=None, owner_id=None, pipeline="new_business", company_id=None, occasion=None, origin=None) -> dict:
    require_lead_role(user)
    params = {"page": page.page, "limit": page.limit, "search": page.search, "sort": page.sort, "stage": stage, "overdue": overdue, "source": source, "owner": owner_id, "pipeline": pipeline, "c": company_id, "oc": occasion, "or": origin}

    def load() -> dict:
        col, desc = parse_sort(page.sort, SORTABLE, "last_activity_at")
        q = get_service_client().table("leads").select(LEAD_SELECT, count="exact")
        q = _lead_filters(q, user, stage=stage, overdue=overdue, source=source, owner_id=owner_id, search=page.search, pipeline=pipeline, company_id=company_id, occasion=occasion, origin=origin)
        res = q.order(col, desc=desc).range(page.start, page.end).execute()
        return {"items": attach_photos(res.data), "meta": page_meta(page, res.count or 0)}

    return cache.memo("leads", user.id, params, VIEW_TTL, load)


def board(user: Profile, *, overdue=False, source=None, owner_id=None, search=None, pipeline="new_business", company_id=None, occasion=None, origin=None) -> list[dict]:
    """All leads for the Kanban board (capped at 500), newest activity first."""
    require_lead_role(user)

    def load() -> list[dict]:
        q = get_service_client().table("leads").select(LEAD_SELECT)
        q = _lead_filters(q, user, stage=None, overdue=overdue, source=source, owner_id=owner_id, search=search, pipeline=pipeline, company_id=company_id, occasion=occasion, origin=origin)
        return attach_photos(q.order("last_activity_at", desc=True).limit(500).execute().data)

    return cache.memo("board", user.id, {"o": overdue, "s": source, "w": owner_id, "q": search, "p": pipeline, "c": company_id, "oc": occasion, "or": origin}, VIEW_TTL, load)


def get_lead_detail(user: Profile, lead_id: str) -> dict:
    require_lead_role(user)
    return cache.memo("lead", user.id, lead_id, VIEW_TTL, lambda: _lead_detail(user, lead_id))


def _lead_detail(user: Profile, lead_id: str) -> dict:
    db = get_service_client()
    # Four independent reads in one round trip. Access is checked on the lead before anything is returned.
    rows, open_tasks, meetings, timeline = par(
        lambda: db.table("leads").select(LEAD_SELECT).eq("id", lead_id).limit(1).execute().data,
        lambda: db.table("tasks").select("*").eq("lead_id", lead_id).is_("done_at", "null").order("due_date").execute().data,
        lambda: db.table("meetings").select("*").eq("lead_id", lead_id).order("starts_at", desc=True).limit(20).execute().data,
        lambda: db.table("activities").select("*, actor:profiles!actor_id(full_name)").eq("lead_id", lead_id)
        .order("created_at", desc=True).limit(150).execute().data,
    )
    if not rows:
        raise NotFoundError("Lead not found.")
    assert_can_access_lead(user, rows[0])
    lead = attach_photos(rows)[0]
    # Where a lost lead stopped, so the screen shows the road it really travelled and offers only those stages to reopen.
    lead["lost_from_stage"] = lost_from(timeline) if lead.get("stage") == "closed_lost" else None
    return {"lead": lead, "tasks": open_tasks, "meetings": meetings, "timeline": timeline}


# --- update ----------------------------------------------------------------------------------------

def update_lead(user: Profile, lead_id: str, body: schemas.LeadUpdate) -> dict:
    lead = get_lead_row(user, lead_id)
    check_version(lead, body.version)
    db = get_service_client()
    fields = body.model_fields_set

    lead_patch = {k: getattr(body, k) for k in ("source", "value_band", "notes", "estimate_amount") if k in fields}
    if lead_patch.get("value_band") and lead_patch["value_band"] not in VALUE_BANDS:
        raise AppError("Unknown value band.", status_code=422)
    contact_patch = {k: getattr(body, k) for k in ("designation", "phone", "email") if k in fields}
    if "contact_name" in fields and body.contact_name:
        contact_patch["name"] = body.contact_name
    keys = {}
    if "phone" in contact_patch:
        keys["phone_key"] = phone_key(contact_patch["phone"])
    if "email" in contact_patch:
        keys["email_key"] = email_key(contact_patch["email"])
    company_patch = {}
    if "company_name" in fields and body.company_name:
        company_patch.update(name=body.company_name, name_key=company_key(body.company_name))
    if "city" in fields:
        company_patch["city"] = body.city

    # The version check goes first on its own: if someone else edited, nothing else is written.
    lead_patch.update(version=lead["version"] + 1, updated_at=now_ist().isoformat())
    res = db.table("leads").update(lead_patch).eq("id", lead_id).eq("version", lead["version"]).execute()
    if not res.data:
        raise ConflictError("This record was changed by someone else.", data={"latest": get_lead_row(user, lead_id)})
    writes = []
    if contact_patch:
        writes.append(lambda: db.table("contacts").update({**contact_patch, **keys}).eq("id", lead["contact_id"]).execute())
    if company_patch:
        writes.append(lambda: db.table("companies").update(company_patch).eq("id", lead["company_id"]).execute())
    if writes:
        par(*writes)
    write_audit(user.id, "update", "leads", lead_id, {**lead_patch, **contact_patch, **company_patch})
    # Return the merged result instead of reading it back.
    return {
        **lead, **lead_patch,
        "contact": {**lead["contact"], **contact_patch},
        "company": {**lead["company"], **{k: v for k, v in company_patch.items() if k != "name_key"}},
    }


# --- stage -------------------------------------------------------------------------------------------

def auto_advance(lead: dict, target: str, actor_id: str | None, reason: str) -> bool:
    """Move a lead forward because of something the executive did (call logged, meeting created ...).

    The same action means a different stage on a client project (a meeting is "Meeting", a sent quotation is
    "Proposal"), and some actions have no stage there at all (a call does not move a project).
    """
    mapped = stage_for_pipeline(lead.get("pipeline"), target)
    if not mapped or not moves_forward(lead["stage"], mapped):
        return False
    target = mapped
    db = get_service_client()
    par(
        lambda: db.table("leads").update({"stage": target, "updated_at": now_ist().isoformat()}).eq("id", lead["id"]).execute(),
        lambda: add_activity(lead["id"], actor_id, "stage_change", note=reason, meta={"from": lead["stage"], "to": target, "auto": True}),
    )
    write_audit(actor_id or "", "stage_change", "leads", lead["id"], {"from": lead["stage"], "to": target, "auto": True})
    lead["stage"] = target
    return True


def move_stage(user: Profile, lead_id: str, body: schemas.StageMove) -> dict:
    """Manual move (drag on the board). Asks for the next follow-up date and the stage's required inputs."""
    lead = get_lead_row(user, lead_id)
    target, current = body.stage, lead["stage"]
    if target == current:
        raise AppError("The lead is already in this stage.")
    pipeline = lead.get("pipeline") or "new_business"
    if target not in STAGES_FOR.get(pipeline, STAGES):
        raise AppError("That stage is not part of this pipeline.", status_code=422)
    errors: list[dict] = []

    if current == "closed_won":
        raise AppError("This deal is won and paid. It cannot be moved.", status_code=409)
    reopening = current == "closed_lost"
    if reopening and not is_closed(target):
        # A lost lead reopens where it stopped, or earlier: never at a stage it never reached.
        stopped = lost_from_stage(lead_id)
        if stopped and POSITION.get(target, 0) > POSITION.get(stopped, 0):
            raise AppError(
                f"This lead was lost at {stage_label(stopped)}. Reopen it at that stage or an earlier one.",
                {"errors": [{"field": "stage", "message": "Pick the stage it was lost at, or an earlier one."}]}, 422,
            )

    if target == "closed_won":
        # Only a confirmed payment (the ERP, or Finance through the Payments screen) closes a deal as won.
        raise ForbiddenError("Closed Won is set when payment is confirmed by Finance or the ERP. It cannot be set here.")
    if target == "closed_lost":
        if not body.lost_reason:
            errors.append({"field": "lostReason", "message": "Pick a reason."})
    elif not body.next_follow_up:
        errors.append({"field": "nextFollowUp", "message": "Pick the next follow-up date."})

    requirement = {**(lead.get("requirement") or {})}
    for field in REQUIRED_INPUTS.get(target, []):
        value = body.requirement.get(field, requirement.get(field))
        if value in (None, ""):
            errors.append({"field": field, "message": "Required for this stage."})
        elif field in NUMERIC_INPUTS and not _positive_number(value):
            errors.append({"field": field, "message": "Enter a number greater than 0."})
        else:
            requirement[field] = value
    if target == "meeting_scheduled" and not reopening:
        has = (
            get_service_client().table("meetings").select("id").eq("lead_id", lead_id).eq("status", "scheduled").limit(1).execute().data
        )
        if not has:
            errors.append({"field": "meeting", "message": "Create a meeting (date, time, type) to move here."})
    # Moving forward needs the paperwork that stage stands for. Moving back, or reopening, never does.
    if POSITION[target] > POSITION[current] and target in PREREQUISITES:
        table, column, expected, field, message = PREREQUISITES[target]
        q = get_service_client().table(table).select("*").eq("lead_id", lead_id)
        q = q.eq(column, expected) if expected is not None else q.not_.is_(column, "null")
        if not q.limit(1).execute().data:
            errors.append({"field": field, "message": message})
    if errors:
        raise AppError("Some required details are missing.", {"errors": errors}, 422)

    patch = {"stage": target, "requirement": requirement, "updated_at": now_ist().isoformat(), "version": lead["version"] + 1}
    if target == "closed_lost":
        patch["lost_reason"] = body.lost_reason
        patch["closed_at"] = now_ist().isoformat()
    elif is_closed(current):
        patch["lost_reason"] = None  # reopened
        patch["closed_at"] = None
    if target == "requirement_received" and requirement.get("budget"):
        patch["estimate_amount"] = float(requirement["budget"])  # the deal value now has an estimate
    db = get_service_client()
    par(
        lambda: db.table("leads").update(patch).eq("id", lead_id).execute(),
        lambda: add_activity(lead_id, user.id, "stage_change", note=body.lost_reason, meta={"from": current, "to": target, "auto": False}),
        (lambda: tasks.close_open_tasks(lead_id, "closed")) if is_closed(target)
        else (lambda: tasks.set_next_action(lead_id, lead["owner_id"], body.next_follow_up)),
    )
    write_audit(user.id, "stage_change", "leads", lead_id, {"from": current, "to": target})
    next_follow_up = None if is_closed(target) else body.next_follow_up.isoformat()
    return {**lead, **patch, "next_follow_up": next_follow_up}


def lost_from_stage(lead_id: str) -> str | None:
    rows = (
        get_service_client().table("activities").select("kind,meta").eq("lead_id", lead_id).eq("kind", "stage_change")
        .order("created_at", desc=True).limit(30).execute().data
    )
    return lost_from(rows)


# --- reassign ---------------------------------------------------------------------------------------------

def reassign(user: Profile, lead_id: str, body: schemas.Reassign) -> dict:
    if user.role not in (Role.ADMIN, Role.SALES_MANAGER):
        raise ForbiddenError("Only managers can reassign leads.")
    db = get_service_client()
    lead, target = par(
        lambda: get_lead_row(user, lead_id),
        lambda: db.table("profiles").select("id,full_name,role,is_active").eq("id", body.owner_id).limit(1).execute().data,
    )
    visible = visible_owner_ids(user)
    if visible is not None and body.owner_id not in visible:
        raise ForbiddenError("You can only assign to people on your team.")
    if not target or not target[0]["is_active"] or target[0]["role"] not in (Role.SALES_EXECUTIVE.value, Role.SALES_MANAGER.value):
        raise AppError("Pick an active sales executive or manager.", status_code=422)
    now = now_ist().isoformat()
    par(
        lambda: db.table("leads").update({"owner_id": body.owner_id, "updated_at": now}).eq("id", lead_id).execute(),
        lambda: db.table("tasks").update({"owner_id": body.owner_id}).eq("lead_id", lead_id).is_("done_at", "null").execute(),
        lambda: db.table("meetings").update({"owner_id": body.owner_id}).eq("lead_id", lead_id).eq("status", "scheduled").execute(),
        lambda: add_activity(
            lead_id, user.id, "reassign", note=body.note,
            meta={"from": lead["owner_id"], "to": body.owner_id, "toName": target[0]["full_name"]},
        ),
    )
    write_audit(user.id, "reassign", "leads", lead_id, {"from": lead["owner_id"], "to": body.owner_id})
    return {**lead, "owner_id": body.owner_id, "owner": {"id": body.owner_id, "full_name": target[0]["full_name"]}}


# --- client photo ---------------------------------------------------------------------------------------

def attach_photos(rows: list[dict]) -> list[dict]:
    """Replace each contact's storage path with a short-lived signed URL (one batched request, cached)."""
    urls = signed_urls(CLIENT_IMAGES, [(r.get("contact") or {}).get("photo_path") for r in rows])
    for r in rows:
        contact = r.get("contact")
        if contact is not None:
            url = urls.get(contact.get("photo_path") or "")
            # Only the fields the app needs (the row has internal duplicate-check keys too).
            r["contact"] = {k: contact.get(k) for k in ("id", "name", "designation", "phone", "email")} | {"photo_url": url}
        r["deal_value"] = deal_value(r)
        r["value_source"] = value_source(r)
    return rows


def set_photo(user: Profile, lead_id: str, data: bytes) -> dict:
    lead = get_lead_row(user, lead_id)
    mime, ext = checked_upload(data)
    path = upload_image(CLIENT_IMAGES, lead["contact_id"], data, mime, ext)
    db = get_service_client()
    old: list[dict] = []

    def write() -> None:  # reading and writing the photo column together, so a missing column is caught in one place
        old.extend(db.table("contacts").select("photo_path").eq("id", lead["contact_id"]).limit(1).execute().data)
        db.table("contacts").update({"photo_path": path}).eq("id", lead["contact_id"]).execute()

    guard_photo_write(CLIENT_IMAGES, path, write)
    delete_image(CLIENT_IMAGES, old[0].get("photo_path") if old else None)
    write_audit(user.id, "update", "leads", lead_id, {"photo": True})
    return {"photoUrl": signed_url(CLIENT_IMAGES, path)}


def remove_photo(user: Profile, lead_id: str) -> None:
    lead = get_lead_row(user, lead_id)
    old = get_service_client().table("contacts").select("photo_path").eq("id", lead["contact_id"]).limit(1).execute().data
    get_service_client().table("contacts").update({"photo_path": None}).eq("id", lead["contact_id"]).execute()


def _positive_number(value) -> bool:
    """True for a finite number above zero (a count or an amount). Strings like "12" count; "-3", "abc", NaN do not."""
    import math

    try:
        number = float(value)
    except (TypeError, ValueError):
        return False
    return math.isfinite(number) and number > 0
