from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ENVIRONMENT: str = "development"
    PROJECT_NAME: str = "TOFAA CRM"
    API_V1_STR: str = "/api/v1"
    BACKEND_CORS_ORIGINS: str = "http://localhost:3000"  # comma separated exact origins, e.g. https://crm.tofaa.in
    # Optional pattern for origins that change, like Vercel previews: https://tofaa-crm(-[a-z0-9-]+)?\.vercel\.app
    BACKEND_CORS_ORIGIN_REGEX: str = ""
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

    # Self sign-up (POST /auth/signup). Admin can never be chosen; roles above Sales Executive always need approval.
    SIGNUP_ENABLED: bool = True
    SIGNUP_REQUIRES_APPROVAL: bool = True  # new accounts stay inactive until an admin activates them in Users
    SIGNUP_ALLOWED_DOMAINS: str = ""  # comma separated, e.g. "tofaa.in,tofaa.com"; empty = any email domain
    SIGNUP_ALLOWED_ROLES: str = "sales_executive,sales_manager,finance,kam"  # roles a person may pick (admin is never allowed)

    # WhatsApp Business Cloud API (Meta). Empty token = click-to-chat fallback only.
    WHATSAPP_TOKEN: str = ""
    WHATSAPP_PHONE_NUMBER_ID: str = ""
    WHATSAPP_VERIFY_TOKEN: str = ""
    WHATSAPP_APP_SECRET: str = ""
    WHATSAPP_COST_PER_CONVERSATION: float = 0.8  # INR estimate for the admin usage view
    # The quotation message with a "View quotation" button. Inside the 24-hour window no template is needed. Outside it
    # Meta needs an approved template: 4 body values (contact name, quotation number, company, total) and one
    # "Visit website" button with the dynamic URL https://<FRONTEND_URL>/s/{{1}}.
    WHATSAPP_QUOTATION_TEMPLATE: str = ""
    WHATSAPP_TEMPLATE_LANGUAGE: str = "en"

    # Phase 2
    COMPANY_NAME: str = "Tofaa India"  # printed on quotations
    # Quotation letterhead footer. Write "\n" in COMPANY_ADDRESS for a line break; empty = the letterhead address.
    COMPANY_ADDRESS: str = ""
    COMPANY_PHONE: str = "+91 9511870124"
    COMPANY_EMAIL: str = "indiatofaa@gmail.com"
    COMPANY_WEBSITE: str = "www.tofaaindia.com"
    COMPANY_GSTIN: str = "27AIEPC1532D2ZY"
    COMPANY_POWERED_BY: str = "SIDDHI GROUP OF COMPANIES"
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
