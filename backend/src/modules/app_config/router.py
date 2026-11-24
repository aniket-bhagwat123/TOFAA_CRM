"""Settings screen: retry rules, Nurture days, stuck days, lost reasons, lead sources and the ERP connection status."""
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import Field, StringConstraints, field_validator

from src.core import app_settings
from src.core.audit import write_audit
from src.core.config import settings
from src.core.schema import CamelModel, ok
from src.core.supabase import get_service_client
from src.modules.auth.dependencies import CurrentUserDep, require_roles
from src.modules.auth.schemas import Profile, Role

router = APIRouter(prefix="/app-settings", tags=["settings"])
Item = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class Retry(CamelModel):
    max_attempts: int = Field(ge=1, le=20)
    gap_days: int = Field(ge=0, le=30)


class SettingsIn(CamelModel):
    retry: Retry | None = None
    nurture_days: int | None = Field(default=None, ge=1, le=365)
    stuck_days: int | None = Field(default=None, ge=1, le=180)
    lost_reasons: list[Item] | None = Field(default=None, min_length=1, max_length=30)
    sources: list[Item] | None = Field(default=None, min_length=1, max_length=30)

    @field_validator("lost_reasons", "sources")
    @classmethod
    def _unique(cls, v):
        return list(dict.fromkeys(v)) if v is not None else v


def erp_status() -> dict:
    """Whether the ERP can post payments, and when it last did."""
    last = None
    try:
        rows = (
            get_service_client().table("payment_requests").select("confirmed_at,invoice_number").eq("source", "erp")
            .not_.is_("confirmed_at", "null").order("confirmed_at", desc=True).limit(1).execute().data
        )
        last = rows[0] if rows else None
    except Exception:  # noqa: BLE001
        pass
    return {
        "configured": bool(settings.ERP_WEBHOOK_SECRET),
        "fallbackEnabled": settings.PAYMENT_FALLBACK_ENABLED,
        "lastConfirmationAt": (last or {}).get("confirmed_at"),
        "lastInvoice": (last or {}).get("invoice_number"),
    }


@router.get("")
def get_settings(_: CurrentUserDep):
    return ok({**app_settings.all_settings(), "erp": erp_status()})


@router.put("")
def save_settings(body: SettingsIn, user: Annotated[Profile, Depends(require_roles(Role.ADMIN))]):
    values = {
        k: v for k, v in {
            "retry": body.retry.model_dump(by_alias=True) if body.retry else None,
            "nurtureDays": body.nurture_days, "stuckDays": body.stuck_days,
            "lostReasons": body.lost_reasons, "sources": body.sources,
        }.items() if v is not None
    }
    saved = app_settings.save(values, user.id)
    write_audit(user.id, "update", "app_settings", None, {"keys": sorted(values)})
    return ok({**saved, "erp": erp_status()}, "Settings saved.")
