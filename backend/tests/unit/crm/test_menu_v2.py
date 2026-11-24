"""Dashboard, Reports, Orders, Approvals (agreement terms) and Settings."""
from datetime import date

import pytest
from pydantic import ValidationError

from src.modules.agreements import schemas as ag_schemas
from src.modules.agreements import service as agreements
from src.modules.app_config.router import SettingsIn
from src.modules.auth.schemas import Profile, Role
from src.modules.orders import service as orders
from src.modules.reports import service as reports

EXEC = Profile(id="e1", role=Role.SALES_EXECUTIVE)
MGR = Profile(id="m1", role=Role.SALES_MANAGER)
CUSTOM = [*ag_schemas.DEFAULT_TERMS, {"title": "Penalty", "body": "2% per week of delay."}]


def test_standard_terms_need_no_approval():
    assert agreements.terms_status_for(EXEC, ag_schemas.DEFAULT_TERMS, {}) == "standard"


def test_custom_terms_from_an_executive_wait_for_a_manager():
    assert agreements.terms_status_for(EXEC, CUSTOM, {}) == "pending"
    assert agreements.terms_status_for(MGR, CUSTOM, {}) == "approved"  # managers approve their own


def test_already_approved_terms_stay_approved_until_changed():
    before = {"terms_status": "approved", "details": {"terms": CUSTOM}}
    assert agreements.terms_status_for(EXEC, CUSTOM, before) == "approved"
    changed = [*CUSTOM[:-1], {"title": "Penalty", "body": "5% per week."}]
    assert agreements.terms_status_for(EXEC, changed, before) == "pending"


def test_order_steps():
    assert orders.STEPS == ["production", "quality_check", "dispatched", "delivered"]


def test_settings_validation():
    ok = SettingsIn.model_validate({"retry": {"maxAttempts": 3, "gapDays": 2}, "lostReasons": ["A", "A", " B "], "nurtureDays": 45})
    assert ok.lost_reasons == ["A", "B"] and ok.retry.max_attempts == 3
    for bad in ({"retry": {"maxAttempts": 0, "gapDays": 1}}, {"lostReasons": []}, {"stuckDays": 0}, {"sources": [""]}):
        with pytest.raises(ValidationError):
            SettingsIn.model_validate(bad)


def lead(i, stage, *, created="2026-11-05T10:00:00+05:30", closed=None, source="Referral", reason=None, quote=None, paid=None, pipeline="new_business"):
    return {"id": f"l{i}", "owner_id": "e1", "stage": stage, "pipeline": pipeline, "source": source, "lost_reason": reason, "created_at": created,
            "closed_at": closed, "value_band": None, "estimate_amount": None, "quote_amount": quote, "paid_amount": paid}


def test_report_numbers():
    leads = [
        lead(1, "quotation_sent", quote=100000),
        lead(2, "new_lead", source="Website"),
        lead(3, "closed_won", closed="2026-11-20T10:00:00+05:30", paid=50000),
        lead(4, "closed_lost", closed="2026-11-21T10:00:00+05:30", reason="No budget"),
        lead(5, "closed_won", created="2026-09-01T10:00:00+05:30", closed="2026-09-10T10:00:00+05:30", paid=1),  # outside the range
    ]
    moves = [{"lead_id": "l1", "meta": {"to": "quotation_sent"}}, {"lead_id": "l3", "meta": {"to": "closed_won"}}]
    r = reports.build(leads, moves, {"quotation_sent": 70, "new_lead": 10}, date(2026, 11, 1), date(2026, 11, 30))
    assert r["forecast"] == {"open": 2, "unweighted": 100000.0, "weighted": 70000.0}
    assert r["conversion"] == {"created": 4, "won": 1, "lost": 1, "wonValue": 50000.0, "winRate": 50.0}
    funnel = {f["stage"]: f["count"] for f in r["funnel"]}
    assert funnel["new_lead"] == 4 and funnel["quotation_sent"] == 1 and funnel["closed_won"] == 1
    assert r["lostReasons"] == [{"reason": "No budget", "count": 1}]
    assert {s["source"]: (s["leads"], s["won"]) for s in r["sources"]} == {"Referral": (3, 1), "Website": (1, 0)}


def test_report_range_is_checked():
    with pytest.raises(Exception):
        reports._range("2026-12-01", "2026-11-01")
    assert reports._range("2026-11-01", "2026-11-24") == (date(2026, 11, 1), date(2026, 11, 24))


def test_executives_never_see_the_activity_feed():
    from src.core.errors import ForbiddenError
    from src.modules.activity_feed import service as feed

    with pytest.raises(ForbiddenError):
        feed.feed(Profile(id="e1", role=Role.SALES_EXECUTIVE), before=None, kind=None, owner_id=None, lead_id=None, company_id=None)


def test_a_kam_sees_only_what_they_own_and_never_activity():
    from src.core.access import visible_owner_ids
    from src.core.errors import ForbiddenError
    from src.modules.activity_feed import service as feed

    kam = Profile(id="k1", role=Role.KAM)
    assert visible_owner_ids(kam) == ["k1"]  # their accounts, the accounts' projects and follow-ups
    with pytest.raises(ForbiddenError):
        feed.feed(kam, before=None, kind=None, owner_id=None, lead_id=None, company_id=None)
    with pytest.raises(ForbiddenError):
        visible_owner_ids(Profile(id="f1", role=Role.FINANCE))  # finance still has no lead access


def test_managers_see_all_data_like_the_superadmin():
    from src.core.access import can_access_owner, visible_owner_ids

    mgr = Profile(id="m1", role=Role.SALES_MANAGER)
    assert visible_owner_ids(mgr) is None  # everyone's leads, follow-ups, quotations, clients, reports
    assert can_access_owner(mgr, "anyone-else")
    assert visible_owner_ids(Profile(id="e1", role=Role.SALES_EXECUTIVE)) == ["e1"]  # executives still only their own


def test_every_role_has_its_own_dashboard(monkeypatch):
    from src.core import cache
    from src.modules.dashboard import service as dash

    monkeypatch.setattr(cache, "memo", lambda name, uid, params, ttl, loader: loader())
    seen = {}
    for name in ("_executive", "_manager", "_admin", "_finance", "_kam"):
        monkeypatch.setattr(dash, name, lambda user, name=name: seen.setdefault(user.role.value, name) and {"built": name})
    for role in (Role.SALES_EXECUTIVE, Role.SALES_MANAGER, Role.ADMIN, Role.FINANCE, Role.KAM):
        out = dash.dashboard(Profile(id="x", role=role))
        assert out["role"] == role.value
    assert seen == {"sales_executive": "_executive", "sales_manager": "_manager", "admin": "_admin", "finance": "_finance", "kam": "_kam"}
