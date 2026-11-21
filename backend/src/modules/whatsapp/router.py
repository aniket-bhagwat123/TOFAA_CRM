from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import PlainTextResponse

from src.core.errors import ForbiddenError
from src.core.schema import ok
from src.modules.auth.dependencies import CurrentUserDep, require_roles
from src.modules.auth.schemas import Role
from src.modules.whatsapp import schemas, service

router = APIRouter(tags=["whatsapp"])
admin_only = Depends(require_roles(Role.ADMIN))


@router.get("/whatsapp/status")
def status(_: CurrentUserDep):
    return ok({"apiEnabled": service.api_enabled()})


@router.post("/leads/{lead_id}/whatsapp", status_code=201)
def send(lead_id: str, body: schemas.SendMessage, user: CurrentUserDep):
    return ok(service.send(user, lead_id, body), "Message logged.")


@router.get("/leads/{lead_id}/whatsapp")
def conversation(lead_id: str, user: CurrentUserDep):
    return ok(service.conversation(user, lead_id))


@router.get("/whatsapp/templates")
def templates(_: CurrentUserDep):
    return ok(service.list_templates())


@router.post("/whatsapp/templates", status_code=201, dependencies=[admin_only])
def create_template(body: schemas.TemplateCreate):
    return ok(service.create_template(body), "Template saved.")


@router.patch("/whatsapp/templates/{template_id}", dependencies=[admin_only])
def update_template(template_id: str, body: schemas.TemplateUpdate):
    return ok(service.update_template(template_id, body), "Template updated.")


@router.get("/whatsapp/usage", dependencies=[admin_only])
def usage(user: CurrentUserDep):
    return ok(service.usage(user))


# Public endpoints called by Meta (no bearer token; protected by verify token and payload signature).
@router.get("/whatsapp/webhook", include_in_schema=False)
def verify(request: Request):
    q = request.query_params
    return PlainTextResponse(service.verify_webhook(q.get("hub.mode"), q.get("hub.verify_token"), q.get("hub.challenge")))


@router.post("/whatsapp/webhook", include_in_schema=False)
async def receive(request: Request):
    raw = await request.body()
    if not service.valid_signature(raw, request.headers.get("x-hub-signature-256")):
        raise ForbiddenError("Bad signature.")
    service.handle_webhook(await request.json())
    return Response(status_code=200)
