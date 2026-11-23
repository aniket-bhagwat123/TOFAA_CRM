import pytest
from pydantic import ValidationError

from src.core.errors import AppError
from src.modules.leads.stages import POSITION, PREREQUISITES, STAGES, moves_forward
from src.modules.samples import schemas, service


def test_sampling_sits_between_quotation_sent_and_agreement():
    assert STAGES.index("quotation_sent") + 1 == STAGES.index("sampling") == STAGES.index("agreement_payment") - 1
    assert POSITION["quotation_sent"] < POSITION["sampling"] < POSITION["agreement_payment"]
    assert moves_forward("quotation_sent", "sampling") and not moves_forward("agreement_payment", "sampling")
    assert PREREQUISITES["sampling"][0] == "sample_sends"  # moving there by hand needs the samples sent


def test_item_validation():
    ok = schemas.SamplesSave.model_validate({"items": [
        {"packageName": "CEO kit", "itemName": " Diary ", "description": "Leather", "files": [{"path": "l1/a.jpg", "name": "a.jpg"}]},
        {"itemName": "Pen"},
    ]})
    assert ok.items[0].item_name == "Diary" and ok.items[1].files == []
    for bad in ({"items": [{"itemName": "  "}]}, {"items": [{"itemName": "x", "files": [{"path": "", "name": "a"}]}]}):
        with pytest.raises(ValidationError):
            schemas.SamplesSave.model_validate(bad)


def test_files_must_belong_to_the_lead():
    good = schemas.SampleItemIn(item_name="Pen", files=[schemas.SampleFileIn(path="lead-1/a.png", name="a.png")])
    service.check_paths("lead-1", [good])
    for path in ("lead-2/a.png", "lead-1/../lead-2/a.png"):
        with pytest.raises(AppError):
            service.check_paths("lead-1", [schemas.SampleItemIn(item_name="Pen", files=[schemas.SampleFileIn(path=path, name="a.png")])])


def test_messages_list_each_item_with_its_links():
    links = [("CEO kit · Diary", [("front.jpg", "https://x/1"), ("spec.pdf", "https://x/2")]), ("Pen", [("pen.png", "https://x/3")])]
    text = service.message_text("Vikram", "Apex", links, "Two finishes shown.")
    assert "*CEO kit · Diary*" in text and "front.jpg: https://x/1" in text and "pen.png: https://x/3" in text and "Two finishes shown." in text
    html = service.message_html("Vikram <b>", "Apex & Co", links, None)
    assert "Vikram &lt;b&gt;" in html and "Apex &amp; Co" in html and 'href="https://x/2"' in html
