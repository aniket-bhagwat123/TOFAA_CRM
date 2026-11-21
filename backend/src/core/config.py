from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ENVIRONMENT: str = "development"
    PROJECT_NAME: str = "TOFAA CRM"
    API_V1_STR: str = "/api/v1"
    BACKEND_CORS_ORIGINS: str = "http://localhost:3000"
    FRONTEND_URL: str = "http://localhost:3000"

    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = ""

    SUPABASE_URL: str = ""
    SUPABASE_ANON_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_JWT_SECRET: str = ""
    SUPABASE_JWT_ALGORITHM: str = "HS256"
    SUPABASE_JWT_AUDIENCE: str = "authenticated"

    # A user holds one active session. It counts as abandoned after this much inactivity.
    # Off by default: executives use phone and desktop. Idle logout is enforced by the client.
    SINGLE_SESSION: bool = False
    SESSION_IDLE_MINUTES: int = 30

    # WhatsApp Business Cloud API (Meta). Empty token = click-to-chat fallback only.
    WHATSAPP_TOKEN: str = ""
    WHATSAPP_PHONE_NUMBER_ID: str = ""
    WHATSAPP_VERIFY_TOKEN: str = ""
    WHATSAPP_APP_SECRET: str = ""
    WHATSAPP_COST_PER_CONVERSATION: float = 0.8  # INR estimate for the admin usage view

    # Phase 2
    COMPANY_NAME: str = "Tofaa"  # printed on quotations
    COMPANY_ADDRESS: str = ""
    ERP_WEBHOOK_SECRET: str = ""  # the ERP signs payment callbacks with this; empty = reject them all
    PAYMENT_FALLBACK_ENABLED: bool = True  # Finance "Confirm payment" button; turn off once the ERP link is live

    # Client management
    CLIENT_TIER_A: int = 1_000_000  # rupees won in the last 12 months for tier A
    CLIENT_TIER_B: int = 200_000  # and for tier B; below is C
    CLIENT_DORMANT_DAYS: int = 180  # no order and no open project for this long = dormant

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.lower() == "production"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.BACKEND_CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
