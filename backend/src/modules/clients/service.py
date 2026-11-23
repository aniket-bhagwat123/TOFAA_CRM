"""Client management.

A company becomes a client when a deal is paid for (or when someone adds an existing customer by hand). A client has
many projects; each project is a deal on the short client pipeline (Follow-up, Meeting, Proposal, Negotiation, Won/Lost),
stored in the leads table with pipeline = 'client', so every existing action works for it. Clients also have gifting
occasions, which turn into dated "ask about gifting" calls in time for the order, and client-level follow-ups.
"""
import calendar
import re
import logging
from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

from src.core import cache
from src.core.access import require_lead_role, visible_owner_ids
from src.core.audit import write_audit
from src.core.config import settings
from src.core.dates import IST, next_business_day, now_ist, today_ist
from src.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from src.core.keys import company_key, email_key, phone_key
from src.core.money import to_money
from src.core.parallel import par
from src.core.storage import CLIENT_IMAGES, signed_urls
from src.core.supabase import get_service_client
from src.core.timeline import add_activity, add_company_activity
from src.modules.auth.schemas import Profile, Role
from src.modules.clients import schemas
from src.modules.leads import service as leads
from src.modules.leads.stages import CLOSED
from src.modules.notifications.service import notify

log = logging.getLogger(__name__)
COMPANY_SELECT = (
    "id,name,city,kind,client_since,account_owner_id,tier_override,"
    " owner:profiles!account_owner_id(id,full_name), contacts(id,name,designation,phone,email,photo_path,created_at)"
)
SOON_DAYS = 60  # "occasion coming up" filter on the Clients screen


# --- pure rules (tested without a database) ---------------------------------------------------------------------

def tier_for(revenue_12m: Decimal) -> str:
    if revenue_12m >= settings.CLIENT_TIER_A:
        return "A"
    if revenue_12m >= settings.CLIENT_TIER_B:
        return "B"
    return "C"


def status_for(last_order: date | None, client_since: date | None, open_projects: int, today: date) -> str:
    """Dormant: nothing ordered (or no new client) for a long time, and nothing in progress."""
    if open_projects:
        return "active"
    ref = max([d for d in (last_order, client_since) if d], default=None)
    if ref is None or (today - ref).days > settings.CLIENT_DORMANT_DAYS:
        return "dormant"
    return "active"


def next_occurrence(occ: dict, calendar_dates: dict[str, list[date]], today: date) -> date | None:
    """When this occasion next happens. Festivals come from the calendar; fixed dates repeat every year."""
    if occ.get("from_calendar"):
        upcoming = [d for d in calendar_dates.get((occ.get("name") or "").strip().lower(), []) if d >= today]
        return min(upcoming) if upcoming else None
    month, day = occ.get("month"), occ.get("day")
    if not month or not day:
        return None
    for year in (today.year, today.year + 1):
        d = date(year, month, min(day, calendar.monthrange(year, month)[1]))  # 29 Feb in other years becomes 28 Feb
        if d >= today:
            return d
    return None


def occasion_from_title(title: str | None) -> str | None:
    """"Diwali on 29 Oct: ask about gifting" -> "Diwali" (reminder and campaign tasks are titled this way)."""
    head = re.split(r" on |:", title or "", maxsplit=1)[0].strip()
    return head or None


def reminder_due(occurs_on: date | None, lead_days: int, today: date) -> bool:
    """Time to call about this occasion: inside the lead window, and it has not passed."""
    return occurs_on is not None and occurs_on - timedelta(days=lead_days) <= today <= occurs_on


# --- helpers ---------------------------------------------------------------------------------------------------------------

def _d(value) -> date | None:
    if not value:
        return None
    return datetime.fromisoformat(str(value)).astimezone(IST).date() if "T" in str(value) else date.fromisoformat(str(value)[:10])


def calendar_dates() -> dict[str, list[date]]:
    def load() -> dict[str, list[date]]:
        out: dict[str, list[date]] = {}
        for r in get_service_client().table("occasion_calendar").select("name,occurs_on").execute().data:
            out.setdefault(r["name"].strip().lower(), []).append(date.fromisoformat(r["occurs_on"]))
        return out

    return cache.reference("occasion-calendar", "all", 600, load)


def _scope(user: Profile) -> list[str] | None:
    return visible_owner_ids(user)  # also refuses roles without lead access


def _client(user: Profile, company_id: str) -> dict:
    rows = get_service_client().table("companies").select(COMPANY_SELECT).eq("id", company_id).limit(1).execute().data
    if not rows or not rows[0].get("client_since"):
        raise NotFoundError("Client not found.")
    scope = _scope(user)
    if scope is not None and rows[0].get("account_owner_id") not in scope:
        raise ForbiddenError("This client belongs to someone else.")
    return rows[0]


def _contact_out(contacts: list[dict]) -> list[dict]:
    contacts = sorted(contacts or [], key=lambda c: c.get("created_at") or "")
    urls = signed_urls(CLIENT_IMAGES, [c.get("photo_path") for c in contacts])
    return [{k: c.get(k) for k in ("id", "name", "designation", "phone", "email")} | {"photo_url": urls.get(c.get("photo_path") or "")} for c in contacts]


def _stats(company_ids: list[str]) -> dict[str, dict]:
    """Revenue, last order, open projects and next occasion for each client, in three queries."""
    if not company_ids:
        return {}
    db = get_service_client()
    won, open_rows, occasions = par(
        lambda: db.table("leads").select("company_id,paid_amount,closed_at,occasion").in_("company_id", company_ids).eq("stage", "closed_won").limit(10000).execute().data,
        lambda: db.table("leads").select("company_id").in_("company_id", company_ids).eq("pipeline", "client").not_.in_("stage", list(CLOSED)).limit(10000).execute().data,
        lambda: db.table("client_occasions").select("*").in_("company_id", company_ids).execute().data,
    )
    today, cal = today_ist(), calendar_dates()
    year_ago = today - timedelta(days=365)
    out = {cid: {"lifetime": Decimal("0"), "revenue_12m": Decimal("0"), "last_order": None, "won": 0, "open": 0, "next_occasion": None, "won_occasions": set()} for cid in company_ids}
    for r in won:
        s = out[r["company_id"]]
        amount = to_money(r["paid_amount"]) if r.get("paid_amount") else Decimal("0")
        closed = _d(r.get("closed_at"))
        s["lifetime"] += amount
        s["won"] += 1
        if closed and closed >= year_ago:
            s["revenue_12m"] += amount
        if closed and (s["last_order"] is None or closed > s["last_order"]):
            s["last_order"] = closed
        if r.get("occasion"):
            s["won_occasions"].add(r["occasion"].strip().lower())
    for r in open_rows:
        out[r["company_id"]]["open"] += 1
    for o in occasions:
        nxt = next_occurrence(o, cal, today)
        s = out[o["company_id"]]
        if nxt and (s["next_occasion"] is None or nxt < s["next_occasion"]["date"]):
            s["next_occasion"] = {"name": o["name"], "date": nxt, "days_away": (nxt - today).days}
    return out


def _summary(company: dict, s: dict) -> dict:
    today = today_ist()
    contacts = _contact_out(company.get("contacts") or [])
    nxt = s["next_occasion"]
    return {
        "id": company["id"], "name": company["name"], "city": company.get("city"), "kind": company.get("kind"),
        "client_since": company.get("client_since"), "owner": company.get("owner"),
        "primary_contact": contacts[0] if contacts else None, "contact_count": len(contacts),
        "lifetime_value": float(s["lifetime"]), "revenue_12m": float(s["revenue_12m"]),
        "last_order_at": s["last_order"].isoformat() if s["last_order"] else None,
        "won_projects": s["won"], "open_projects": s["open"],
        "tier": company.get("tier_override") or tier_for(s["revenue_12m"]), "tier_is_manual": bool(company.get("tier_override")),
        "status": status_for(s["last_order"], _d(company.get("client_since")), s["open"], today),
        "next_occasion": {"name": nxt["name"], "date": nxt["date"].isoformat(), "days_away": nxt["days_away"]} if nxt else None,
    }


# --- becoming a client -------------------------------------------------------------------------------------------------------

def make_client(company_id: str, owner_id: str | None) -> bool:
    """Mark a company as a client. True when it was not one before. Never changes an existing owner."""
    db = get_service_client()
    res = db.table("companies").update({"client_since": now_ist().isoformat(), "account_owner_id": owner_id}).eq("id", company_id).is_("client_since", "null").execute()
    if res.data:
        return True
    if owner_id:
        db.table("companies").update({"account_owner_id": owner_id}).eq("id", company_id).is_("account_owner_id", "null").execute()
    return False


def on_deal_won(lead_id: str) -> None:
    """Called when a payment closes a deal. The first paid deal turns the company into a client."""
    db = get_service_client()
    rows = db.table("leads").select("id,company_id,owner_id,pipeline,project_title,company:companies(name)").eq("id", lead_id).limit(1).execute().data
    if not rows:
        return
    lead = rows[0]
    became = make_client(lead["company_id"], lead.get("owner_id"))
    if (lead.get("pipeline") or "new_business") == "new_business" and not lead.get("project_title"):
        db.table("leads").update({"project_title": "First order"}).eq("id", lead_id).execute()  # shows in the client's history
    if became:
        name = (lead.get("company") or {}).get("name", "This company")
        add_company_activity(lead["company_id"], lead.get("owner_id"), "client", outcome="converted", note=f"{name} became a client")
        if lead.get("owner_id"):
            notify(lead["owner_id"], f"client:{lead['company_id']}", f"{name} is now a client", "Add their gifting occasions so you call before each one.", f"/clients/{lead['company_id']}")


def add_client(user: Profile, body: schemas.ClientCreate) -> dict:
    require_lead_role(user)
    db = get_service_client()
    if body.company_id:
        company = db.table("companies").select("id,client_since").eq("id", body.company_id).limit(1).execute().data
        if not company:
            raise NotFoundError("Company not found.")
        if user.role == Role.SALES_EXECUTIVE:
            mine = db.table("leads").select("id").eq("company_id", body.company_id).eq("owner_id", user.id).limit(1).execute().data
            if not mine:
                raise ForbiddenError("You can only turn your own leads' companies into clients.")
        company_id = body.company_id
    else:
        existing = db.table("companies").select("id,client_since").eq("name_key", company_key(body.company_name)).limit(1).execute().data
        if existing:
            raise ConflictError("This company is already in the CRM.", data={"companyId": existing[0]["id"], "isClient": bool(existing[0].get("client_since"))})
        company_id = db.table("companies").insert(
            {"name": body.company_name, "name_key": company_key(body.company_name), "city": body.city, "created_by": user.id}
        ).execute().data[0]["id"]
        db.table("contacts").insert(
            {"company_id": company_id, "name": body.contact_name, "designation": body.designation, "phone": body.phone,
             "phone_key": phone_key(body.phone), "email": body.email, "email_key": email_key(body.email)}
        ).execute()
    if not make_client(company_id, user.id):
        raise ConflictError("This company is already a client.", data={"companyId": company_id, "isClient": True})
    add_company_activity(company_id, user.id, "client", outcome="added", note="Added as an existing client")
    write_audit(user.id, "create", "clients", company_id, {})
    return {"id": company_id}


# --- reading -------------------------------------------------------------------------------------------------------------------------

def list_clients(user: Profile, *, search: str | None, tier: str | None, status: str | None, owner_id: str | None, occasion_soon: bool) -> list[dict]:
    require_lead_role(user)
    params = {"q": search, "t": tier, "s": status, "o": owner_id, "soon": occasion_soon}
    return cache.memo("clients", user.id, params, 20, lambda: _list(user, search, tier, status, owner_id, occasion_soon))


def _list(user, search, tier, status, owner_id, occasion_soon) -> list[dict]:
    scope = _scope(user)
    q = get_service_client().table("companies").select(COMPANY_SELECT).not_.is_("client_since", "null")
    if owner_id:
        if scope is not None and owner_id not in scope:
            raise ForbiddenError()
        q = q.eq("account_owner_id", owner_id)
    elif scope is not None:
        q = q.in_("account_owner_id", scope)
    if search and search.strip():
        q = q.ilike("name", f"%{search.strip()}%")
    companies = q.order("name").limit(1000).execute().data
    stats = _stats([c["id"] for c in companies])
    items = [_summary(c, stats[c["id"]]) for c in companies]
    if tier in ("A", "B", "C"):
        items = [i for i in items if i["tier"] == tier]
    if status in ("active", "dormant"):
        items = [i for i in items if i["status"] == status]
    if occasion_soon:
        items = [i for i in items if i["next_occasion"] and i["next_occasion"]["days_away"] <= SOON_DAYS]
        items.sort(key=lambda i: i["next_occasion"]["days_away"])
    else:
        items.sort(key=lambda i: (-i["lifetime_value"], i["name"].lower()))
    return items


def get_client(user: Profile, company_id: str) -> dict:
    require_lead_role(user)
    return cache.memo("client", user.id, company_id, 20, lambda: _detail(user, company_id))


def _detail(user: Profile, company_id: str) -> dict:
    company = _client(user, company_id)
    db = get_service_client()
    projects, occasions, followups, stats = par(
        lambda: db.table("leads").select(leads.LEAD_SELECT).eq("company_id", company_id).order("created_at", desc=True).limit(200).execute().data,
        lambda: db.table("client_occasions").select("*").eq("company_id", company_id).order("created_at").execute().data,
        lambda: db.table("tasks").select("*").eq("company_id", company_id).is_("done_at", "null").order("due_date").execute().data,
        lambda: _stats([company_id]),
    )
    lead_ids = [p["id"] for p in projects]
    tl = db.table("activities").select("*, actor:profiles!actor_id(full_name)")
    tl = tl.or_(f"company_id.eq.{company_id},lead_id.in.({','.join(lead_ids)})") if lead_ids else tl.eq("company_id", company_id)
    timeline = tl.order("created_at", desc=True).limit(100).execute().data

    projects = leads.attach_photos(projects)
    open_projects = sorted([p for p in projects if p["stage"] not in CLOSED], key=lambda p: p.get("next_follow_up") or "9999")
    closed = sorted([p for p in projects if p["stage"] in CLOSED], key=lambda p: p.get("closed_at") or p.get("updated_at") or "", reverse=True)
    today, cal = today_ist(), calendar_dates()
    occ_out = []
    for o in occasions:
        nxt = next_occurrence(o, cal, today)
        occ_out.append({**o, "next_date": nxt.isoformat() if nxt else None, "days_away": (nxt - today).days if nxt else None})
    occ_out.sort(key=lambda o: o["days_away"] if o["days_away"] is not None else 9999)
    return {
        "client": _summary(company, stats[company_id]),
        "contacts": _contact_out(company.get("contacts") or []),
        "projects": open_projects + closed,
        "occasions": occ_out,
        "followups": followups,
        "timeline": timeline,
    }


# --- changing ---------------------------------------------------------------------------------------------------------------------------

def update_client(user: Profile, company_id: str, body: schemas.ClientUpdate) -> dict:
    if user.role not in (Role.ADMIN, Role.SALES_MANAGER):
        raise ForbiddenError("Only managers and admins change a client's owner or tier.")
    company = _client(user, company_id)
    db = get_service_client()
    patch = {}
    if body.account_owner_id and body.account_owner_id != company.get("account_owner_id"):
        scope = _scope(user)
        if scope is not None and body.account_owner_id not in scope:
            raise ForbiddenError("You can only assign clients to your own team.")
        target = db.table("profiles").select("id,role,is_active,full_name").eq("id", body.account_owner_id).limit(1).execute().data
        if not target or not target[0]["is_active"] or target[0]["role"] not in (Role.SALES_EXECUTIVE.value, Role.SALES_MANAGER.value):
            raise AppError("Pick an active sales executive or manager.", status_code=422)
        patch["account_owner_id"] = body.account_owner_id
        # The new owner takes over what is in progress: open projects and open client follow-ups.
        par(
            lambda: db.table("leads").update({"owner_id": body.account_owner_id}).eq("company_id", company_id).eq("pipeline", "client").not_.in_("stage", list(CLOSED)).execute(),
            lambda: db.table("tasks").update({"owner_id": body.account_owner_id}).eq("company_id", company_id).is_("done_at", "null").execute(),
            lambda: add_company_activity(company_id, user.id, "reassign", note=f"Client moved to {target[0]['full_name']}"),
        )
    if body.clear_tier_override:
        patch["tier_override"] = None
    elif body.tier_override:
        patch["tier_override"] = body.tier_override
    if patch:
        db.table("companies").update(patch).eq("id", company_id).execute()
        write_audit(user.id, "update", "clients", company_id, patch)
    return {"id": company_id}


def add_contact(user: Profile, company_id: str, body: schemas.ContactCreate) -> dict:
    _client(user, company_id)
    row = get_service_client().table("contacts").insert(
        {"company_id": company_id, "name": body.name.strip(), "designation": body.designation, "phone": body.phone,
         "phone_key": phone_key(body.phone), "email": body.email, "email_key": email_key(body.email)}
    ).execute().data[0]
    add_company_activity(company_id, user.id, "client", outcome="contact", note=f"New contact: {body.name.strip()}")
    return row


def add_occasion(user: Profile, company_id: str, body: schemas.OccasionCreate) -> dict:
    company = _client(user, company_id)
    if body.from_calendar and body.name.strip().lower() not in calendar_dates():
        raise AppError("That festival is not in the occasion calendar yet. Ask an admin to add its date, or pick a fixed date.", status_code=422)
    row = get_service_client().table("client_occasions").insert(
        {"company_id": company_id, "name": body.name.strip(), "from_calendar": body.from_calendar, "month": None if body.from_calendar else body.month,
         "day": None if body.from_calendar else body.day, "lead_days": body.lead_days, "notes": body.notes, "created_by": user.id}
    ).execute().data[0]
    cache.invalidate_reference("occasion-reminders", company.get("account_owner_id"))
    add_company_activity(company_id, user.id, "client", outcome="occasion", note=f"Occasion added: {body.name.strip()}")
    return row


def delete_occasion(user: Profile, company_id: str, occasion_id: str) -> None:
    _client(user, company_id)
    get_service_client().table("client_occasions").delete().eq("id", occasion_id).eq("company_id", company_id).execute()


# --- client follow-ups (occasion calls, check-ins) ------------------------------------------------------------------------------------------

def create_followup(user: Profile, company_id: str, body: schemas.FollowUpCreate) -> dict:
    company = _client(user, company_id)
    if body.due_date < today_ist():
        raise AppError("Pick a date from today onwards.", {"errors": [{"field": "dueDate", "message": "Pick a date from today onwards."}]}, 422)
    return get_service_client().table("tasks").insert(
        {"id": str(uuid4()), "company_id": company_id, "owner_id": company.get("account_owner_id") or user.id, "kind": "follow_up",
         "title": (body.title or "").strip() or "Check in with the client", "due_date": body.due_date.isoformat()}
    ).execute().data[0]


def complete_followup(user: Profile, company_id: str, task_id: str, body: schemas.FollowUpComplete) -> dict:
    company = _client(user, company_id)
    db = get_service_client()
    rows = db.table("tasks").select("*").eq("id", task_id).eq("company_id", company_id).limit(1).execute().data
    if not rows:
        raise NotFoundError("Follow-up not found.")
    task = rows[0]
    if task.get("done_at"):
        raise AppError("This follow-up is already done.")
    if body.outcome == "no_answer" and not body.next_follow_up:
        raise AppError("Pick when to try again.", {"errors": [{"field": "nextFollowUp", "message": "Pick when to try again."}]}, 422)
    if body.outcome == "interested" and not (body.project_title or "").strip():
        raise AppError("Name the project.", {"errors": [{"field": "projectTitle", "message": "Name the project, for example Diwali gifting 2027."}]}, 422)

    labels = {"interested": "Interested", "not_now": "Not this time", "no_answer": "No answer", "done": "Done"}
    db.table("tasks").update({"done_at": now_ist().isoformat(), "outcome": body.outcome}).eq("id", task_id).execute()
    add_company_activity(company_id, user.id, "call", outcome=body.outcome, note=f"{task.get('title') or 'Follow-up'}: {labels[body.outcome]}" + (f". {body.note.strip()}" if body.note and body.note.strip() else ""))

    project = None
    if body.outcome == "interested":
        occasion = occasion_from_title(task.get("title")) if (task.get("occasion_key") or task.get("campaign_id")) else None
        project = create_project(user, company_id, schemas.ProjectCreate(title=body.project_title.strip(), occasion=occasion, origin="occasion", notes=body.note))
    if body.next_follow_up and body.outcome in ("no_answer", "done", "not_now"):
        title = task.get("title") if body.outcome == "no_answer" else "Check in with the client"
        db.table("tasks").insert(
            {"id": str(uuid4()), "company_id": company_id, "owner_id": company.get("account_owner_id") or user.id, "kind": "follow_up",
             "title": title, "due_date": body.next_follow_up.isoformat(), "campaign_id": task.get("campaign_id") if body.outcome == "no_answer" else None}
        ).execute()
    if task.get("campaign_id"):
        patch = {"outcome": body.outcome if body.outcome != "done" else "interested", "updated_at": now_ist().isoformat()}
        if project:
            patch["project_id"] = project["id"]
        db.table("campaign_targets").update(patch).eq("campaign_id", task["campaign_id"]).eq("company_id", company_id).execute()
    return {"done": True, "projectId": project["id"] if project else None}


# --- projects -----------------------------------------------------------------------------------------------------------------------------------

def _project_owner(user: Profile, company: dict) -> str:
    """Executives work their own clients; when a manager or admin creates the project, it goes to the account owner."""
    if user.role == Role.SALES_EXECUTIVE:
        return user.id
    return company.get("account_owner_id") or user.id


def create_project(user: Profile, company_id: str, body: schemas.ProjectCreate) -> dict:
    company = _client(user, company_id)
    contacts = _contact_out(company.get("contacts") or [])
    if not contacts:
        raise AppError("Add a contact for this client first.", status_code=422)
    contact_id = body.contact_id if body.contact_id and any(c["id"] == body.contact_id for c in contacts) else contacts[0]["id"]
    owner_id = _project_owner(user, company)
    inbound = body.origin == "inbound"
    due = body.next_follow_up or (today_ist() if inbound else next_business_day())
    requirement = {k: v for k, v in {"occasion": body.occasion, "quantity": body.quantity, "budget": body.budget,
                                     "deliveryDate": body.delivery_date.isoformat() if body.delivery_date else None}.items() if v}
    db = get_service_client()
    lead = db.table("leads").insert(
        {"company_id": company_id, "contact_id": contact_id, "owner_id": owner_id, "stage": "project_follow_up", "pipeline": "client",
         "project_title": body.title.strip(), "occasion": (body.occasion or "").strip() or None, "origin": body.origin,
         "source": "Existing client", "notes": body.notes, "requirement": requirement, "estimate_amount": body.budget,
         "next_follow_up": due.isoformat(), "created_by": user.id}
    ).execute().data[0]
    first_task = "Send the proposal" if inbound else f"Follow up: {body.title.strip()}"
    par(
        lambda: db.table("tasks").insert({"id": str(uuid4()), "lead_id": lead["id"], "owner_id": owner_id, "kind": "follow_up", "title": first_task, "due_date": due.isoformat()}).execute(),
        lambda: add_activity(lead["id"], user.id, "created", note=f"Project created ({body.origin})", meta={"origin": body.origin}),
        lambda: add_company_activity(company_id, user.id, "client", outcome="project", note=f"New project: {body.title.strip()}" + (" (client called in)" if inbound else "")),
        lambda: notify(owner_id, f"project:{lead['id']}", "New client project", f"{company['name']}: {body.title.strip()}", f"/projects/{lead['id']}") if owner_id != user.id else None,
    )
    write_audit(user.id, "create", "projects", lead["id"], {"client": company_id, "origin": body.origin})
    return lead


def repeat_project(user: Profile, company_id: str, body: schemas.RepeatProject) -> dict:
    """'Same as last time': a new project with the previous quotation's items already in a new quotation."""
    from src.modules.quotations import schemas as qschemas
    from src.modules.quotations import service as quotations

    _client(user, company_id)
    db = get_service_client()
    src = db.table("leads").select("id,company_id,project_title,occasion").eq("id", body.source_project_id).limit(1).execute().data
    if not src or src[0]["company_id"] != company_id:
        raise NotFoundError("That project is not one of this client's.")
    src = src[0]
    quotes = db.table("quotations").select("id,notes,status").eq("lead_id", src["id"]).order("version", desc=True).limit(10).execute().data
    base = next((q for q in quotes if q["status"] == "sent"), quotes[0] if quotes else None)
    if not base:
        raise AppError("That project has no quotation to repeat. Create a new project instead.", status_code=422)
    title = (body.title or "").strip() or f"{src.get('project_title') or 'Order'} (repeat)"
    project = create_project(user, company_id, schemas.ProjectCreate(title=title, occasion=body.occasion or src.get("occasion"), origin="outbound"))
    db.table("leads").update({"origin": "repeat"}).eq("id", project["id"]).execute()
    quote = quotations.create_quotation(
        user, project["id"],
        qschemas.QuotationCreate(
            packages=quotations.copy_packages(base["id"], project["id"]),
            notes=base.get("notes"),
        ),
    )
    return {"projectId": project["id"], "quotation": quote}


# --- occasion reminders ---------------------------------------------------------------------------------------------------------------------------

def ensure_occasion_reminders(user: Profile) -> None:
    """Create the 'ask about gifting' calls that are due now, for this person's clients. Runs at most every 10 minutes."""
    if user.role not in (Role.SALES_EXECUTIVE, Role.SALES_MANAGER, Role.ADMIN):
        return
    try:
        cache.reference("occasion-reminders", user.id, 600, lambda: _make_reminders(user) or True)
    except Exception:  # noqa: BLE001 - reminders must never stop the Today screen from loading (for example before the migration)
        log.warning("occasion reminders skipped", exc_info=True)


def _make_reminders(user: Profile) -> None:
    db = get_service_client()
    companies = db.table("companies").select("id,name").eq("account_owner_id", user.id).not_.is_("client_since", "null").execute().data
    if not companies:
        return
    occasions = db.table("client_occasions").select("*").in_("company_id", [c["id"] for c in companies]).execute().data
    today, cal = today_ist(), calendar_dates()
    wanted = {}
    for o in occasions:
        nxt = next_occurrence(o, cal, today)
        if reminder_due(nxt, o["lead_days"], today):
            wanted[f"{o['id']}:{nxt.isoformat()}"] = (o, nxt)
    if not wanted:
        return
    have = {r["occasion_key"] for r in db.table("tasks").select("occasion_key").in_("occasion_key", list(wanted)).execute().data}
    for key, (o, nxt) in wanted.items():
        if key in have:
            continue
        try:
            db.table("tasks").insert(
                {"id": str(uuid4()), "company_id": o["company_id"], "owner_id": user.id, "kind": "follow_up",
                 "title": f"{o['name']} on {nxt:%d %b}: ask about gifting", "due_date": today.isoformat(), "occasion_key": key}
            ).execute()
        except Exception:  # noqa: BLE001 - another request made it a moment ago (the key is unique)
            pass


# --- occasion calendar (Admin) --------------------------------------------------------------------------------------------------------------------------

def list_calendar() -> list[dict]:
    return get_service_client().table("occasion_calendar").select("*").order("occurs_on").execute().data


def add_calendar(body: schemas.CalendarCreate) -> dict:
    try:
        row = get_service_client().table("occasion_calendar").insert({"name": body.name.strip(), "occurs_on": body.occurs_on.isoformat()}).execute().data[0]
    except Exception as exc:  # noqa: BLE001
        if "duplicate" in str(exc).lower() or "23505" in str(exc):
            raise ConflictError("That date is already in the calendar.") from exc
        raise
    cache.invalidate_reference("occasion-calendar")
    cache.invalidate_reference("occasion-reminders")
    return row


def delete_calendar(calendar_id: str) -> None:
    get_service_client().table("occasion_calendar").delete().eq("id", calendar_id).execute()
    cache.invalidate_reference("occasion-calendar")


# --- campaigns ("call every client before Diwali") -----------------------------------------------------------------------------------------------------------

def create_campaign(user: Profile, body: schemas.CampaignCreate) -> dict:
    if user.role not in (Role.ADMIN, Role.SALES_MANAGER):
        raise ForbiddenError("Only managers and admins start campaigns.")
    scope = _scope(user)
    db = get_service_client()
    name_key = body.occasion.strip().lower()
    q = db.table("companies").select("id,name,account_owner_id").not_.is_("client_since", "null")
    if scope is not None:
        q = q.in_("account_owner_id", scope)
    clients = q.limit(5000).execute().data
    ids = [c["id"] for c in clients]
    if not ids:
        raise AppError("There are no clients to call yet.", status_code=422)
    occ, won = par(
        lambda: db.table("client_occasions").select("company_id,name").in_("company_id", ids).execute().data,
        lambda: db.table("leads").select("company_id,occasion").in_("company_id", ids).not_.is_("occasion", "null").execute().data,
    )
    # Who to call: clients who have this occasion on their card, or who have had a project for it before.
    match = {r["company_id"] for r in occ if r["name"].strip().lower() == name_key} | {r["company_id"] for r in won if (r["occasion"] or "").strip().lower() == name_key}
    targets = [c for c in clients if c["id"] in match]
    if not targets:
        raise AppError(f"No client has {body.occasion.strip()} as an occasion or a past {body.occasion.strip()} project yet.", status_code=422)

    due = body.due_date or today_ist()
    when = f" on {body.occurs_on:%d %b}" if body.occurs_on else ""
    campaign = db.table("campaigns").insert(
        {"name": (body.name or "").strip() or f"{body.occasion.strip()} {(body.occurs_on or today_ist()).year}", "occasion": body.occasion.strip(),
         "occurs_on": body.occurs_on.isoformat() if body.occurs_on else None, "created_by": user.id}
    ).execute().data[0]
    db.table("campaign_targets").insert([{"campaign_id": campaign["id"], "company_id": c["id"]} for c in targets]).execute()
    db.table("tasks").insert(
        [{"id": str(uuid4()), "company_id": c["id"], "owner_id": c.get("account_owner_id") or user.id, "kind": "follow_up",
          "title": f"{body.occasion.strip()}{when}: ask about gifting", "due_date": due.isoformat(), "campaign_id": campaign["id"]} for c in targets]
    ).execute()
    for owner in {c.get("account_owner_id") for c in targets if c.get("account_owner_id") and c.get("account_owner_id") != user.id}:
        notify(owner, f"campaign:{campaign['id']}", f"{campaign['name']}: clients to call", "They are on your Today screen.", "/today")
    write_audit(user.id, "create", "campaigns", campaign["id"], {"targets": len(targets)})
    return {"id": campaign["id"], "name": campaign["name"], "targets": len(targets)}


def list_campaigns(user: Profile) -> list[dict]:
    require_lead_role(user)
    db = get_service_client()
    campaigns = db.table("campaigns").select("*").order("created_at", desc=True).limit(20).execute().data
    if not campaigns:
        return []
    targets = db.table("campaign_targets").select("campaign_id,outcome,company:companies(account_owner_id)").in_("campaign_id", [c["id"] for c in campaigns]).execute().data
    scope = _scope(user)
    counts: dict[str, dict[str, int]] = {}
    for t in targets:
        if scope is not None and (t.get("company") or {}).get("account_owner_id") not in scope:
            continue
        c = counts.setdefault(t["campaign_id"], {"pending": 0, "interested": 0, "not_now": 0, "no_answer": 0})
        c[t["outcome"]] = c.get(t["outcome"], 0) + 1
    out = []
    for c in campaigns:
        n = counts.get(c["id"])
        if not n:
            continue
        out.append({**c, "counts": n, "total": sum(n.values())})
    return out
