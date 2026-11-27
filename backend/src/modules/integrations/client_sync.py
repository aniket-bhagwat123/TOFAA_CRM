"""Keeps CRM client accounts and Gifting OS clients in step (the rules: client_plan.py).

Runs after a client change on either side and every GIFTING_CLIENT_SYNC_SECONDS, so a change missed while one app was
down is caught up. Off when that setting is 0. Needs Gifting OS's CRM_KAM_ACTIONS_ENABLED for changes made there.
What was last agreed is kept in app_settings (no migration of its own).
"""
import logging
import threading
from datetime import datetime, timezone

from fastapi import FastAPI, Request

from src.core import cache
from src.core.config import settings
from src.core.errors import AppError, ConflictError
from src.core.keys import company_key
from src.core.soft_delete import live
from src.core.supabase import get_service_client
from src.modules.gifting_requests import service as gifting
from src.modules.integrations import client_plan
from src.modules.integrations.people_notice import notifier as people_notifier

log = logging.getLogger(__name__)
BASE = "/api/v1/integrations/crm/clients"
STATE_KEY = "gifting_client_sync"
ACTOR = {"actorId": "00000000-0000-4000-8000-00000000c11e", "actorName": "TOFAA CRM sync"}
COLUMNS = "id,name,client_since,gifting_tenant_id,deleted_at"
CHANGE_PATHS = ("/clients", "/leads", "/imports")  # CRM writes that can add, rename or remove a client account
WRITES = ("POST", "PATCH", "PUT", "DELETE")
_running = threading.Lock()


def configured() -> bool:
    return bool(settings.GIFTING_OS_API_URL) and len(settings.GIFTING_OS_API_KEY) >= 32


def _state() -> dict:
    rows = get_service_client().table("app_settings").select("value").eq("key", STATE_KEY).limit(1).execute().data
    value = rows[0]["value"] if rows else {}
    return {"synced": value.get("synced") or {}, "ignored": value.get("ignored") or []}


def save_state(state: dict) -> None:
    get_service_client().table("app_settings").upsert({"key": STATE_KEY, "value": state}, on_conflict="key").execute()


def _companies() -> list[dict]:
    q = get_service_client().table("companies").select(COLUMNS).or_("client_since.not.is.null,gifting_tenant_id.not.is.null")
    return q.order("name").limit(1000).execute().data


def _tenants() -> list[dict]:
    return gifting._call("/list", {}, BASE)["items"]


def _link(company_id: str, tenant_id: str) -> None:
    db = get_service_client()
    if db.table("companies").select("id").eq("gifting_tenant_id", tenant_id).limit(1).execute().data:
        raise ConflictError("That Gifting OS client is already linked to another account.")
    db.table("companies").update({"gifting_tenant_id": tenant_id}).eq("id", company_id).is_("gifting_tenant_id", "null").execute()
    # Copy this account's people and groups: mark them changed, then tell Gifting OS.
    db.table("recipients").update({"changed_at": datetime.now(timezone.utc).isoformat()}).eq("company_id", company_id).execute()
    people_notifier.poke()


def _apply(action: dict) -> None:
    do = action["do"]
    if do == "link":
        _link(action["companyId"], action["tenantId"])
    elif do == "os_create":
        _link(action["companyId"], gifting._call("/create", {"name": action["name"], **ACTOR}, BASE)["tenantId"])
    elif do == "crm_create":
        # The same rule as a person first saved from Gifting OS: the namesake account, else a new client account.
        from src.modules.integrations.gifting_people import link_account

        link_account(action["tenantId"], action["name"])
        people_notifier.poke()
    elif do in ("os_rename", "os_state"):
        body = {"tenantId": action["tenantId"], **ACTOR}
        body.update({"name": action["name"]} if do == "os_rename" else {"active": action["active"]})
        gifting._call("/update", body, BASE)
    elif do == "crm_rename":
        db = get_service_client()
        key = company_key(action["name"])
        other = live(db.table("companies").select("id").eq("name_key", key).neq("id", action["companyId"]), "companies").limit(1).execute().data
        if other:
            raise ConflictError("Another CRM account already has this name.")
        db.table("companies").update({"name": action["name"], "name_key": key}).eq("id", action["companyId"]).execute()
    else:  # note_os_state, skip: nothing to write
        return
    log.info("client sync %s: %r", do, action["name"])


def run(dry_run: bool = False) -> list[dict]:
    """One pass. Returns the actions with `done` or `error`; with `dry_run` only what would be done."""
    with _running:
        state = _state()
        companies, tenants = _companies(), _tenants()
        actions = client_plan.plan(companies, tenants, state["synced"], set(state["ignored"]))
        if dry_run:
            return actions
        changed = False
        for action in actions:
            try:
                _apply(action)
                action["done"] = True
                changed = changed or action["do"] not in ("note_os_state", "skip")
            except AppError as exc:
                action["error"] = exc.message
                log.warning("client sync %s failed for %r: %s", action["do"], action["name"], exc.message)
            except Exception:  # noqa: BLE001 - one client must not stop the others
                action["error"] = "failed"
                log.exception("client sync %s failed for %r", action["do"], action["name"])
        if changed:
            cache.clear()
            companies, tenants = _companies(), _tenants()
        synced = client_plan.agreed(companies, tenants, state["synced"])
        for action in actions:  # a change made only in Gifting OS is remembered, so it is not undone later
            if action["do"] == "note_os_state":
                log.info("client %r was switched %s in Gifting OS", action["name"], "on" if action["active"] else "off")
        if synced != state["synced"]:
            save_state({**state, "synced": synced})
        return actions


class Worker:
    def __init__(self) -> None:
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if settings.GIFTING_CLIENT_SYNC_SECONDS <= 0 or not configured() or (self._thread and self._thread.is_alive()):
            return
        self._thread = threading.Thread(target=self._loop, name="gifting-client-sync", daemon=True)
        self._thread.start()
        self._wake.set()  # catch up at once

    def poke(self) -> None:
        self._wake.set()

    def _loop(self) -> None:
        while True:
            self._wake.wait(settings.GIFTING_CLIENT_SYNC_SECONDS)
            self._wake.wait(0.1)
            self._wake.clear()
            try:
                run()
            except Exception as exc:  # noqa: BLE001 - Gifting OS down: the next pass tries again
                log.warning("client sync failed: %s", type(exc).__name__)


worker = Worker()


def is_client_write(method: str, path: str, status: int) -> bool:
    rest = path.removeprefix(settings.API_V1_STR)
    return method in WRITES and status < 400 and any(rest == p or rest.startswith(p + "/") for p in CHANGE_PATHS)


def install_client_sync(app: FastAPI) -> None:
    @app.middleware("http")
    async def _sync(request: Request, call_next):
        response = await call_next(request)
        if is_client_write(request.method, request.url.path, response.status_code):
            worker.poke()
        return response
