from src.modules.leads.service import _search_words


def test_search_is_split_into_words():
    assert _search_words("  Vanguard   Logistics 1 ") == ["Vanguard", "Logistics", "1"]


def test_filter_syntax_characters_are_dropped():
    assert _search_words("acme,(x)*%") == ["acme", "x"]
    assert _search_words(r"back\slash") == ["back", "slash"]
    assert _search_words(" , ") == []
