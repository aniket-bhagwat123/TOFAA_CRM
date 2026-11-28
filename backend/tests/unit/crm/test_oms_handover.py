"""OMS handover: approval rules, what OMS reads, stage mapping, old and repeated updates, and the OMS key."""
from copy import deepcopy
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from src.core.config import settings
from src.core.dates import now_ist
from src.core.errors import AppError, ConflictError, ForbiddenError
from src.main import app
from src.modules.auth.schemas import Profile, Role
from src.modules.orders import flow, handover, handover_rules as rules
from src.modules.orders.handover_schemas import HandoverIn
from src.modules.orders.oms_schemas import Handover, StatusUpdate

KAM = Profile.model_construct(id="k", role=Role.KAM)
MANAGER = Profile.model_construct(id="m", role=Role.SALES_MANAGER)
OWNER = {"id": "k", "full_name": "Asha", "email": "asha@example.com"}
PLACE = {"location_ref": "L1", "line": "1 Road", "city": "Pune", "state": "MH", "pincode": "411001", "contact_name": "Ravi",
         "contact_phone": "9999999999", "quantity": 60}
ORDER = {
    "id": "o", "order_number": "ORD-00012", "deal_number": "DEAL-2027-0001", "handover_number": "HO-2027-0001", "lead_id": "d", "company_id": "c", "source": "payment", "status": "new",
    "company": {"name": "Client Pvt Ltd"}, "owner": OWNER, "total_kits": 100, "expected_delivery": "2027-01-31",
    "advance_percent": 50, "sample": {"required": False}, "instructions": "Gold ribbon", "notes": "secret", "total": 777123,
    "billing_gstin": "27AIEPC1532D2ZY", "items": [{"name": "Hamper", "quantity": 100, "unit_price": 1250, "details": [], "photos": []}],
    "handover_items": [{"item_ref": "I1", "name": "Mug", "quantity_per_kit": 2, "photos": ["o/a.jpg"]}],
    "delivery_locations": [PLACE, {**PLACE, "location_ref": "L2", "quantity": 40}],
    "handover_status": "draft", "handover_version": 0,
}
PUBLISHED = rules.build(ORDER, ORDER["company"], OWNER, 1)


# --- preparing ----------------------------------------------------------------------------------------------------------

def test_a_draft_is_filled_from_the_order_without_inventing_anything():
    order = {"items": [{"name": "Hamper", "quantity": 100, "details": [{"name": "Mug"}, {"name": "Box"}], "photos": ["d/p.jpg"]}],
             "delivery_address": "1 Road", "receiver_name": "Ravi", "lead": {"occasion": "Diwali 2027"}}
    draft = rules.prefill(order)
    assert [i["name"] for i in draft["handover_items"]] == ["Mug", "Box"] and draft["total_kits"] == 100
    assert draft["delivery_locations"][0]["city"] is None and draft["campaign_name"] == "Diwali 2027"
    two = rules.prefill({"items": [{"name": "A", "quantity": 5}, {"name": "B", "quantity": 9}]})
    assert "total_kits" not in two  # two kit sizes: the KAM decides
    assert "total_kits" not in rules.prefill({"items": [{"name": "A", "quantity": 1.5}]})


def test_a_complete_handover_has_no_problems_and_incomplete_ones_say_why():
    assert rules.problems(ORDER, "Client Pvt Ltd", OWNER) == []
    assert rules.problems({**ORDER, "source": "manual"}, "x", OWNER) == ["Deals made by hand do not go to OMS."]
    bad = {**ORDER, "sample": {"required": True, "approver_name": "R"},
           "delivery_locations": [{**PLACE, "pincode": None, "quantity": 90}]}
    found = " ".join(rules.problems(bad, "Client", OWNER))
    assert "pincode" in found and "add up to 90" in found and "evidence" in found
    for optional in (0, None):
        assert rules.problems({**ORDER, "advance_percent": optional}, "Client", OWNER) == []
    published = rules.build({**ORDER, "advance_percent": None}, ORDER["company"], OWNER, 1)
    Handover.model_validate({**rules.with_links(published, {}), "status": "approved", "updated_at": "2027-01-01T00:00:00Z"})


def test_what_oms_reads_has_the_contract_shape_and_no_money():
    out = rules.with_links(PUBLISHED, {"o/a.jpg": "https://files/a"})
    Handover.model_validate({**out, "status": "approved", "updated_at": "2027-01-01T00:00:00Z"})
    assert out["items"][0]["photo_urls"] == ["https://files/a"] and out["client_instructions"] == "Gold ribbon"
    text = str(out)
    for hidden in ("secret", "unit_price", "777123", "1250", "27AIEPC", "gst", "total'"):
        assert hidden not in text


# --- stages -------------------------------------------------------------------------------------------------------------

def plan(current, stage, shipments=(), held=None):
    return rules.plan(current, held, stage, list(shipments), PUBLISHED)


def ship(ref, kits, **more):
    return {"location_ref": ref, "kits": kits, "dispatched_at": "x", **more}


def test_skipped_stages_are_filled_in_and_nothing_moves_backwards():
    assert plan("ready", "accepted") == ["accepted"]
    assert plan("ready", "packing") == ["accepted", "production", "packed"]
    assert plan("production", "warehouse_ready") == []
    assert plan("packed", "design_and_procurement") == []
    assert plan("quality_check", "packing") == ["packed"]
    assert plan("delivered", "on_hold") == [] and plan("cancelled", "accepted") == []


def test_partial_dispatch_and_delivery():
    part = [ship("L1", 60)]
    assert plan("packed", "dispatched", part) == []
    assert plan("accepted", "dispatched", part) == ["production", "packed"]
    full = [*part, ship("L2", 40)]
    assert plan("packed", "dispatched", full) == ["dispatched"]
    assert plan("packed", "dispatched", [ship("L1", 100)]) == []  # nothing went to the second location
    assert plan("dispatched", "delivered", [ship("L1", 60, delivered_at="y"), ship("L2", 40)]) == []
    assert plan("packed", "delivered", [ship("L1", 60, delivered_at="y"), ship("L2", 40, delivered_at="y")]) == ["dispatched", "delivered"]


def test_hold_and_cancel():
    assert plan("dispatched", "on_hold") == ["on_hold"] and plan("on_hold", "on_hold") == []
    assert plan("on_hold", "accepted", held="production") == ["production"]
    assert plan("on_hold", "packing", held="production") == ["production", "packed"]
    assert plan("on_hold", "cancelled", held="production") == ["cancelled"]


def test_repeated_shipments_are_merged_not_doubled():
    first = rules.merge_shipments([], [{"location_ref": "L1", "kits": 30, "tracking_number": "A"}])
    again = rules.merge_shipments(first, [{"location_ref": "L1", "kits": 30, "tracking_number": "A"}])
    assert again == first
    two = rules.merge_shipments(again, [{"location_ref": "L1", "kits": 30, "tracking_number": "B"}])
    assert len(two) == 2
    with pytest.raises(ValueError, match="tracking_number"):
        rules.merge_shipments(two, [{"location_ref": "L1", "delivered_at": "y"}])
    assert rules.merge_shipments(first, [{"location_ref": "L1", "delivered_at": "y"}])[0]["tracking_number"] == "A"


# --- the services, with the database faked -----------------------------------------------------------------------------

class Db:
    """Remembers writes; every update succeeds."""

    def __init__(self):
        self.writes = []

    def table(self, name):
        db = self

        class Query:
            def __getattr__(self, method):
                def call(*args, **kwargs):
                    if method in ("update", "insert"):
                        db.writes.append((name, args[0]))
                    return self

                return call

            @property
            def not_(self):
                return self

            def execute(self):
                return type("R", (), {"data": [{"id": "m"}], "count": 1})()

        return Query()


@pytest.fixture
def world(monkeypatch):
    row = deepcopy(ORDER)
    db, moved, history, told = Db(), [], [], []
    monkeypatch.setattr(handover, "get_service_client", lambda: db)
    monkeypatch.setattr(handover, "_load", lambda user, i: row)
    monkeypatch.setattr(handover, "get", lambda user, i: {"id": i})
    monkeypatch.setattr(handover, "_view", lambda user, o: {"unchanged": True})
    monkeypatch.setattr(handover, "find_published", lambda n: row)
    for name in ("write_audit", "add_activity", "notify"):
        monkeypatch.setattr(handover, name, lambda *a, **k: None)
    monkeypatch.setattr(handover, "_mark_won", lambda *a: None)
    monkeypatch.setattr(flow, "move", lambda o, status, **kw: moved.append(status))
    monkeypatch.setattr(flow, "_record", lambda o, to, *a: history.append((o["status"], to)))
    monkeypatch.setattr(flow, "tell_owner", lambda o, status, note: told.append((status, note)))
    return row, db, moved, history, told


def test_only_a_manager_approves_and_approval_publishes_the_next_version(world):
    row, db, moved, _, _ = world
    row |= {"handover_status": "pending_approval", "handover_submitted_at": "2027-01-01T10:00:00+05:30", "handover_version": 1}
    args = (True, 1, "2027-01-01T04:30:00Z", None)
    with pytest.raises(ForbiddenError):
        handover.decide(KAM, "o", *args)
    with pytest.raises(ConflictError, match="changed"):
        handover.decide(MANAGER, "o", True, 1, "2027-01-02T00:00:00Z", None)
    handover.decide(MANAGER, "o", *args)
    patch = db.writes[0][1]
    assert patch["handover_version"] == 2 and patch["published"]["version"] == 2 and patch["published_status"] == "approved"
    assert moved == ["ready"]


def test_an_edit_needs_approval_again_but_oms_keeps_the_approved_version(world):
    row, db, _, _, _ = world
    row |= {"handover_status": "approved", "published": PUBLISHED, "handover_version": 1}
    body = {"total_kits": 120, "items": [dict(row["handover_items"][0])], "delivery_locations": deepcopy(row["delivery_locations"]),
            "sample": {"required": False}}
    handover.save(KAM, "o", body)
    patch = db.writes[0][1]
    assert patch["handover_status"] == "draft" and "published" not in patch and "handover_version" not in patch


def test_cancel_tells_oms_only_when_oms_has_seen_it(world):
    row, db, moved, _, _ = world
    row |= {"handover_status": "approved", "published": PUBLISHED, "published_status": "approved", "handover_version": 1, "status": "production"}
    handover.cancel(KAM, "o", "Client stopped")
    patch = db.writes[0][1]
    assert patch["published_status"] == "cancelled" and patch["published"]["version"] == 2 and moved == []
    db.writes.clear()
    row |= {"published": None, "handover_version": 0, "status": "new"}
    handover.cancel(KAM, "o", "Client stopped")
    assert "published" not in db.writes[0][1] and moved == ["cancelled"]


def message(**more):
    base = {"oms_order_id": "x1", "oms_order_number": "TOF-ORD-2027-00001", "stage": "packing",
            "changed_at": now_ist() - timedelta(minutes=5)}
    return StatusUpdate.model_validate({**base, **more}).model_dump()


def test_an_oms_update_fills_and_logs_each_step(world):
    row, db, _, history, told = world
    row |= {"status": "ready", "published": PUBLISHED}
    result, _ = handover.apply_oms_update("ORD-00012", message())
    assert result["applied"] and result["crm_status"] == "packed"
    assert history == [("ready", "accepted"), ("accepted", "production"), ("production", "packed")]
    assert db.writes[0][1]["oms_reference"] == "x1" and told == [("packed", None)]


def test_old_updates_and_other_oms_orders_are_refused(world):
    row, db, _, _, _ = world
    now = now_ist()
    row |= {"status": "production", "published": PUBLISHED, "oms_stage": "design_and_procurement", "oms_reference": "x1",
            "oms_changed_at": (now - timedelta(minutes=1)).isoformat()}
    result, why = handover.apply_oms_update("ORD-00012", message(changed_at=now - timedelta(minutes=2)))
    assert not result["applied"] and "Ignored" in why and db.writes == []
    with pytest.raises(ConflictError, match="oms_order_id"):
        handover.apply_oms_update("ORD-00012", message(oms_order_id="other", changed_at=now))
    with pytest.raises(AppError, match="future"):
        handover.apply_oms_update("ORD-00012", message(changed_at=now + timedelta(days=1)))
    with pytest.raises(AppError, match="location_ref"):
        handover.apply_oms_update("ORD-00012", message(stage="dispatched", changed_at=now, locations=[{"location_ref": "NO", "kits": 1}]))


def test_a_hold_with_a_note_reaches_the_kam(world):
    row, db, _, _, told = world
    row |= {"status": "dispatched", "published": PUBLISHED}
    handover.apply_oms_update("ORD-00012", message(stage="on_hold", note="Client wants to cancel"))
    assert db.writes[0][1]["held_from"] == "dispatched" and told == [("on_hold", "Client wants to cancel")]


def test_bad_oms_messages_are_refused():
    for bad in ({"stage": "on_hold"}, {"stage": "shipped"}, {"stage": "dispatched"}, {"oms_order_number": "ORD-1"},
                {"changed_at": "2027-01-01T10:00:00"}, {"stage": "dispatched", "locations": [{"location_ref": "L1"}]},
                {"stage": "dispatched", "locations": [{"location_ref": "L1", "kits": 1.5}]}):
        with pytest.raises(ValueError):
            message(**bad)


def test_oms_calls_need_the_key_and_swagger_documents_them(monkeypatch):
    client = TestClient(app)
    url = "/api/v1/handovers"
    monkeypatch.setattr(settings, "OMS_INBOUND_KEY", "")
    assert client.get(url, headers={"X-API-Key": ""}).status_code == 401
    monkeypatch.setattr(settings, "OMS_INBOUND_KEY", "k" * 40)
    assert client.get(url).status_code == 401
    assert client.get(url + "/ORD-1", headers={"X-API-Key": "x" * 40}).status_code == 401
    assert client.post(url + "/ORD-1/status", json={}).status_code == 401
    assert client.get("/api/v1/oms/orders", headers={"X-API-Key": "k" * 40}).status_code == 404  # the old API is gone
    paths = app.openapi()["paths"]
    assert {url, url + "/{handover_number}", url + "/{handover_number}/status"} <= set(paths)


def test_oms_reads_a_published_handover_over_http(monkeypatch):
    monkeypatch.setattr(settings, "OMS_INBOUND_KEY", "k" * 40)
    row = {"published": PUBLISHED, "published_status": "approved", "published_at": "2027-01-01T10:00:00+05:30"}
    monkeypatch.setattr(handover, "find_published", lambda n: row)
    monkeypatch.setattr(handover, "signed_urls", lambda bucket, paths: {p: "https://files/" + p for p in paths})
    res = TestClient(app).get("/api/v1/handovers/ORD-00012", headers={"X-API-Key": "k" * 40})
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["handover_number"] == "HO-2027-0001" and data["deal_number"] == "DEAL-2027-0001" and data["updated_at"] == "2027-01-01T04:30:00Z"
    assert data["delivery_locations"][0]["address"]["pincode"] == "411001" and "total" not in data


def test_once_handovers_are_live_nothing_is_moved_or_created_by_hand(monkeypatch):
    monkeypatch.setattr(flow, "require_upgraded", lambda: None)
    monkeypatch.setattr(handover, "ready", lambda: True)
    for status in ("ready", "accepted", "cancelled"):
        with pytest.raises(ConflictError, match="comes from the OMS"):
            flow.set_status(KAM, "o", status, "note")
    with pytest.raises(ConflictError, match="by hand"):
        flow.create(KAM, "c", [], 0, 18, {})


def test_saving_without_changes_keeps_the_approval(world):
    row, db, _, _, _ = world
    items = [{"item_ref": "I1", "product_id": None, "name": "Mug", "description": None, "quantity_per_kit": 2,
              "is_packaging": False, "photos": ["o/a.jpg"]}]
    row.update(handover_status="approved", handover_items=items, advance_percent=50.0, reference_files=[], logo_files=[])
    same = {k: row.get(k) for k in ("total_kits", "expected_delivery", "advance_percent", "instructions", "reference_files", "logo_files")}
    body = HandoverIn.model_validate({**same, "items": items, "delivery_locations": row["delivery_locations"], "sample": row["sample"]})
    row["sample"] = body.sample.model_dump(mode="json")
    assert handover.save(KAM, "o", body.model_dump(mode="json")) == {"unchanged": True} and db.writes == []


def test_uploading_the_signed_copy_marks_the_agreement_signed(monkeypatch):
    from src.modules.agreements import service as agreements

    saved, rows = {}, [{"terms_status": "pending"}]

    class Query:
        def __getattr__(self, _):
            return lambda *a, **k: self

        def execute(self):
            return type("R", (), {"data": rows})()

    monkeypatch.setattr(agreements, "get_service_client", lambda: type("Db", (), {"table": lambda self, n: Query()})())
    monkeypatch.setattr(agreements.leads, "get_lead_row", lambda user, i: {"id": i, "stage": "closed_won"})
    monkeypatch.setattr(agreements, "upload_document", lambda *a: "d/signed.pdf")
    monkeypatch.setattr(agreements, "_upsert", lambda lead_id, **fields: saved.update(fields))
    monkeypatch.setattr(agreements, "state", lambda i: {})
    for name in ("write_audit", "add_activity"):
        monkeypatch.setattr(agreements, name, lambda *a, **k: None)
    with pytest.raises(ConflictError, match="not approved"):
        agreements.upload_signed(KAM, "d", b"%PDF-1", "a.pdf")
    rows[0]["terms_status"] = "approved"
    with pytest.raises(AppError):
        agreements.upload_signed(KAM, "d", b"not a document", "a.pdf")
    assert saved == {}
    agreements.upload_signed(KAM, "d", b"%PDF-1", "a.pdf")
    assert saved["signed_at"] and saved["signed_path"] == "d/signed.pdf" and saved["signed_name"] == "a.pdf"


# --- filled once, in the agreement --------------------------------------------------------------------------------------

AGREEMENT = {
    "packages": [{"name": "Hamper", "quantity": 100, "photos": ["d/p.jpg"],
                  "items": [{"name": "Bottle", "description": "Steel", "quantity_per_kit": 2, "photos": ["d/b.jpg"]}, {"name": "Cap"}]}],
    "handover": {"expected_delivery": "2027-01-31", "advance_percent": 50.0, "sample_required": False,
                 "delivery_locations": [{**PLACE, "quantity": None}]},
}


def test_a_complete_agreement_fills_the_whole_handover():
    draft = rules.from_agreement(AGREEMENT)
    assert [(i["name"], i["quantity_per_kit"], i["photos"]) for i in draft["handover_items"]] == [("Bottle", 2, ["d/b.jpg"]), ("Cap", 1, [])]
    assert draft["total_kits"] == 100 and draft["advance_percent"] == 50
    assert rules.problems({**ORDER, "handover_items": None, **draft}, "Client", OWNER) == []
    assert rules.from_agreement(None) == {}


def test_an_agreement_edit_changes_only_what_it_changed():
    order = {**rules.from_agreement(AGREEMENT), "shipments": []}
    order["handover_items"][1]["product_id"] = "P9"  # filled on the handover
    order["client_type"] = "Key Account"
    assert rules.agreement_changes(order, AGREEMENT, deepcopy(AGREEMENT)) == {}
    new = deepcopy(AGREEMENT)
    new["packages"][0]["quantity"] = 150
    new["packages"][0]["items"][1]["quantity_per_kit"] = 3
    new["handover"]["expected_delivery"] = "2027-02-15"
    patch = rules.agreement_changes(order, AGREEMENT, new)
    assert patch["total_kits"] == 150 and patch["expected_delivery"] == "2027-02-15" and "client_type" not in patch
    cap = patch["handover_items"][1]
    assert cap["quantity_per_kit"] == 3 and cap["product_id"] == "P9" and cap["item_ref"] == order["handover_items"][1]["item_ref"]
    assert "delivery_locations" not in patch


def test_a_changed_agreement_sends_an_approved_handover_back_to_draft(world, monkeypatch):
    row, _, _, _, _ = world
    row.update(rules.from_agreement(AGREEMENT), handover_status="approved", published=PUBLISHED, handover_version=1)
    writes = []

    class Query:
        def __getattr__(self, method):
            def call(*args, **kwargs):
                if method == "update":
                    writes.append(args[0])
                return self

            return call

        def execute(self):
            return type("R", (), {"data": [row]})()

    monkeypatch.setattr(handover, "get_service_client", lambda: type("Db", (), {"table": lambda self, n: Query()})())
    monkeypatch.setattr(handover, "ready", lambda: True)
    new = deepcopy(AGREEMENT)
    new["handover"]["advance_percent"] = 30.0
    handover.from_agreement_change(KAM, "d", AGREEMENT, new)
    assert writes[0]["advance_percent"] == 30 and writes[0]["handover_status"] == "draft" and "published" not in writes[0]


def test_oms_payment_status_is_only_recorded(world):
    row, db, moved, history, _ = world
    now = now_ist()
    row.update(published=PUBLISHED, status="ready")
    with pytest.raises(AppError, match="migration"):
        handover.apply_oms_payment("ORD-00012", "success", now)
    row["oms_payment_status"] = None
    result, _ = handover.apply_oms_payment("ORD-00012", "success", now - timedelta(minutes=1))
    assert result == {"handover_number": "HO-2027-0001", "applied": True, "payment_status": "success"}
    assert set(db.writes[0][1]) == {"oms_payment_status", "oms_payment_changed_at", "updated_at"} and moved == history == []
    row.update(oms_payment_status="success", oms_payment_changed_at=now.isoformat())
    db.writes.clear()
    result, _ = handover.apply_oms_payment("ORD-00012", "pending", now - timedelta(minutes=2))
    assert not result["applied"] and result["payment_status"] == "success" and db.writes == []


# --- Won: when OMS has made the Order ------------------------------------------------------------------------------------

def test_the_first_oms_order_number_wins_the_deal_and_cancel_does_not(world, monkeypatch):
    row, _, _, _, _ = world
    won = []
    monkeypatch.setattr(handover, "_mark_won", lambda r, number: won.append(number))
    row |= {"status": "ready", "published": PUBLISHED}
    handover.apply_oms_update("HO-2027-0001", message(stage="accepted"))
    handover.apply_oms_update("HO-2027-0001", message(stage="cancelled", note="stop"))
    assert won == ["TOF-ORD-2027-00001"]


@pytest.mark.parametrize("stage, expected", [("agreement_payment", 1), ("closed_won", 0), ("closed_lost", 0)])
def test_a_deal_is_won_once_with_the_agreement_total(monkeypatch, stage, expected):
    from src.modules.clients import service as clients
    from src.modules.tasks import service as tasks

    writes, closed = [], []
    rows = {"leads": [{"id": "d", "stage": stage, "owner_id": "k"}], "agreements": [{"total_amount": 236000}]}

    class Query:
        def __init__(self, name):
            self.name = name

        def __getattr__(self, method):
            def call(*args, **kwargs):
                if method == "update":
                    writes.append(args[0])
                return self

            return call

        def execute(self):
            return type("R", (), {"data": rows[self.name]})()

    monkeypatch.setattr(handover, "get_service_client", lambda: type("Db", (), {"table": lambda self, n: Query(n)})())
    for name in ("write_audit", "add_activity", "notify"):
        monkeypatch.setattr(handover, name, lambda *a, **k: None)
    monkeypatch.setattr(tasks, "close_open_tasks", lambda *a: closed.append(a))
    monkeypatch.setattr(clients, "on_deal_won", lambda lead_id: closed.append(lead_id))
    handover._mark_won({"id": "o", "lead_id": "d", "total": 1}, "TOF-ORD-2027-00001")
    assert len(writes) == expected and len(closed) == expected * 2
    if expected:
        assert writes[0]["stage"] == "closed_won" and writes[0]["paid_amount"] == 236000
