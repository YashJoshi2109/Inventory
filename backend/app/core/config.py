from functools import lru_cache
from pathlib import Path
from typing import Literal
import json

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve .env from the project root regardless of where the process is launched.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_ENV_FILE = _PROJECT_ROOT / ".env"


def _parse_str_list(raw: str, default: list[str]) -> list[str]:
    """Parse a string that is either a JSON array or comma-separated list."""
    s = raw.strip()
    if not s:
        return default
    if s.startswith("["):
        try:
            result = json.loads(s)
            if isinstance(result, list):
                return [str(x).strip() for x in result if str(x).strip()]
        except json.JSONDecodeError:
            pass
    return [x.strip() for x in s.split(",") if x.strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",          # ignore VITE_* and other frontend env vars
        populate_by_name=True,   # allow access by field name when aliases are used
    )

    # ── App ──────────────────────────────────────────────────────────────────
    APP_NAME: str = "SIER Lab Inventory"
    APP_VERSION: str = "1.0.0"
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"
    DEBUG: bool = False
    API_PREFIX: str = "/api/v1"

    # ── Server ───────────────────────────────────────────────────────────────
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    WORKERS: int = 4

    # ── Database ─────────────────────────────────────────────────────────────
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "postgres"
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "changeme"
    DATABASE_SSL: bool = True

    @property
    def DATABASE_URL(self) -> str:
        base = (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )
        return f"{base}?ssl=require" if self.DATABASE_SSL else base

    @property
    def DATABASE_URL_SYNC(self) -> str:
        """Used by Alembic migrations (psycopg2)."""
        base = (
            f"postgresql+psycopg2://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )
        return f"{base}?sslmode=require" if self.DATABASE_SSL else base

    # ── JWT ───────────────────────────────────────────────────────────────────
    SECRET_KEY: str = "CHANGE-THIS-IN-PRODUCTION-USE-256-BIT-RANDOM-KEY"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # ── CORS ──────────────────────────────────────────────────────────────────
    # Stored as a raw str so pydantic-settings never tries json.loads() on it.
    # Accepts JSON array OR comma-separated OR single URL — all work.
    _cors_origins_raw: str = Field(
        default="http://localhost:3000,http://localhost:5173,http://localhost:80",
        alias="CORS_ORIGINS",
    )
    CORS_ORIGIN_REGEX: str | None = r"^https://.*\.vercel\.app$"

    @property
    def CORS_ORIGINS(self) -> list[str]:
        return _parse_str_list(
            self._cors_origins_raw,
            ["http://localhost:3000", "http://localhost:5173"],
        )

    # ── File storage ─────────────────────────────────────────────────────────
    UPLOAD_DIR: str = "./uploads"
    BARCODE_DIR: str = "./uploads/barcodes"
    MAX_UPLOAD_SIZE_MB: int = 50

    # ── MQTT ─────────────────────────────────────────────────────────────────
    MQTT_ENABLED: bool = False
    MQTT_BROKER_HOST: str = "localhost"
    MQTT_BROKER_PORT: int = 1883
    MQTT_TOPIC_PREFIX: str = "searlab/inventory"
    MQTT_CLIENT_ID: str = ""
    MQTT_USERNAME: str = ""
    MQTT_PASSWORD: str = ""
    MQTT_KEEPALIVE: int = 60
    MQTT_QOS: int = 1
    MQTT_RETAIN: bool = False
    MQTT_MAX_INFLIGHT: int = 100
    MQTT_USE_TLS: bool = False
    MQTT_TLS_CA_PATH: str | None = None
    MQTT_TLS_CERT_PATH: str | None = None
    MQTT_TLS_KEY_PATH: str | None = None
    MQTT_TLS_INSECURE: bool = False

    # ── AI ────────────────────────────────────────────────────────────────────
    AI_ANOMALY_DETECTION_ENABLED: bool = True
    AI_FORECAST_ENABLED: bool = True
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"
    GEMINI_API_KEY: str = ""
    GEMINI_CHAT_MODEL: str = "gemini-flash-latest"

    # ── Alerts / Email ────────────────────────────────────────────────────────
    LOW_STOCK_CHECK_INTERVAL_SECONDS: int = 300
    ALERT_EMAIL_ENABLED: bool = False
    SMTP_ENABLED: bool = True
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_EMAIL: str = ""
    SMTP_STARTTLS: bool = True
    SMTP_SSL: bool = False

    BREVO_API_KEY: str = ""
    BREVO_SENDER_EMAIL: str = ""
    BREVO_SENDER_NAME: str = "SEAR Lab Inventory"
    BREVO_FREE_TIER_DAILY_LIMIT: int = 300

    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = ""
    RESEND_TEST_ALLOWED_TO_EMAIL: str = ""
    RESEND_ENABLE_LOW_STOCK: bool = True
    RESEND_ENABLE_TRANSFER: bool = True

    # Stored as raw str — see CORS_ORIGINS above for the reason.
    _alert_roles_raw: str = Field(
        default="admin,manager",
        alias="ALERT_EMAIL_RECIPIENT_ROLES",
    )

    @property
    def ALERT_EMAIL_RECIPIENT_ROLES(self) -> list[str]:
        return _parse_str_list(self._alert_roles_raw, ["admin", "manager"])

    # ── WebAuthn / Passkeys ───────────────────────────────────────────────────
    # RP_ID: bare domain only — no scheme, no port
    #   localhost dev  → "localhost"
    #   Vercel prod    → "inventory-brown-beta.vercel.app"
    WEBAUTHN_RP_ID: str = "localhost"
    WEBAUTHN_RP_NAME: str = "SEAR Lab Inventory"
    WEBAUTHN_ORIGIN: str = "http://localhost:5173"

    # Stored as raw str — pydantic-settings would crash trying json.loads("")
    # Accepts: "https://a.com,https://b.com"  OR  '["https://a.com"]'  OR single URL
    _webauthn_origins_raw: str = Field(
        default="http://localhost:5173,http://localhost:3000,https://inventory-brown-beta.vercel.app",
        alias="WEBAUTHN_ORIGINS",
    )
    

@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
