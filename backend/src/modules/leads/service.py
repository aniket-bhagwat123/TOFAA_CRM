import logging
import re
from uuid import uuid4

from src.core import app_settings, cache
from src.core.access import ASSIGN_ROLES, assert_can_access_lead, require_lead_role, visible_owner_ids
from src.core.audit import write_audit
from src.core.concurrency import check_version
from src.core.dates import now_ist, next_business_day, today_ist
from src.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from src.core.images import checked_upload
from src.core.keys import company_key, email_key, phone_key
from src.core.pagination import PageParams, page_meta, parse_sort
from src.core.parallel import par
from src.core.soft_delete import is_deleted, live, require_ready
from src.core.storage import CLIENT_IMAGES, delete_image, guard_photo_write, signed_url, signed_urls, upload_image
from src.core.supabase import get_service_client
from src.core.timeline import add_activity
from src.modules.auth.schemas import KAM_VALUES, Profile, Role
from src.modules.leads import schemas
from src.modules.leads.stages import lost_from, stage_label
from src.modules.leads.stages import (
    CLOSED,
    NUMERIC_INPUTS,
    POSITION,
    PREREQUISITES,
    REQUIRED_INPUTS,
    STAGES,
    STAGES_FOR,
    stage_for_pipeline,
    VALUE_BANDS,
    is_closed,
    moves_forward,
)
from src.modules.leads.value import deal_value, value_source
from src.modules.tasks import service as tasks

log = logging.getLogger(__name__)
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
    if not rows or is_deleted(rows[0]):
        raise NotFoundError("Lead not found. It may have been deleted.")
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


def _search_words(term: str) -> list[str]:
    """Each word of the search, without the characters PostgREST filters treat specially."""
    return re.sub(r"[%,()*\\]", " ", term).split()[:6]


def _matching_ids(term: str) -> tuple[list[str], list[str]]:
    """(companies whose name matches, contacts whose name matches). Every word must appear, in any order, so
    "Logistics 1" finds "Vanguard Logistics Pvt. Ltd 1" and "mane pankaj" finds "Pankaj Mane".
    A search that is only a number (4+ digits) matches the contact's phone or second phone instead."""
    words = _search_words(term)
    if not words:
        return [], []
    db = get_service_client()

    def by_words(table: str):
        q = db.table(table).select("id")
        for w in words:
            q = q.ilike("name", f"%{w}%")
        return q.limit(300).execute().data

    digits = re.sub(r"\D", "", term)
    if len(digits) >= 4 and len(digits) >= len(re.sub(r"[\s+\-()]", "", term)):  # a phone number (or part of one)
        tail = digits[-10:]
        contacts = (
            db.table("contacts").select("id").or_(f"phone.ilike.%{tail}%,alt_phone.ilike.%{tail}%").limit(300).execute().data
        )
        return [], [r["id"] for r in contacts]
    companies, contacts = par(lambda: by_words("companies"), lambda: by_words("contacts"))
    return [r["id"] for r in companies], [r["id"] for r in contacts]


def meta() -> dict:
    """Stage settings, sources and so on. Changes rarely, so it is kept for five minutes."""

    def load() -> dict:
        stages = get_service_client().table("stage_config").select("*").order("position").execute().data
        return {
            "stages": stages,
            "sources": app_settings.sources(),
            "lostReasons": app_settings.lost_reasons(),
            "rules": {k: app_settings.get(k) for k in ("retry", "nurtureDays", "stuckDays")},
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
        return live(db.table("companies").select("id").eq("name_key", ck), "companies").limit(50).execute().data

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
        live(db.table("leads").select(LEAD_SELECT).in_("company_id", list(matched))).order("created_at", desc=True).limit(20).execute().data
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
    # A second contact at an existing company is allowed only when the KAM says so
    # and nothing else (phone / email) matches.
    only_company = bool(dups) and all(d["matchedOn"] == ["company"] for d in dups)
    if dups and not (only_company and body.use_existing_company):
        raise ConflictError("This lead already exists.", data={"duplicates": dups})

    owner_id = user.id
    if body.owner_id and body.owner_id != user.id:
        if user.role not in ASSIGN_ROLES:
            raise ForbiddenError("You can only create leads for yourself.")
        owner_id = body.owner_id

    db = get_service_client()
    if only_company and body.use_existing_company:
        company = live(db.table("companies").select("id,name,kind,city").eq("name_key", company_key(body.company_name)), "companies").limit(1).execute().data[0]
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


CALL_OUTCOMES = {"not_reachable", "call_back_later", "future_requirement", "interested", "not_interested", "wrong_contact"}
TAGS = {"nurture", "cold"}  # cold is worked out: "Not reachable" at least the retry limit times


def _call_outcome_filter(q, value: str):
    """Comma list of last-call outcomes; 'none' means the lead has never had a call logged."""
    wanted = [v for v in value.split(",") if v in CALL_OUTCOMES]
    never = "none" in value.split(",")
    if never and wanted:
        return q.or_(f"last_call_outcome.is.null,last_call_outcome.in.({','.join(wanted)})")
    if never:
        return q.is_("last_call_outcome", "null")
    return q.in_("last_call_outcome", wanted or ["-"])


LAST_CALL_NOT_READY = "The Call status filter is not set up yet. An admin needs to apply the database migration 20260107000000_lead_last_call.sql, then try again."


def _run_filtered(run, call_outcome, tag=None):
    try:
        return run()
    except Exception as exc:
        if call_outcome and "last_call_outcome" in str(exc):
            raise AppError(LAST_CALL_NOT_READY, status_code=503) from exc
        if tag and "tags" in str(exc):
            raise AppError("The tag filter is not set up yet. An admin needs to apply the database migration 20260112000000_call_outcomes_v2.sql, then try again.", status_code=503) from exc
        raise


def _lead_filters(q, user: Profile, *, stage, overdue, source, owner_id, search, pipeline="new_business", company_id=None, occasion=None, origin=None, call_outcome=None, tag=None):
    q = live(q)  # deleted leads never show
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
    if call_outcome:
        q = _call_outcome_filter(q, call_outcome)
    if tag == "cold":
        q = q.eq("last_call_outcome", "not_reachable").gte("call_attempts", int((app_settings.get("retry") or {}).get("maxAttempts") or 5))
    elif tag:
        q = q.contains("tags", [tag if tag in TAGS else "-"])
    if overdue:
        q = q.lt("next_follow_up", today_ist().isoformat()).not_.in_("stage", list(CLOSED))
    if search and search.strip():
        # A company-name match shows all that company's leads; a contact-name match only that person's leads.
        companies, contacts = _matching_ids(search)
        clauses = ([f"company_id.in.({','.join(companies)})"] if companies else []) + ([f"contact_id.in.({','.join(contacts)})"] if contacts else [])
        q = q.or_(",".join(clauses)) if clauses else q.eq("company_id", "00000000-0000-0000-0000-000000000000")
    return q


def list_leads(user: Profile, page: PageParams, *, stage=None, overdue=False, source=None, owner_id=None, pipeline="new_business", company_id=None, occasion=None, origin=None, call_outcome=None, tag=None) -> dict:
    require_lead_role(user)
    params = {"page": page.page, "limit": page.limit, "search": page.search, "sort": page.sort, "stage": stage, "overdue": overdue, "source": source, "owner": owner_id, "pipeline": pipeline, "c": company_id, "oc": occasion, "or": origin, "co": call_outcome, "tg": tag}

    def load() -> dict:
        col, desc = parse_sort(page.sort, SORTABLE, "last_activity_at")
        q = get_service_client().table("leads").select(LEAD_SELECT, count="exact")
        q = _lead_filters(q, user, stage=stage, overdue=overdue, source=source, owner_id=owner_id, search=page.search, pipeline=pipeline, company_id=company_id, occasion=occasion, origin=origin, call_outcome=call_outcome, tag=tag)
        res = _run_filtered(lambda: q.order(col, desc=desc).range(page.start, page.end).execute(), call_outcome, tag)
        return {"items": attach_photos(res.data), "meta": page_meta(page, res.count or 0)}

    return cache.memo("leads", user.id, params, VIEW_TTL, load)


def board(user: Profile, *, overdue=False, source=None, owner_id=None, search=None, pipeline="new_business", company_id=None, occasion=None, origin=None, call_outcome=None, tag=None) -> list[dict]:
    """All leads for the Kanban board (capped at 500), newest activity first."""
    require_lead_role(user)

    def load() -> list[dict]:
        q = get_service_client().table("leads").select(LEAD_SELECT)
        q = _lead_filters(q, user, stage=None, overdue=overdue, source=source, owner_id=owner_id, search=search, pipeline=pipeline, company_id=company_id, occasion=occasion, origin=origin, call_outcome=call_outcome, tag=tag)
        return attach_photos(_run_filtered(lambda: q.order("last_activity_at", desc=True).limit(500).execute(), call_outcome, tag).data)

    return cache.memo("board", user.id, {"o": overdue, "s": source, "w": owner_id, "q": search, "p": pipeline, "c": company_id, "oc": occasion, "or": origin, "co": call_outcome, "tg": tag}, VIEW_TTL, load)


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
    if not rows or is_deleted(rows[0]):
        raise NotFoundError("Lead not found. It may have been deleted.")
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
    """Move a lead forward because of something the KAM did (call logged, meeting created ...).

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
        if "nurture" in (lead.get("tags") or []):
            patch["tags"] = [t for t in lead["tags"] if t != "nurture"]  # a lost lead is not being nurtured
    elif is_closed(current):
        patch["lost_reason"] = None  # reopened
        patch["closed_at"] = None
    if target == "requirement_received" and requirement.get("budget"):
        patch["estimate_amount"] = float(requirement["budget"])  # the deal value now has an estimate
    if target == "new_lead":
        # Back to New Lead starts the calling over, like a freshly created lead: "Not called yet".
        patch["last_call_outcome"] = None
        patch["last_call_at"] = None
        if "nurture" in (lead.get("tags") or []):
            patch["tags"] = [t for t in lead["tags"] if t != "nurture"]
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
    if user.role not in ASSIGN_ROLES:
        raise ForbiddenError("Your role cannot reassign leads.")
    db = get_service_client()
    lead, target = par(
        lambda: get_lead_row(user, lead_id),
        lambda: db.table("profiles").select("id,full_name,role,is_active").eq("id", body.owner_id).limit(1).execute().data,
    )
    if not target or not target[0]["is_active"] or target[0]["role"] not in (*KAM_VALUES, Role.SALES_MANAGER.value):
        raise AppError("Pick an active KAM or manager.", status_code=422)
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


def share_out(lead_ids: list[str], owner_ids: list[str]) -> dict[str, str]:
    """Deal the leads out in turn, so the shares differ by at most one: lead id -> new owner id."""
    return {lead_id: owner_ids[i % len(owner_ids)] for i, lead_id in enumerate(lead_ids)}


def bulk_reassign(user: Profile, body: schemas.BulkReassign) -> dict:
    """Managers hand many new-business leads to one or several people, with the same rules as a single reassign.
    Everyone is checked before anything is written."""
    if user.role not in ASSIGN_ROLES:
        raise ForbiddenError("Your role cannot reassign leads.")
    db = get_service_client()
    ids = list(dict.fromkeys(body.lead_ids))
    owners = list(dict.fromkeys(body.owner_ids))
    people = {p["id"]: p for p in db.table("profiles").select("id,full_name,role,is_active").in_("id", owners).execute().data}
    for owner in owners:
        target = people.get(owner)
        if not target or not target["is_active"] or target["role"] not in (*KAM_VALUES, Role.SALES_MANAGER.value):
            raise AppError("Pick active KAMs or managers.", status_code=422)
    found: dict[str, dict] = {}
    for i in range(0, len(ids), 100):
        q = db.table("leads").select("id,owner_id").in_("id", ids[i : i + 100]).eq("pipeline", "new_business")
        found.update({r["id"]: r for r in live(q, "leads").execute().data})
    for lead in found.values():
        assert_can_access_lead(user, lead)
    present = [i for i in ids if i in found]  # deleted meanwhile (or not a sales lead): skipped and counted
    plan = share_out(present, owners)
    moves = {lead_id: owner for lead_id, owner in plan.items() if found[lead_id]["owner_id"] != owner}
    now = now_ist().isoformat()
    for owner in owners:
        mine = [lead_id for lead_id, to in moves.items() if to == owner]
        for i in range(0, len(mine), 100):
            part = mine[i : i + 100]
            par(
                lambda: db.table("leads").update({"owner_id": owner, "updated_at": now, "last_activity_at": now}).in_("id", part).execute(),
                lambda: db.table("tasks").update({"owner_id": owner}).in_("lead_id", part).is_("done_at", "null").execute(),
                lambda: db.table("meetings").update({"owner_id": owner}).in_("lead_id", part).eq("status", "scheduled").execute(),
                lambda: db.table("activities").insert([
                    {"lead_id": lead_id, "actor_id": user.id, "kind": "reassign", "outcome": None, "note": body.note,
                     "meta": {"from": found[lead_id]["owner_id"], "to": owner, "toName": people[owner]["full_name"]}}
                    for lead_id in part
                ]).execute(),
            )
    for lead_id, owner in moves.items():
        write_audit(user.id, "reassign", "leads", lead_id, {"from": found[lead_id]["owner_id"], "to": owner, "bulk": True})
    return {"reassigned": len(moves), "unchanged": len(present) - len(moves), "missing": len(ids) - len(present)}


# --- client photo ---------------------------------------------------------------------------------------

def attach_photos(rows: list[dict]) -> list[dict]:
    """Replace each contact's storage path with a short-lived signed URL (one batched request, cached)."""
    urls = signed_urls(CLIENT_IMAGES, [(r.get("contact") or {}).get("photo_path") for r in rows])
    max_attempts = int((app_settings.get("retry") or {}).get("maxAttempts") or 5)
    for r in rows:
        contact = r.get("contact")
        if contact is not None:
            url = urls.get(contact.get("photo_path") or "")
            # Only the fields the app needs (the row has internal duplicate-check keys too).
            r["contact"] = {k: contact.get(k) for k in ("id", "name", "designation", "phone", "alt_phone", "alt_name", "email")} | {"photo_url": url}
        r["deal_value"] = deal_value(r)
        r["value_source"] = value_source(r)
        # Cold: still "Not reachable" after the retry limit (Settings > Rules).
        r["cold"] = r.get("last_call_outcome") == "not_reachable" and int(r.get("call_attempts") or 0) >= max_attempts
    _attach_alt_names(rows)
    return _attach_last_call(rows)


def _attach_alt_names(rows: list[dict]) -> None:
    """Until migration 20260109000000_contact_alt_name.sql adds contacts.alt_name, take whose the second number
    is from the call that changed the number (its meta keeps the old name)."""
    need = [r for r in rows if (r.get("contact") or {}).get("alt_phone") and not r["contact"].get("alt_name")]
    if not need:
        return
    try:
        calls = (
            get_service_client().table("activities").select("lead_id,meta,created_at").eq("kind", "call")
            .in_("lead_id", [r["id"] for r in need[:100]]).order("created_at", desc=True).limit(1000).execute().data
        )
    except Exception:  # noqa: BLE001 - a missing name must never break the list
        log.warning("could not read the old contact names", exc_info=True)
        return
    old: dict[str, str] = {}
    for c in calls:
        meta = c.get("meta") or {}
        if meta.get("newPhone") and c["lead_id"] not in old:
            old[c["lead_id"]] = meta.get("oldName") or ""
    for r in need:
        if old.get(r["id"]):
            r["contact"]["alt_name"] = old[r["id"]]


def _attach_last_call(rows: list[dict]) -> list[dict]:
    """Until migration 20260107000000_lead_last_call.sql adds leads.last_call_outcome, work the latest call
    outcome out from the call history, so the cards and the table still show it."""
    if not rows or "last_call_outcome" in rows[0]:
        return rows  # the column exists: it is kept up to date when a call is logged
    latest: dict[str, dict] = {}
    db = get_service_client()
    ids = [r["id"] for r in rows]
    for i in range(0, len(ids), 100):
        try:
            calls = (
                db.table("activities").select("lead_id,outcome,created_at,meta").eq("kind", "call").in_("lead_id", ids[i : i + 100])
                .order("created_at", desc=True).limit(2000).execute().data
            )
        except Exception:  # noqa: BLE001 - a missing badge must never break the list
            log.warning("could not read call history for the call status", exc_info=True)
            continue
        for c in calls:
            latest.setdefault(c["lead_id"], c)  # newest first, so the first one seen is the latest
    for r in rows:
        c = latest.get(r["id"])
        fresh = c and not (c.get("meta") or {}).get("newPhone")  # a changed number has not been called yet
        r["last_call_outcome"] = c["outcome"] if fresh else None
        r["last_call_at"] = c["created_at"] if fresh else None
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


# --- soft delete -----------------------------------------------------------------------------------------------------

# What makes a lead real business that must be kept (table, label for one, label for many).
LEAD_LINKS = [
    ("quotations", "quotation", "quotations"),
    ("agreements", "agreement", "agreements"),
    ("payment_requests", "payment request", "payment requests"),
    ("orders", "order", "orders"),
    ("lead_samples", "sample", "samples"),
    ("moms", "meeting minutes", "meeting minutes"),
    ("meetings", "meeting", "meetings"),
]


def lead_blockers(lead_id: str) -> list[dict]:
    """Everything connected to the lead that stops it being deleted, as {what, count}."""
    db = get_service_client()

    def count(table: str) -> int:
        try:
            return db.table(table).select("lead_id", count="exact").eq("lead_id", lead_id).limit(1).execute().count or 0
        except Exception:  # noqa: BLE001 - a table from a migration not applied yet has nothing in it
            return 0

    counts = par(*[(lambda t=t: count(t)) for t, _, _ in LEAD_LINKS])
    return [{"what": one if n == 1 else many, "count": n} for (_, one, many), n in zip(LEAD_LINKS, counts) if n]


def _join(parts: list[str]) -> str:
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]


def delete_lead(user: Profile, lead_id: str) -> dict:
    """Soft delete: hide a lead that was added by mistake (a duplicate, test data, a wrong entry).
    Only when nothing is connected to it; a lead with business history is closed as Lost instead, so reports and the
    client's history stay right. Managers and admins can delete any lead; a KAM only their own."""
    require_ready("leads", "companies")
    lead = get_lead_row(user, lead_id)
    if user.role not in (Role.ADMIN, Role.SALES_MANAGER) and not (user.role == Role.KAM and lead.get("owner_id") == user.id):
        raise ForbiddenError("Only a manager, an admin or the lead's owner can delete this lead.")
    name = lead["company"]["name"] + (f" \u00b7 {lead['project_title']}" if lead.get("project_title") and lead.get("pipeline") == "client" else "")
    if lead["stage"] == "closed_won":
        raise ConflictError(
            f"{name} can't be deleted: it is a won deal (paid). Won deals are kept for revenue, orders and the client's history.",
            data={"blockers": [{"what": "won deal", "count": 1}]},
        )
    blockers = lead_blockers(lead_id)
    if blockers:
        listed = _join([f"{b['count']} {b['what']}" for b in blockers])
        raise ConflictError(
            f"{name} can't be deleted because it has {listed}. Close it as Lost instead, so its history is kept.",
            data={"blockers": blockers},
        )

    db = get_service_client()
    now = now_ist().isoformat()
    db.table("leads").update({"deleted_at": now, "deleted_by": user.id, "next_follow_up": None}).eq("id", lead_id).execute()
    db.table("tasks").update({"done_at": now, "outcome": "deleted"}).eq("lead_id", lead_id).is_("done_at", "null").execute()
    add_activity(lead_id, user.id, "note", note=f"Lead deleted by {user.full_name or 'a user'}")
    # The company goes with its last lead, unless it is a client: then re-adding it later starts clean.
    company = lead.get("company") or {}
    others = live(db.table("leads").select("id").eq("company_id", lead["company_id"]).neq("id", lead_id)).limit(1).execute().data
    if not others and not company.get("client_since"):
        db.table("companies").update({"deleted_at": now, "deleted_by": user.id}).eq("id", lead["company_id"]).execute()
    write_audit(user.id, "delete", "leads", lead_id, {"company": company.get("name"), "stage": lead["stage"]})
    return {"id": lead_id, "deleted": True}
