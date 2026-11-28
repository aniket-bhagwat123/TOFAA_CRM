"""Order management: stages, money and what a KAM or admin may do. OMS rules are in test_oms_handover.py."""
import pytest
from fastapi.testclient import TestClient

from src.core.config import settings
from src.core.errors import AppError, ConflictError, ForbiddenError
from src.main import app
from src.modules.auth.schemas import Profile, Role
from src.modules.orders import flow, rules, schemas

ADMIN = Profile.model_construct(id="a", role=Role.ADMIN)
KAM = Profile.model_construct(id="k", role=Role.KAM)
ITEM = {"name": "Hamper", "quantity": 100, "unit_price": 1250.5, "details": [], "photos": []}


def test_money_per_line_and_in_total():
    sums = rules.money([ITEM, {**ITEM, "name": "Card", "quantity": 3, "unit_price": 33.33}], 500, 18)
    assert [x["amount"] for x in sums["lines"]] == [125050.0, 99.99]
    assert sums["lines"][0]["gst_amount"] == 22509.0 and sums["lines"][0]["line_total"] == 147559.0
    assert sums["subtotal"] == 125149.99 and sums["gst_amount"] == 22617.0 and sums["total"] == 148266.99
    assert rules.money([], 0, 18)["total"] == 0


def test_priced_items_get_their_own_rows_and_add_up():
    details = [{"name": "Flask", "unit_price": 600, "quantity_per_kit": 2}, {"name": "Book", "unit_price": 250}]
    line = rules.money([{**ITEM, "quantity": 250, "unit_price": 1450, "details": details}], 0, 18)["lines"][0]
    flask, book = line["details"]
    assert flask["quantity"] == 500 and flask["amount"] == 300000.0 and book["amount"] == 62500.0
    assert flask["amount"] + book["amount"] == line["amount"]
    assert round(flask["gst_amount"] + book["gst_amount"], 2) == line["gst_amount"]
    assert round(flask["line_total"] + book["line_total"], 2) == line["line_total"]
    # one price for all, a part priced, or a rate changed since: no separate amounts
    for other, rate in (([{"name": "Flask"}], 1450), ([details[0], {"name": "Book"}], 1450), (details, 2000)):
        got = rules.money([{**ITEM, "quantity": 250, "unit_price": rate, "details": other}], 0, 18)["lines"][0]["details"]
        assert all("amount" not in d for d in got)


def test_item_prices_are_all_or_none_and_set_the_requirement_rate():
    from src.modules.quotations.schemas import PackageIn

    made = PackageIn.model_validate({"name": "H", "unitPrice": 1, "quantity": 10,
                                     "items": [{"name": "a", "unitPrice": 600}, {"name": "b", "unitPrice": 250}]})
    assert made.unit_price == 850
    with pytest.raises(ValueError, match="every item"):
        PackageIn.model_validate({"name": "H", "unitPrice": 1, "quantity": 10, "items": [{"name": "a", "unitPrice": 600}, {"name": "b"}]})
    assert PackageIn.model_validate({"name": "H", "unitPrice": 5, "quantity": 1, "items": [{"name": "a"}]}).unit_price == 5


def test_editing_a_deal_keeps_item_prices_until_the_rate_changes():
    before = [{**ITEM, "details": [{"name": "Flask", "unit_price": 1250.5}]}]
    typed = [{**ITEM, "details": [{"name": "Flask", "description": "steel"}]}]
    assert flow.keep_item_prices(before, typed)[0]["details"][0] == {"name": "Flask", "unit_price": 1250.5, "description": "steel"}
    assert "unit_price" not in flow.keep_item_prices(before, [{**typed[0], "unit_price": 9}])[0]["details"][0]


def test_a_crm_user_can_take_an_order_through_every_stage():
    for current, nxt in zip(rules.FLOW, rules.FLOW[1:]):
        assert nxt in rules.crm_moves(current)
    assert rules.crm_moves("cancelled") == ["new"]
    assert "cancelled" not in rules.crm_moves("delivered") and "dispatched" in rules.crm_moves("delivered")  # correct a mistake


def test_release_needs_items_date_and_address():
    assert rules.missing_for_release({}) == ["at least one item", "a delivery date", "a delivery address"]
    assert rules.missing_for_release({"items": [ITEM], "expected_delivery": "2027-01-01", "delivery_address": "Pune"}) == []
    patch = rules.status_patch({"status": "new"}, "ready", "now")
    assert patch["released_at"] == "now" and patch["held_from"] is None
    assert rules.status_patch({"status": "production", "released_at": "x"}, "on_hold", "now")["held_from"] == "production"


@pytest.fixture
def order(monkeypatch):
    row = {"id": "o", "order_number": "ORD-00001", "status": "new", "items": [ITEM], "transportation": 0, "gst_rate": 18,
           "company_id": "c", "owner_id": "k"}
    moved = []
    monkeypatch.setattr(flow, "upgraded", lambda: True)
    monkeypatch.setattr(flow, "_handover_live", lambda: False)  # before the handover migration
    monkeypatch.setattr(flow, "load", lambda user, i: row)
    monkeypatch.setattr(flow, "snapshot", lambda o: o)
    monkeypatch.setattr(flow, "detail", lambda user, i: {"id": i})
    monkeypatch.setattr(flow, "move", lambda o, status, **kw: moved.append(status))
    return row, moved


def test_status_rules_for_a_kam(order):
    row, moved = order
    with pytest.raises(AppError, match="delivery date"):
        flow.set_status(KAM, "o", "ready", None)
    with pytest.raises(AppError, match="note"):
        flow.set_status(KAM, "o", "cancelled", " ")
    flow.set_status(KAM, "o", "production", None)
    row["status"] = "cancelled"
    with pytest.raises(ConflictError):
        flow.set_status(KAM, "o", "dispatched", None)
    assert moved == ["production"]


def test_items_lock_once_in_fulfilment_and_only_unstarted_orders_are_deleted(order):
    row, _ = order
    row["status"] = "production"
    with pytest.raises(ConflictError, match="locked"):
        flow.update(KAM, "o", {"items": [{**ITEM, "quantity": 5}]})
    with pytest.raises(ConflictError, match="Cancel this deal first"):
        flow.delete(ADMIN, "o")
    row["status"] = "dispatched"
    with pytest.raises(ConflictError, match="delivery details"):
        flow.update(KAM, "o", {"delivery_address": "New"})


def test_a_kam_sees_only_their_orders():
    assert flow.can_see(KAM, {"owner_id": "k"}, [])
    assert flow.can_see(KAM, {"company_id": "c"}, ["c"])
    assert flow.can_see(KAM, {"lead": {"owner_id": "k"}}, [])
    assert not flow.can_see(KAM, {"owner_id": "x", "company_id": "d"}, ["c"])
    with pytest.raises(ForbiddenError):
        flow.can_see(Profile.model_construct(id="f", role=Role.FINANCE), {"owner_id": "f"}, [])


def test_no_gst_is_invented_for_a_deal_without_an_agreement(monkeypatch):
    rows = {"agreements": [], "quotations": [{"id": "q", "status": "sent", "version": 1}],
            "quotation_packages": [{"name": "Hamper", "quantity": 1, "unit_price": 100, "items": [], "photo_paths": []}]}

    class Query:
        def __init__(self, name):
            self.name = name

        def __getattr__(self, _):
            return lambda *a, **k: self

        def execute(self):
            return type("R", (), {"data": rows.get(self.name, [])})()

    monkeypatch.setattr(flow, "get_service_client", lambda: type("Db", (), {"table": lambda self, n: Query(n)})())
    agreed = flow.agreed_for("lead")
    assert agreed["from"] == "quotation" and rules.money(agreed["items"], 0, agreed["gst_rate"])["total"] == 100


def test_bad_input_is_refused():
    for bad in ({"companyId": "c", "items": []}, {"companyId": "c", "items": [{"name": "x", "quantity": 0, "unitPrice": 1}]},
                {"companyId": "c", "items": [{"name": "x", "quantity": 1, "unitPrice": 1}], "gstRate": 7}):
        with pytest.raises(ValueError):
            schemas.OrderCreate.model_validate(bad)
    assert schemas.OrderUpdate.model_validate({"deliveryAddress": "  "}).delivery_address is None
