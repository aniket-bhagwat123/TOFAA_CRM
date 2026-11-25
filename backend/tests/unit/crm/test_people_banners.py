"""People (recipients + groups) and Dashboard banners: rules, validation, access and conflicts."""
from datetime import date
from io import BytesIO

import pytest
from PIL import Image
from pydantic import ValidationError

from src.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from src.modules.auth.schemas import Profile, Role
from src.modules.banners import service as banners
from src.modules.people import io as people_io
from src.modules.people import rules, schemas
from src.modules.people import service as people

ADMIN = Profile(id="a1", role=Role.ADMIN, full_name="Admin")
KAM = Profile(id="k1", role=Role.KAM, full_name="Kam")
FINANCE = Profile(id="f1", role=Role.FINANCE, full_name="Fin")
TODAY = date(2026, 11, 25)


def png(w: int, h: int) -> bytes:
    out = BytesIO()
    Image.new("RGB", (w, h), (20, 80, 160)).save(out, "PNG")
    return out.getvalue()


# --- banners ----------------------------------------------------------------------------------------------------------

def test_banner_live_window():
    assert banners.is_live({"is_active": True}, TODAY)
    assert not banners.is_live({"is_active": False}, TODAY)
    assert not banners.is_live({"is_active": True, "starts_on": "2026-12-01"}, TODAY)
    assert not banners.is_live({"is_active": True, "ends_on": "2026-11-24"}, TODAY)
    assert banners.is_live({"is_active": True, "starts_on": "2026-11-25", "ends_on": "2026-11-25"}, TODAY)


def test_banner_audience():
    assert banners.audience_allows("ALL", Role.KAM) and banners.audience_allows("ALL", Role.ADMIN)
    assert banners.audience_allows("KAM", Role.KAM) and not banners.audience_allows("KAM", Role.ADMIN)
    assert banners.audience_allows("ADMIN", Role.ADMIN) and not banners.audience_allows("ADMIN", Role.KAM)


def test_banner_picture_shape_size_and_type():
    assert banners.check_picture(png(2000, 180)) == ("image/png", "png")
    assert banners.check_picture(png(1000, 91))  # within 2%
    with pytest.raises(AppError, match="1000 x 90 shape"):
        banners.check_picture(png(1000, 200))
    with pytest.raises(AppError, match="at least 500"):
        banners.check_picture(png(400, 36))
    with pytest.raises(AppError, match="PNG, JPEG or WebP"):
        banners.check_picture(b"GIF89a....")
    with pytest.raises(AppError, match="Choose a banner"):
        banners.check_picture(b"")


def test_banners_are_only_for_kam_and_admin():
    assert banners.live(FINANCE) == []
    with pytest.raises(ForbiddenError):
        banners.manage_list(FINANCE)


def test_banner_settings_dates_in_order():
    from src.modules.banners.router import BannerSettings
    with pytest.raises(ValidationError):
        BannerSettings(starts_on=date(2026, 12, 2), ends_on=date(2026, 12, 1))


# --- people rules -----------------------------------------------------------------------------------------------------

def test_next_occasion_is_the_sooner_and_handles_29_february():
    o = rules.next_occasion({"date_of_birth": "1990-12-10", "anniversary_date": "2015-11-30"}, TODAY)
    assert o == {"kind": "ANNIVERSARY", "label": "Anniversary", "date": "2026-11-30", "days_away": 5}
    assert rules.next_date("2000-02-29", date(2027, 1, 1)) == date(2027, 2, 28)
    assert rules.next_date("1990-11-25", TODAY) == TODAY  # today counts
    assert rules.next_occasion({}, TODAY) is None


def test_completeness_by_section():
    row = {"name": "Asha", "mobile_number": "+919876543210", "city": "Pune", "recipient_type": "INTERNAL", "date_of_birth": "1990-01-01"}
    c = rules.completeness(row, links=0, addresses=1, has_preferences=False)
    assert c["percent"] == 70 and not c["needs_attention"]  # basic 30 + occasions 20 + address 20
    bare = rules.completeness({"name": "X", "recipient_type": "EXTERNAL"}, links=0, addresses=0, has_preferences=False)
    assert bare["needs_attention"] and "company" in bare["sections"][0]["missing"]


def test_diff_lists_only_real_changes():
    assert rules.diff({"name": "A", "city": None}, {"name": "A", "city": ""}) == []
    assert rules.diff({"name": "A"}, {"name": "B"}) == [("name", "A", "B")]


# --- validation -------------------------------------------------------------------------------------------------------

def test_create_rules():
    ok = schemas.RecipientCreate(company_id="c1", name="Asha", email="  ")
    assert ok.email is None and ok.recipient_type == "INTERNAL"
    with pytest.raises(ValidationError):
        schemas.RecipientCreate(company_id="c1", name="Asha", date_of_birth=date(2999, 1, 1))
    with pytest.raises(ValidationError):
        schemas.RecipientCreate(company_id="c1", name="Asha", budget=-1)
    with pytest.raises(ValidationError):
        schemas.RecipientCreate(company_id="c1", name="Asha", surprise="x")  # unknown fields are refused


def test_update_needs_a_change_and_no_empty_required_fields():
    with pytest.raises(ValidationError):
        schemas.RecipientUpdate(version=1)
    with pytest.raises(ValidationError):
        schemas.RecipientUpdate(version=1, name=None)
    assert schemas.RecipientUpdate(version=2, city="Pune").city == "Pune"


def test_mobile_is_stored_one_way():
    assert people._mobile("98765 43210") == ("+919876543210", "9876543210")
    assert people._mobile("+44 7700 900123")[0] == "+447700900123"
    with pytest.raises(AppError):
        people._mobile("12")


def test_import_maps_headers_and_reads_dates():
    m = people_io.auto_map(["Full Name", "Phone", "DOB", "Pin Code", "Group Name"])
    assert m == {"name": "Full Name", "mobile_number": "Phone", "date_of_birth": "DOB", "postal_code": "Pin Code", "group": "Group Name"}
    assert people_io.parse_date("31/01/1990") == "1990-01-31"
    assert people_io.parse_date("1990-01-31 00:00:00") == "1990-01-31"
    with pytest.raises(ValueError):
        people_io.parse_date("next friday")
    body, group, problem = people_io.build({"Name": "Asha", "Mobile": "98765 43210", "Group": "VIP"}, {"name": "Name", "mobile_number": "Mobile", "group": "Group"}, "c1")
    assert problem is None and body.name == "Asha" and group == "VIP"
    assert people_io.build({"Name": "Asha"}, {"name": "Name", "mobile_number": "Mobile"}, "c1")[2] == "Mobile number is missing"


# --- access and conflicts ---------------------------------------------------------------------------------------------

def test_people_is_only_for_kam_and_admin():
    with pytest.raises(ForbiddenError):
        people.company_scope(FINANCE)


def test_a_kam_never_reaches_another_accounts_person(monkeypatch):
    monkeypatch.setattr(people, "company_scope", lambda u: ["mine"])
    monkeypatch.setattr(people, "_db", lambda fn: [{"id": "p1", "company_id": "someone-elses", "deleted_at": None}])
    with pytest.raises(NotFoundError):
        people.person_row(KAM, "p1")
    with pytest.raises(NotFoundError):
        people.client_account(KAM, "someone-elses")


def test_saving_an_old_copy_is_refused_with_the_latest(monkeypatch):
    monkeypatch.setattr(people, "person_row", lambda u, i, **k: {"id": "p1", "company_id": "c1", "version": 3, "name": "Asha"})
    monkeypatch.setattr(people, "_enrich", lambda rows: rows)
    with pytest.raises(ConflictError) as e:
        people.update(ADMIN, "p1", schemas.RecipientUpdate(version=2, city="Pune"))
    assert e.value.data["reason"] == "VERSION_CONFLICT" and e.value.data["current"]["version"] == 3
