from fastapi import APIRouter, Depends, File, UploadFile
from starlette.concurrency import run_in_threadpool

from src.core.errors import AppError
from src.core.images import UPLOAD_MAX_BYTES
from src.core.schema import ok
from src.modules.auth.dependencies import CurrentUserDep, require_roles
from src.modules.auth.schemas import Role
from src.modules.users import service
from src.modules.users.schemas import UserCreate, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])

managers = Depends(require_roles(Role.ADMIN, Role.SALES_MANAGER))


async def _read(file: UploadFile) -> bytes:
    data = await file.read(UPLOAD_MAX_BYTES + 1)
    if len(data) > UPLOAD_MAX_BYTES:
        raise AppError("Image must be 2 MB or smaller.", status_code=413)
    return data


@router.get("", dependencies=[managers])
def list_users(actor: CurrentUserDep):
    return ok(service.list_users(actor))


@router.get("/assignable", dependencies=[managers])
def assignable(actor: CurrentUserDep):
    return ok(service.assignable_users(actor))


@router.post("", status_code=201, dependencies=[managers])
def create_user(body: UserCreate, actor: CurrentUserDep):
    user = service.create_user(actor, body)
    return ok(user.model_dump(by_alias=True, mode="json"), "User created.")


@router.patch("/{user_id}", dependencies=[Depends(require_roles(Role.ADMIN))])
def update_user(user_id: str, body: UserUpdate, actor: CurrentUserDep):
    user = service.update_user(actor, user_id, body)
    return ok(user.model_dump(by_alias=True, mode="json"), "User updated.")


# Profile photo. "me" is the signed-in user; admins (and a manager for their team) can set others.
@router.put("/{user_id}/avatar")
async def set_avatar(user_id: str, actor: CurrentUserDep, file: UploadFile = File(...)):
    target = actor.id if user_id == "me" else user_id
    data = await _read(file)
    return ok(await run_in_threadpool(service.set_avatar, actor, target, data), "Photo saved.")


@router.delete("/{user_id}/avatar")
def remove_avatar(user_id: str, actor: CurrentUserDep):
    service.remove_avatar(actor, actor.id if user_id == "me" else user_id)
    return ok(None, "Photo removed.")
