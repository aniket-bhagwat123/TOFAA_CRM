from decimal import Decimal

from fastapi import APIRouter, Response
from pydantic import Field

from src.core.schema import CamelModel, ok
from src.modules.agreements import schemas, service
from src.modules.auth.dependencies import CurrentUserDep
from src.modules.leads import service as leads

router = APIRouter(prefix="/leads", tags=["agreement"])


class PaymentRequestIn(CamelModel):
    invoice_number: str = Field(min_length=1, max_length=60)
    amount: Decimal | None = Field(default=None, gt=0)


@router.get("/{lead_id}/agreement")
def get_state(lead_id: str, user: CurrentUserDep):
    leads.get_lead_row(user, lead_id)
    return ok(service.state(lead_id))


@router.put("/{lead_id}/agreement/details")
def save_details(lead_id: str, body: schemas.AgreementDetails, user: CurrentUserDep):
    """Save the prepared agreement: packages, scope, commercials, terms, signees, remarks."""
    return ok(service.save_details(user, lead_id, body), "Agreement saved.")


@router.get("/{lead_id}/agreement/pdf")
def agreement_pdf(lead_id: str, user: CurrentUserDep):
    data, number = service.make_pdf(user, lead_id)
    return Response(data, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{number}.pdf"'})


@router.post("/{lead_id}/agreement/sent")
def sent(lead_id: str, user: CurrentUserDep):
    return ok(service.mark_sent(user, lead_id), "Marked as sent.")


@router.post("/{lead_id}/payment-request", status_code=201)
def payment_request(lead_id: str, body: PaymentRequestIn, user: CurrentUserDep):
    return ok(service.request_payment(user, lead_id, body.invoice_number, body.amount), "Payment requested. Finance has been told.")
