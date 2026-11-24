import pytest

from src.core import share_links
from src.core.config import settings
from src.core.errors import NotFoundError


def test_codes_are_short_and_easy_to_read():
    codes = {share_links.new_code() for _ in range(200)}
    assert len(codes) == 200  # random enough not to repeat
    for c in codes:
        assert len(c) == 8 and c.isalnum() and not set(c) & set("0O1lI")


def test_links_use_the_crm_address_not_storage(monkeypatch):
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://crm.tofaaindia.com/")
    url = share_links.short_url("Ab3xK9qz")
    assert url == "https://crm.tofaaindia.com/s/Ab3xK9qz" and "supabase" not in url


@pytest.mark.parametrize("bad", ["", "../etc", "a" * 40, "ab-cd"])
def test_odd_codes_are_refused_without_a_lookup(bad):
    with pytest.raises(NotFoundError):
        share_links.resolve(bad)
