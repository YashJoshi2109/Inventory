from functools import lru_cache
from pathlib import Path
from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve .env from the project root regardless of where the process is launched.
# backend/app/core/config.py → ../../.. = project root
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_ENV_FILE = _PROJECT_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",   # ignore VITE_* and other frontend env vars in the same file
    )

    # App
    APP_NAME: str = "SIER Lab Inventory"
    APP_VERSION: str = "1.0.0"
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"
    DEBUG: bool = False
    API_PREFIX: str = "/api/v1"

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    WORKERS: int = 4

    # Database (Supabase / PostgreSQL)
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "postgres"
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "changeme"
    # Set to true when using Supabase, Neon, or any cloud PostgreSQL
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

    # JWT
    SECRET_KEY: str = "CHANGE-THIS-IN-PRODUCTION-USE-256-BIT-RANDOM-KEY"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # CORS — extend with production URLs via CORS_ORIGINS env var
    # e.g. ["https://your-app.vercel.app","https://your-app-2.vercel.app"]
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:80",
    ]
    # If your frontend uses multiple dynamic hosts (e.g. Vercel preview deployments),
    # prefer a regex. Example: r"^https://.*\.vercel\.app$"
    CORS_ORIGIN_REGEX: str | None = r"^https://.*\.vercel\.app$"

    # File storage
    UPLOAD_DIR: str = "./uploads"
    BARCODE_DIR: str = "./uploads/barcodes"
    MAX_UPLOAD_SIZE_MB: int = 50

    # MQTT — domain events to external subscribers (analytics, IoT, ERP)
    MQTT_ENABLED: bool = False
    MQTT_BROKER_HOST: str = "localhost"
    MQTT_BROKER_PORT: int = 1883
    MQTT_TOPIC_PREFIX: str = "searlab/inventory"
    MQTT_CLIENT_ID: str = ""  # empty → auto: sear-inv-{hostname}-{pid}
    MQTT_USERNAME: str = ""
    MQTT_PASSWORD: str = ""
    MQTT_KEEPALIVE: int = 60
    # 0 = fire-and-forget, 1 = at-least-once (recommended), 2 = exactly-once
    MQTT_QOS: int = 1
    MQTT_RETAIN: bool = False
    # Throughput vs memory (HiveMQ / EMQX tuning)
    MQTT_MAX_INFLIGHT: int = 100
    MQTT_USE_TLS: bool = False
    MQTT_TLS_CA_PATH: str | None = None  # None = system trust store
    MQTT_TLS_CERT_PATH: str | None = None
    MQTT_TLS_KEY_PATH: str | None = None
    MQTT_TLS_INSECURE: bool = False  # dev only — skip cert verification

    # AI
    AI_ANOMALY_DETECTION_ENABLED: bool = True
    AI_FORECAST_ENABLED: bool = True
    OPENAI_API_KEY: str = ""          # Optional fallback for AI copilot chat
    OPENAI_MODEL: str = "gpt-4o-mini"

    # Gemini (primary)
    GEMINI_API_KEY: str = ""          # Required to enable Gemini copilot
    GEMINI_CHAT_MODEL: str = "gemini-flash-latest"

    # Alerts
    LOW_STOCK_CHECK_INTERVAL_SECONDS: int = 300
    ALERT_EMAIL_ENABLED: bool = False
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""

    # Resend (primary email notifications for alerts)
    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = ""
    # Enable alert notifications automatically when keys are configured.
    # Actual sending is still skipped if RESEND_API_KEY / RESEND_FROM_EMAIL are missing.
    RESEND_ENABLE_LOW_STOCK: bool = True
    RESEND_ENABLE_TRANSFER: bool = True
    ALERT_EMAIL_RECIPIENT_ROLES: list[str] = ["admin", "manager"]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
