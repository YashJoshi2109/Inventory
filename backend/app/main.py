"""
SIER Lab Inventory — FastAPI Application Entry Point

Why FastAPI over Flask for this project:
  ✓ Native async/await — non-blocking DB queries with asyncpg
  ✓ Pydantic v2 validation built-in — zero extra serialization code
  ✓ Auto-generated OpenAPI/Swagger docs
  ✓ Dependency injection for auth, DB sessions, RBAC
  ✓ Background tasks, WebSocket, SSE support — needed for real-time alerts
  ✓ Type-safe with mypy/pyright — catches bugs at dev time
  ✓ 3–5x faster than Flask under concurrent load (ASGI vs WSGI)

Why PostgreSQL + TimescaleDB over InfluxDB:
  ✓ Single database: relational data + time-series in one place
  ✓ Full SQL — JOINs, CTEs, window functions across relational + time-series
  ✓ TimescaleDB hypertables give InfluxDB-class time-range query performance
  ✓ ACID transactions across item mutations and event logs
  ✓ pg_trgm for fast full-text search without a separate search engine
  ✓ mature ecosystem, Alembic migrations, standard tooling
"""
import logging
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from app.api.router import api_router
from app.core.config import settings
from app.core.events import event_bus
from app.core.rate_limit import RateLimitMiddleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s v%s [%s]", settings.APP_NAME, settings.APP_VERSION, settings.ENVIRONMENT)

    # Ensure upload directories exist
    Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
    Path(settings.BARCODE_DIR).mkdir(parents=True, exist_ok=True)

    # Pre-warm the database connection pool so the first real user request
    # doesn't pay the SSL handshake + TCP connection cost (critical on cold starts).
    try:
        from app.core.database import engine
        from sqlalchemy import text as _sql_text
        async with engine.connect() as _conn:
            await _conn.execute(_sql_text("SELECT 1"))
        logger.info("Database connection pool pre-warmed")
    except Exception as _db_err:
        logger.warning("Database pool pre-warm failed (app will retry on first request): %s", _db_err)

    if settings.MQTT_ENABLED:
        try:
            from app.core.mqtt_client import build_mqtt_client

            mqtt_client = build_mqtt_client()
            event_bus.connect_mqtt(mqtt_client)
        except Exception as e:
            logger.warning("MQTT startup failed (app continues without broker): %s", e)

    # Notifications: email + in-app alert creation for low stock & transfers
    try:
        from app.core.notifications import (
            low_stock_monitor_loop,
            register_notification_handlers,
        )

        register_notification_handlers()
        notification_task = asyncio.create_task(low_stock_monitor_loop())
    except Exception as e:
        notification_task = None
        logger.warning("Notification subsystem disabled: %s", e)

    yield

    if settings.MQTT_ENABLED:
        event_bus.disconnect_mqtt()

    if notification_task:
        notification_task.cancel()

    logger.info("Shutting down %s", settings.APP_NAME)


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Production-grade AI-powered laboratory inventory control system for SIER Lab",
    docs_url="/docs" if settings.ENVIRONMENT != "production" else None,
    redoc_url="/redoc" if settings.ENVIRONMENT != "production" else None,
    lifespan=lifespan,
)

# ── Middleware ────────────────────────────────────────────────────────────────
app.add_middleware(RateLimitMiddleware)   # streaming-safe IP rate limiter
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request ID middleware ─────────────────────────────────────────────────────
@app.middleware("http")
async def add_request_id(request: Request, call_next):
    import uuid
    request_id = str(uuid.uuid4())[:8]
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


# ── Global exception handler ──────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception [%s]: %s", getattr(request.state, "request_id", "?"), exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error"},
    )


# ── Routes ────────────────────────────────────────────────────────────────────
app.include_router(api_router, prefix=settings.API_PREFIX)


@app.get("/", tags=["root"])
async def root():
    """Root URL — visiting the bare Render hostname in a browser no longer returns 404."""
    payload: dict[str, str | dict[str, str]] = {
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "environment": settings.ENVIRONMENT,
        "health": "/health",
        "api_prefix": settings.API_PREFIX,
        "login": f"{settings.API_PREFIX}/auth/login",
    }
    if settings.ENVIRONMENT != "production":
        payload["docs"] = "/docs"
        payload["redoc"] = "/redoc"
    else:
        payload["note"] = "OpenAPI docs are disabled in production; use /health and API routes under api_prefix."
    return payload


@app.get("/ping", tags=["health"], include_in_schema=False)
async def ping():
    """Ultra-lightweight keep-alive endpoint — no DB, no logic, instant reply."""
    return {"pong": True}


@app.get("/health", tags=["health"])
async def health_check():
    body: dict[str, str | bool | dict[str, bool | str]] = {
        "status": "ok",
        "version": settings.APP_VERSION,
        "env": settings.ENVIRONMENT,
    }
    if settings.MQTT_ENABLED:
        body["mqtt"] = {
            "enabled": True,
            "connected": event_bus.mqtt_connected,
            "prefix": settings.MQTT_TOPIC_PREFIX,
        }
    return body


# ── Static files (barcode images) ─────────────────────────────────────────────
uploads_dir = Path(settings.UPLOAD_DIR)
if uploads_dir.exists():
    app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")
