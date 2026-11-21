from datetime import date
from decimal import Decimal as D

import pytest
from pydantic import ValidationError

from src.modules.clients import schemas, service
from src.modules.leads.stages import CLIENT_STAGES, POSITION, moves_forward, stage_for_pipeline

TODAY = date(2026, 11, 20)


def test_tiers_follow_the_last_12_months_of_revenue(monkeypatch):
    monkeypatch.setattr(service.settings, "CLIENT_TIER_A", 1_000_000)
    monkeypatch.setattr(service.settings, "CLIENT_TIER_B", 200_000)
    assert service.tier_for(D("1000000")) == "A"
    assert service.tier_for(D("999999.99")) == "B"
    assert service.tier_for(D("200000")) == "B"
    assert service.tier_for(D("0")) == "C"


def test_dormant_needs_both_a_quiet_period_and_nothing_in_progress(monkeypatch):
    monkeypatch.setattr(service.settings, "CLIENT_DORMANT_DAYS", 180)
    old = date(2026, 1, 1)
    assert service.status_for(old, old, 0, TODAY) == "dormant"
    assert service.status_for(old, old, 1, TODAY) == "active"  # an open project keeps a client active
    assert service.status_for(date(2026, 10, 1), old, 0, TODAY) == "active"
    assert service.status_for(None, date(2026, 11, 1), 0, TODAY) == "active"  # a brand-new client is not dormant


def test_fixed_yearly_occasions_roll_over_to_next_year():
    anniversary = {"month": 3, "day": 15}
    assert service.next_occurrence(anniversary, {}, TODAY) == date(2027, 3, 15)
    assert service.next_occurrence({"month": 11, "day": 20}, {}, TODAY) == TODAY  # today still counts
    assert service.next_occurrence({"month": 2, "day": 29}, {}, TODAY) == date(2027, 2, 28)  # no 29 Feb in 2027


def test_festivals_come_from_the_calendar_and_skip_past_dates():
    cal = {"diwali": [date(2026, 11, 8), date(2027, 10, 29)]}
    assert service.next_occurrence({"from_calendar": True, "name": "Diwali"}, cal, TODAY) == date(2027, 10, 29)
    assert service.next_occurrence({"from_calendar": True, "name": "Holi"}, cal, TODAY) is None  # no date yet: no guess


def test_the_reminder_window():
    diwali = date(2027, 10, 29)
    assert not service.reminder_due(diwali, 45, date(2027, 9, 13))  # 46 days before: too early
    assert service.reminder_due(diwali, 45, date(2027, 9, 14))  # exactly 45 days before
    assert service.reminder_due(diwali, 45, diwali)
    assert not service.reminder_due(diwali, 45, date(2027, 10, 30))  # it has passed
    assert not service.reminder_due(None, 45, TODAY)


def test_occasion_names_are_read_back_from_reminder_and_campaign_titles():
    assert service.occasion_from_title("Diwali on 29 Oct: ask about gifting") == "Diwali"
    assert service.occasion_from_title("New Year: ask about gifting") == "New Year"
    assert service.occasion_from_title(None) is None


def test_projects_use_their_own_stages_for_the_same_actions():
    assert stage_for_pipeline("client", "meeting_scheduled") == "project_meeting"
    assert stage_for_pipeline("client", "quotation_sent") == "project_proposal"
    assert stage_for_pipeline("client", "connected") is None  # a call does not move a project
    assert stage_for_pipeline("client", "requirement_received") is None
    assert stage_for_pipeline("client", "project_negotiation") == "project_negotiation"
    assert stage_for_pipeline("new_business", "project_negotiation") is None  # leads have no Negotiation
    assert stage_for_pipeline(None, "connected") == "connected"


def test_project_stages_only_move_forward():
    assert [POSITION[s] for s in CLIENT_STAGES[:4]] == [0, 1, 2, 3]
    assert moves_forward("project_follow_up", "project_proposal")
    assert not moves_forward("project_negotiation", "project_proposal")
    assert not moves_forward("closed_won", "project_negotiation")


def test_inputs():
    assert schemas.ClientCreate.model_validate({"companyName": "Acme", "contactName": "Asha", "phone": "+91 98765 43210"}).phone == "9876543210"
    assert schemas.ClientCreate.model_validate({"companyId": "c1"}).company_id == "c1"  # converting an existing company
    with pytest.raises(ValidationError):
        schemas.ClientCreate.model_validate({"companyName": "Acme", "contactName": "Asha"})  # no way to reach them
    with pytest.raises(ValidationError):
        schemas.OccasionCreate.model_validate({"name": "Anniversary"})  # a fixed occasion needs its date
    assert schemas.OccasionCreate.model_validate({"name": "Diwali", "fromCalendar": True}).lead_days == 45
    with pytest.raises(ValidationError):
        schemas.ProjectCreate.model_validate({"title": "Diwali", "budget": -1})
    with pytest.raises(ValidationError):
        schemas.FollowUpComplete.model_validate({"outcome": "maybe"})
