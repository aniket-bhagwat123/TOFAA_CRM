from pathlib import Path

import pytest

from src.modules.imports.schemas import ImportRow
from src.modules.imports.service import _normalise, parse_file

SAMPLES = Path(__file__).resolve().parents[4] / "frontend" / "public" / "samples"


@pytest.mark.parametrize("name", ["tofaa-leads-sample.csv", "tofaa-leads-sample.xlsx", "tofaa-leads-sample.xls"])
def test_every_sample_we_offer_can_be_imported(name):
    out = parse_file(name, (SAMPLES / name).read_bytes())
    assert out["total"] == 4 and "Company" in out["headers"]
    for r in out["rows"]:
        row = ImportRow(company_name=r["Company"], contact_name=r["Contact name"], phone=r["Phone"], email=r["Email"], value_band=r["Rough value"])
        assert _normalise(row)[1] == [], f"{name}: {r}"


def test_the_pdf_guide_ships_but_is_not_importable():
    assert (SAMPLES / "tofaa-leads-sample.pdf").stat().st_size > 1000
    with pytest.raises(Exception):
        parse_file("tofaa-leads-sample.pdf", b"%PDF")
