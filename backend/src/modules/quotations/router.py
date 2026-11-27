from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from starlette.concurrency import run_in_threadpool

from src.core.access import require_lead_role
from src.core.pagination import PageDep
from src.core.schema import ok
from src.modules.auth.dependencies import CurrentUserDep, require_roles
from src.modules.auth.schemas import Role
from src.modules.leads import service as leads
from src.modules.quotations import schemas, service

router = APIRouter(tags=["quotations"])
admin_only = Depends(require_roles(Role.ADMIN))


@router.get("/quotation-templates")
def templates(user: CurrentUserDep):
    require_lead_role(user)
    return ok(service.list_templates())


@router.post("/quotation-templates", status_code=201, dependencies=[admin_only])
def create_template(body: schemas.TemplateIn):
    return ok(service.save_template(body), "Template saved.")


@router.patch("/quotation-templates/{template_id}", dependencies=[admin_only])
def update_template(template_id: str, body: schemas.TemplateIn):
    return ok(service.save_template(body, template_id), "Template saved.")


@router.post("/leads/{lead_id}/quotations", status_code=201)
def create_quotation(lead_id: str, body: schemas.QuotationCreate, user: CurrentUserDep):
    q = service.create_quotation(user, lead_id, body)
    msg = "Sent for approval: the discount is above your limit." if q["needs_approval"] else "Quotation ready."
    return ok(q, msg)


@router.post("/leads/{lead_id}/quotation-photos", status_code=201)
async def upload_photo(lead_id: str, user: CurrentUserDep, file: Annotated[UploadFile, File()]):
    """One mockup photo for a requirement package. The returned path goes into the package's `photos`."""
    data = await file.read(service.MAX_PHOTO_BYTES + 1)
    return ok(await run_in_threadpool(lambda: service.upload_photo(user, lead_id, data, file.filename)), "Photo uploaded.")


@router.get("/leads/{lead_id}/quotations")
def list_quotations(lead_id: str, user: CurrentUserDep):
    leads.get_lead_row(user, lead_id)
    return ok(service.list_quotations(lead_id))


@router.get("/quotations")
def all_quotations(user: CurrentUserDep, page: PageDep, status: str | None = None, owner_id: Annotated[str | None, Query(alias="ownerId")] = None):
    require_lead_role(user)
    return ok(service.list_all(user, page, status=status, owner_id=owner_id))


@router.get("/quotations/{quotation_id}/pdf")
def pdf(quotation_id: str, user: CurrentUserDep):
    data, number = service.make_pdf(user, quotation_id)
    return Response(data, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{number}.pdf"'})


@router.post("/quotations/{quotation_id}/send")
def send(quotation_id: str, body: schemas.SendQuotation, user: CurrentUserDep):
    return ok(service.send(user, quotation_id, body), "Quotation sent.")


@router.get("/approvals")
def approvals(user: CurrentUserDep):
    return ok(service.pending_approvals(user))


@router.post("/quotations/{quotation_id}/decision")
def decision(quotation_id: str, body: schemas.Decision, user: CurrentUserDep):
    return ok(service.decide(user, quotation_id, body), "Decision saved.")


@router.delete("/quotations/{quotation_id}")
def delete_quotation(quotation_id: str, user: CurrentUserDep):
    return ok(service.delete_quotation(user, quotation_id), "Quotation deleted.")
