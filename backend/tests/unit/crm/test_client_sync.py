"""Two-way client sync: what has to change for CRM accounts and Gifting OS clients to agree."""
from src.modules.integrations import client_sync
from src.modules.integrations.client_plan import agreed, plan


def company(i, name, tenant=None, deleted=False, client=True):
    return {"id": i, "name": name, "gifting_tenant_id": tenant, "deleted_at": "2026-01-01" if deleted else None,
            "client_since": "2026-01-01" if client else None}


def tenant(i, name, status="ACTIVE"):
    return {"id": i, "name": name, "status": status}


def do(actions):
    return [(a["do"], a["name"]) for a in actions]


def test_a_client_on_one_side_is_linked_or_made_on_the_other():
    actions = plan([company("c1", "Acme Pvt. Ltd."), company("c2", "Only Crm"), company("c3", "A lead", client=False)],
                   [tenant("t1", "ACME PVT LTD"), tenant("t2", "Only Os"), tenant("t3", "Old", "DEACTIVATED"), tenant("t4", "Ignored")], {}, {"t4"})
    assert do(actions) == [("link", "Acme Pvt. Ltd."), ("os_create", "Only Crm"), ("crm_create", "Only Os")]


def test_the_side_that_changed_wins_a_rename():
    base = {"t": {"name": "Old", "active": True}}
    assert do(plan([company("c", "Old", "t")], [tenant("t", "New in OS")], base, set())) == [("crm_rename", "New in OS")]
    assert do(plan([company("c", "New in CRM", "t")], [tenant("t", "Old")], base, set())) == [("os_rename", "New in CRM")]
    assert do(plan([company("c", "A", "t")], [tenant("t", "B")], {}, set())) == [("os_rename", "A")]  # unknown: the CRM


def test_deleting_in_the_crm_switches_the_client_off_but_nothing_is_deleted_for_an_os_change():
    base = {"t": {"name": "A", "active": True}}
    gone = plan([company("c", "A", "t", deleted=True)], [tenant("t", "A")], base, set())
    assert do(gone) == [("os_state", "A")] and gone[0]["active"] is False
    off = plan([company("c", "A", "t")], [tenant("t", "A", "DEACTIVATED")], base, set())
    assert do(off) == [("note_os_state", "A")]
    back = plan([company("c", "A", "t")], [tenant("t", "A", "DEACTIVATED")], {"t": {"active": False}}, set())
    assert do(back) == [("os_state", "A")] and back[0]["active"] is True  # restored in the CRM


def test_a_linked_or_ignored_client_is_never_imported_again():
    assert plan([company("c", "A", "t1")], [tenant("t1", "A"), tenant("t2", "Old copy")], {}, {"t2"}) == []


def test_only_agreeing_values_are_remembered():
    out = agreed([company("c", "A", "t")], [tenant("t", "B")], {"t": {"name": "Z", "active": True}})
    assert out == {"t": {"name": "Z", "active": True}}


def test_client_writes_start_a_sync():
    assert client_sync.is_client_write("POST", "/api/v1/clients", 201)
    assert client_sync.is_client_write("PATCH", "/api/v1/leads/1", 200)
    assert not client_sync.is_client_write("GET", "/api/v1/clients", 200)
    assert not client_sync.is_client_write("POST", "/api/v1/clientsX", 200)
    assert not client_sync.is_client_write("DELETE", "/api/v1/clients/1", 409)
