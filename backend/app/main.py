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
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s v%s [%s]", settings.APP_NAME, settings.APP_VERSION, settings.ENVIRONMENT)

    # Ensure upload directories exist
    Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
    Path(settings.BARCODE_DIR).mkdir(parents=True, exist_ok=True)

    # MQTT connection (Phase 2 — no-op in Phase 1)
    if settings.MQTT_ENABLED:
        try:
            import paho.mqtt.client as mqtt
            from app.core.events import event_bus
            client = mqtt.Client()
            client.connect(settings.MQTT_BROKER_HOST, settings.MQTT_BROKER_PORT, 60)
            client.loop_start()
            event_bus.connect_mqtt(client)
            logger.info("MQTT connected to %s:%s", settings.MQTT_BROKER_HOST, settings.MQTT_BROKER_PORT)
        except Exception as e:
            logger.warning("MQTT connection failed (non-fatal): %s", e)

    yield

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
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
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


@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "ok", "version": settings.APP_VERSION, "env": settings.ENVIRONMENT}


# ── Static files (barcode images) ─────────────────────────────────────────────
uploads_dir = Path(settings.UPLOAD_DIR)
if uploads_dir.exists():
    app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")
