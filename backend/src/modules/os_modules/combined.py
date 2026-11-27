""""All clients": the same OS modules for every client the person may see, put together. Each client is asked in turn
(side by side) and every row says whose it is (accountId, accountName). Pure joining; the calls are passed in."""
import logging
from collections import Counter
from typing import Any, Callable

from src.core.errors import AppError
from src.core.parallel import par

log = logging.getLogger(__name__)
PER_CLIENT = 500  # the most rows one client contributes to a combined list
HOME_PEOPLE = 20
HOME_ACTIVITY = 6

Fetch = Callable[[str, dict], Any]  # (Gifting OS tenant id, query) -> that client's answer


def gather(accounts: dict[str, dict], fetch: Fetch, params: dict) -> list[tuple[dict, Any]]:
    """(account, answer) for every client that answers. One client failing must not empty the page; all failing does."""
    def one(tenant: str):
        try:
            return fetch(tenant, params), None
        except AppError as exc:
            log.warning("Gifting OS module skipped for one client: %s", exc.status_code)
            return None, exc

    tenants = list(accounts)
    results = par(*[lambda t=t: one(t) for t in tenants]) if tenants else []
    found = [(accounts[t], data) for t, (data, _) in zip(tenants, results) if data is not None]
    if tenants and not found:
        raise next(error for _, error in results if error)
    return found


def _named(account: dict, item: dict, key: str = "key") -> dict:
    out = {**item, "accountId": account["id"], "accountName": account["name"]}
    if out.get(key):
        out[key] = f"{account['id']}:{out[key]}"  # the same date or festival exists once per client
    return out


def _total(answer: dict) -> int:
    page = answer.get("pagination") or {}
    return int(page.get("total_records") or page.get("totalRecords") or len(answer.get("items") or []))


def _paged(items: list, page: int, limit: int, total: int) -> dict:
    return {"items": items[(page - 1) * limit : page * limit], "pagination": {"page": page, "limit": limit, "total_records": total}}


def calendar(found: list, page: int, limit: int) -> dict:
    rows = sorted((_named(a, i) for a, d in found for i in d["items"]), key=lambda i: (i["date"], i["name"].lower()))
    counts: Counter = Counter()
    for _, d in found:
        counts.update(d.get("counts") or {})
    return {**_paged(rows, page, limit, len(rows)), "counts": dict(counts), "actionsEnabled": any(d.get("actionsEnabled") for _, d in found)}


def occasions(found: list) -> dict:
    """Each client's own occasions, and TOFAA's occasions for every client once."""
    rows: dict[str, dict] = {}
    for account, d in found:
        for item in d["items"]:
            rows.setdefault(item["id"], _named(account, item, key="") if item.get("tenantId") else item)
    items = sorted(rows.values(), key=lambda o: o["occasionName"].lower())
    return {"items": items, "pagination": {"page": 1, "limit": len(items), "total_records": len(items)},
            "actionsEnabled": any(d.get("actionsEnabled") for _, d in found)}


def events(found: list, page: int, limit: int) -> dict:
    rows = sorted((_named(a, i, key="") for a, d in found for i in d["items"]), key=lambda e: (e["eventDate"], e["eventName"].lower()))
    return {**_paged(rows, page, limit, sum(_total(d) for _, d in found)), "actionsEnabled": any(d.get("actionsEnabled") for _, d in found)}


def activity(found: list, page: int, limit: int) -> dict:
    rows = sorted((_named(a, i, key="id") for a, d in found for i in d["items"]), key=lambda x: x["changedAt"], reverse=True)
    return _paged(rows, page, limit, sum(_total(d) for _, d in found))


def home(found: list) -> dict:
    days: dict[tuple, dict] = {}
    for account, d in found:
        for item in d["calendar"]["items"]:
            # A company occasion shared by every client shows once on the combined calendar.
            shared = item.get("category") == "COMPANY"
            key = (item["date"], item["title"].lower(), item["label"]) if shared else (account["id"], item["key"])
            days.setdefault(key, _named(account, item))

    def people(which: str) -> list:
        rows = (_named(a, p, key="") for a, d in found for p in d["summary"][which])
        return sorted(rows, key=lambda p: (p["daysAway"], p["name"].lower()))[:HOME_PEOPLE]

    actions = [_named(a, i) for a, d in found for i in d["summary"]["actionRequired"]["items"]]
    feed = sorted((_named(a, i, key="id") for a, d in found for i in d["activity"]), key=lambda x: x["changedAt"], reverse=True)
    counts: Counter = Counter()
    for _, d in found:
        counts.update(d["calendar"].get("counts") or {})
    return {
        "calendar": {"month": found[0][1]["calendar"]["month"] if found else None, "items": sorted(days.values(), key=lambda x: x["date"]), "counts": dict(counts)},
        "summary": {
            "importantExternal": people("importantExternal"), "importantInternal": people("importantInternal"),
            "actionRequired": {"total": sum(d["summary"]["actionRequired"]["total"] for _, d in found), "items": actions},
        },
        "activity": feed[:HOME_ACTIVITY],
    }


def read(accounts: dict[str, dict], what: str, fetch: Fetch, params: dict) -> dict:
    page, limit = int(params.get("page") or 1), int(params.get("limit") or 20)
    if what == "home":
        return home(gather(accounts, fetch, params))
    if what == "occasions":
        return occasions(gather(accounts, fetch, {"limit": PER_CLIENT}))
    # Paged lists: take enough rows from each client to build the page asked for, then cut it here.
    wanted = min(page * limit, PER_CLIENT) if what == "activity" else PER_CLIENT
    found = gather(accounts, fetch, {**params, "page": 1, "limit": wanted})
    return {"calendar": calendar, "events": events, "activity": activity}[what](found, page, limit)
