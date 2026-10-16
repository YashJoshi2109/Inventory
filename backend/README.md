# SEAR Lab Inventory — Backend

FastAPI (async, Python 3.11) service backing the SEAR Lab Inventory app: inventory
CRUD + audit trail, auth (JWT / WebAuthn / email OTP), SmartScan vision + AI
copilot, and the live energy hub.

## Layered architecture

Requests flow through clear layers, each depending only on the one below it:

```
app/api/v1/*     HTTP routes — validation, auth deps, response shaping
      │
app/services/*   Business logic — scan resolution, barcodes, alerts
      │
app/repositories/*  Data access — async CRUD over SQLAlchemy models
      │
app/models/*     SQLAlchemy ORM (PostgreSQL)
```

Supporting packages:

| Package | Responsibility |
|---------|----------------|
| `app/core/` | Config, database engine/session, security (JWT + bcrypt), rate limiting, OTP, notifications, domain event bus, sandbox scoping |
| `app/ai/`   | Copilot, NLP search, demand forecaster, LLM/RAG tooling |
| `app/schemas/` | Pydantic request/response models |
| `app/middleware/` | Cross-cutting request middleware |
| `app/main.py` | App factory, router registration, startup/lifespan background tasks (energy aggregation, migrations) |

**Transaction convention:** repositories `flush` but do not `commit`. The caller
owns the commit boundary, so one request can compose several writes atomically.
See `app/repositories/base.py`.

## Sandbox / owner scoping

The app supports a per-user **sandbox** so a demo user sees isolated data without
touching real inventory. Requests carry an `X-Sandbox-Mode` header; helpers in
`app/core/sandbox.py` resolve an effective `owner_id`:

- `None` → shared/background context (system tasks)
- `0` → real lab data
- `>0` → that user's sandbox

Inventory, location, energy, and scan queries filter by this owner id (see the
`owns()` / `sandbox_owner_id(request, current_user)` helpers). When adding a new
owner-scoped resource, route it through the same helper so sandbox isolation holds.

## Run locally

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env          # fill in DATABASE_URL, SECRET_KEY, GEMINI_API_KEY, ...
alembic upgrade head             # apply migrations
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Interactive API docs: <http://localhost:8000/docs>.

## Migrations

Alembic revisions live in `migrations/versions/`; intent is encoded in the
filename (e.g. `012_backfill_item_barcodes.py`). Create + apply:

```bash
alembic revision --autogenerate -m "add X"
alembic upgrade head
```

Migrations also run automatically on container startup (see `entrypoint.sh`).

## Tests

```bash
cd backend && pytest
```

## Deployment

Containerised via `Dockerfile` and deployed to Cloud Run (`cloudbuild.yaml`,
`cloudbuild-sandbox.yaml`). Requires ≥512 MB (1 GB recommended — the vision image
pipeline is memory-sensitive). See the root `README.md` for env-var reference.
