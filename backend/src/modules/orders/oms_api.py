"""The APIs the order management system (OMS) calls. Server to server: header X-API-Key = OMS_INBOUND_KEY.

OMS reads approved handovers and sends its stage back. It cannot create, edit or delete anything else, and it never
receives money, billing details or internal notes. The contract is in backend/OMS_ORDER_API.md.
"""
import hmac
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Security
from fastapi.security import APIKeyHeader
from pydantic import AwareDatetime

from src.core.config import settings
from src.core.errors import UnauthorizedError
from src.modules.orders import handover
from src.modules.orders.oms_schemas import (
    Envelope, ErrorResponse, Handover, HandoverPage, HandoverStatus, PaymentResult, PaymentUpdate, StatusResult, StatusUpdate,
)

log = logging.getLogger(__name__)
MIN_KEY_LENGTH = 32

oms_key = APIKeyHeader(name="X-API-Key", scheme_name="OMS API key", description="The OMS key (OMS_INBOUND_KEY).", auto_error=False)


def require_oms_key(x_api_key: Annotated[str | None, Security(oms_key)] = None) -> None:
    expected = settings.OMS_INBOUND_KEY
    if len(expected) < MIN_KEY_LENGTH:
        log.warning("OMS_INBOUND_KEY is not set (or under %s characters): OMS call refused.", MIN_KEY_LENGTH)
        raise UnauthorizedError("Invalid API key.")
    if not x_api_key or not hmac.compare_digest(x_api_key.encode(), expected.encode()):
        raise UnauthorizedError("Invalid API key.")


def _errors(**more: str) -> dict:
    found = {401: "Missing or wrong X-API-Key", 422: "Bad request", 503: "The CRM database is not ready: retry later"}
    found |= {int(code[1:]): text for code, text in more.items()}
    return {code: {"model": ErrorResponse, "description": text} for code, text in sorted(found.items())}


router = APIRouter(prefix="/handovers", tags=["OMS handovers"], dependencies=[Depends(require_oms_key)])


@router.get("", response_model=Envelope[HandoverPage], summary="List handovers", responses=_errors())
def list_handovers(
    status: Annotated[HandoverStatus | None, Query(description="Leave out when polling, so cancellations are not missed")] = None,
    updated_since: Annotated[AwareDatetime | None, Query(description="Changed at or after this time, e.g. 2027-01-01T00:00:00Z")] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
):
    """Approved (and later cancelled) handovers, oldest change first. Poll with `updated_since` set to the latest
    `updated_at` seen; a handover may then be repeated, which `handover_number` + `version` make harmless."""
    return {"data": handover.list_published(status, updated_since, page, limit), "message": "OK"}


@router.get("/{handover_number}", response_model=Envelope[Handover], summary="Read one handover",
            responses=_errors(e404="No approved handover has that number"))
def read_handover(handover_number: str):
    """The last approved version. While an edit waits for approval, the earlier version is returned."""
    return {"data": handover.public([handover.find_published(handover_number)])[0], "message": "OK"}


@router.post("/{handover_number}/status", response_model=Envelope[StatusResult], summary="Send the OMS stage",
             responses=_errors(e404="No approved handover has that number",
                               e409="Another oms_order_id is linked, or the order changed meanwhile: send again"))
def send_status(handover_number: str, body: StatusUpdate):
    """Records the OMS stage and shipments. Repeats and older messages (by `changed_at`) change nothing, the status
    never moves backwards, and skipped stages are filled in."""
    result, message = handover.apply_oms_update(handover_number, body.model_dump())
    return {"data": result, "message": message}


@router.post("/{handover_number}/payment", response_model=Envelope[PaymentResult], summary="Send the payment status",
             responses=_errors(e404="No approved handover has that number", e409="The order changed meanwhile: send again"))
def send_payment(handover_number: str, body: PaymentUpdate):
    """Whether the payment is pending or successful. The CRM only shows it. It may be sent before any stage: no OMS order
    is needed yet. Repeats and older messages (by `changed_at`) change nothing."""
    result, message = handover.apply_oms_payment(handover_number, body.payment_status, body.changed_at)
    return {"data": result, "message": message}
