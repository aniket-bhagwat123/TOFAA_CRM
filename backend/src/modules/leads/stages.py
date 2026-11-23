"""Fixed pipeline: 8 columns, where the last one holds both Won and Lost. No custom workflows in v1."""

STAGES = [
    "new_lead",
    "connected",
    "meeting_scheduled",
    "requirement_received",
    "quotation_sent",
    "sampling",
    "agreement_payment",
    "closed_won",
    "closed_lost",
]
# Client projects (repeat business from existing clients) run on a shorter pipeline that ends in the same Won / Lost.
CLIENT_STAGES = ["project_follow_up", "project_meeting", "project_proposal", "project_negotiation", "closed_won", "closed_lost"]
STAGES_FOR = {"new_business": STAGES, "client": CLIENT_STAGES}
ALL_STAGES = list(dict.fromkeys([*STAGES, *CLIENT_STAGES]))

# Stage names never repeat across pipelines (except the shared closed ones), so one position table serves both.
POSITION = {**{s: i for i, s in enumerate(STAGES)}, **{s: i for i, s in enumerate(CLIENT_STAGES) if s not in ("closed_won", "closed_lost")}}
CLOSED = {"closed_won", "closed_lost"}

# Inputs a manual move into a stage needs (besides the next follow-up date).
# (Phase 2: the quotation total comes from the quotation itself, so it is not typed here any more.)
REQUIRED_INPUTS: dict[str, list[str]] = {
    "requirement_received": ["occasion", "quantity", "budget", "deliveryDate"],
}

# Typed amounts and counts: must be numbers greater than zero.
NUMERIC_INPUTS = {"quantity", "budget"}

SOURCES = ["Referral", "Website", "Instagram", "LinkedIn", "Cold call", "Exhibition", "WhatsApp", "Existing client", "Other"]
LOST_REASONS = ["Price too high", "Chose competitor", "No budget", "No response", "Not a fit", "Postponed", "Invalid contact", "Other"]
VALUE_BANDS = ["under_1l", "1_5l", "5_20l", "20l_plus"]


def lost_from(timeline: list[dict]) -> str | None:
    """The stage a lost lead was in when it was lost: the latest stage change into closed_lost (newest first)."""
    for a in timeline:
        meta = a.get("meta") or {}
        if a.get("kind") == "stage_change" and meta.get("to") == "closed_lost" and meta.get("from") not in (None, "closed_lost", "closed_won"):
            return meta["from"]
    return None


def stage_label(stage: str) -> str:
    return stage.replace("project_", "").replace("_", " ").capitalize()


def is_closed(stage: str) -> bool:
    return stage in CLOSED


def moves_forward(current: str, target: str) -> bool:
    """Auto-advance only ever moves a lead forward, and never touches a closed lead."""
    return not is_closed(current) and not is_closed(target) and POSITION[target] > POSITION[current]


# Moving forward into these stages needs the paperwork they stand for (stage -> table, column, expected value or None for "filled in",
# the field name shown to the user, and the message). Moving back, or reopening, never needs it.
PREREQUISITES: dict[str, tuple[str, str, str | None, str, str]] = {
    "requirement_received": ("moms", "id", None, "mom", "Add the meeting minutes to move here."),
    "quotation_sent": ("quotations", "status", "sent", "quotation", "Send a quotation to move here."),
    "sampling": ("sample_sends", "id", None, "samples", "Send the samples to the client to move here."),
    "agreement_payment": ("agreements", "prepared_at", None, "agreement", "Prepare the agreement to move here."),
}
PREREQUISITES.update({
    "project_meeting": ("meetings", "status", "scheduled", "meeting", "Create a meeting (date, time, type) to move here."),
    "project_proposal": ("quotations", "status", "sent", "quotation", "Send a proposal (quotation) to move here."),
})

# The same actions move a project along its own pipeline: a meeting means Meeting, a sent quotation means Proposal.
CLIENT_EQUIVALENT = {"meeting_scheduled": "project_meeting", "quotation_sent": "project_proposal"}


def stage_for_pipeline(pipeline: str | None, target: str) -> str | None:
    """The stage an action leads to in this deal's pipeline, or None when that action has no stage there."""
    if (pipeline or "new_business") == "client":
        if target in CLIENT_STAGES:
            return target
        return CLIENT_EQUIVALENT.get(target)
    return target if target in STAGES else None
