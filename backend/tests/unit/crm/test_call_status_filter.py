from src.modules.leads.service import _call_outcome_filter


class FakeQuery:
    """Records the filter calls the lead lists make."""

    def __init__(self):
        self.calls = []

    def __getattr__(self, name):
        def record(*args):
            self.calls.append((name, *args))
            return self
        return record


def run(value):
    return _call_outcome_filter(FakeQuery(), value).calls


def test_one_or_more_outcomes():
    assert run("interested") == [("in_", "last_call_outcome", ["interested"])]
    assert run("not_reachable,call_back_later") == [("in_", "last_call_outcome", ["not_reachable", "call_back_later"])]


def test_not_called_yet():
    assert run("none") == [("is_", "last_call_outcome", "null")]
    assert run("none,interested") == [("or_", "last_call_outcome.is.null,last_call_outcome.in.(interested)")]


def test_unknown_values_match_nothing_instead_of_everything():
    assert run("bogus") == [("in_", "last_call_outcome", ["-"])]
