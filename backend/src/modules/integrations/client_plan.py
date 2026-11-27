"""What must change so that CRM client accounts and Gifting OS clients agree. Pure: rows in, actions out.

A linked pair keeps one name and one on/off state; the side that changed since the last sync wins (the CRM when that
cannot be told). A client on one side only is linked to its namesake on the other, else created there. Nothing is ever
deleted, and two accounts are never merged.
"""
from src.core.keys import company_key

DEACTIVATED = "DEACTIVATED"


def plan(companies: list[dict], tenants: list[dict], synced: dict[str, dict], ignored: set[str]) -> list[dict]:
    """`companies`: CRM accounts that are clients or linked (deleted ones included). `tenants`: every Gifting OS client.
    `synced`: per Gifting OS id, the {name, active} both sides had after the last sync."""
    by_id = {str(t["id"]): t for t in tenants}
    linked = {str(c["gifting_tenant_id"]): c for c in companies if c.get("gifting_tenant_id")}
    actions: list[dict] = []

    for tenant_id, company in linked.items():
        tenant = by_id.get(tenant_id)
        if not tenant:
            continue
        base = synced.get(tenant_id) or {}
        pair = {"tenantId": tenant_id, "companyId": company["id"]}
        crm_on, os_on = not company.get("deleted_at"), tenant.get("status") != DEACTIVATED
        if crm_on != os_on:
            if base.get("active") == crm_on:  # only Gifting OS changed: the CRM never deletes an account by itself
                actions.append({**pair, "do": "note_os_state", "active": os_on, "name": company["name"]})
            else:
                actions.append({**pair, "do": "os_state", "active": crm_on, "name": company["name"]})
        crm_name, os_name = company["name"].strip(), (tenant.get("name") or "").strip()
        if crm_on and crm_name != os_name:
            if base.get("name") == crm_name:
                actions.append({**pair, "do": "crm_rename", "name": os_name})
            else:
                actions.append({**pair, "do": "os_rename", "name": crm_name})

    free = [t for i, t in by_id.items() if i not in linked and i not in ignored and t.get("status") != DEACTIVATED]
    namesakes: dict[str, list[dict]] = {}
    for tenant in free:
        namesakes.setdefault(company_key(tenant["name"]), []).append(tenant)
    taken: set[str] = set()

    for company in companies:
        if company.get("gifting_tenant_id") or company.get("deleted_at") or not company.get("client_since"):
            continue
        found = namesakes.get(company_key(company["name"]), [])
        if len(found) > 1:
            actions.append({"do": "skip", "name": company["name"], "why": "Gifting OS has more than one client with this name."})
            taken.update(str(t["id"]) for t in found)
        elif found and str(found[0]["id"]) not in taken:
            taken.add(str(found[0]["id"]))
            actions.append({"do": "link", "companyId": company["id"], "tenantId": str(found[0]["id"]), "name": company["name"]})
        else:
            actions.append({"do": "os_create", "companyId": company["id"], "name": company["name"].strip()})

    for tenant in free:
        if str(tenant["id"]) not in taken:
            actions.append({"do": "crm_create", "tenantId": str(tenant["id"]), "name": tenant["name"].strip()})
    return actions


def agreed(companies: list[dict], tenants: list[dict], synced: dict[str, dict]) -> dict[str, dict]:
    """What to remember after a sync: each linked pair's name and state where both sides now match. A pair that still
    differs keeps its earlier memory, so the change is tried again."""
    by_id = {str(t["id"]): t for t in tenants}
    out = dict(synced)
    for company in companies:
        tenant = by_id.get(str(company.get("gifting_tenant_id")))
        if not tenant:
            continue
        key = str(tenant["id"])
        entry = dict(out.get(key) or {})
        if company["name"].strip() == (tenant.get("name") or "").strip():
            entry["name"] = company["name"].strip()
        crm_on = not company.get("deleted_at")
        if crm_on == (tenant.get("status") != DEACTIVATED):
            entry["active"] = crm_on
        out[key] = entry
    return out
