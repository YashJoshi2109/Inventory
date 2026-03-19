# SIER Lab Inventory Control System

A production-grade, AI-powered laboratory inventory control platform for SIER Lab.
Replaces spreadsheet-based operations with a robust, auditable, event-driven, API-first platform.

![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL+TimescaleDB-16-336791?logo=postgresql)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)

---

## Architecture Decisions

### Why Vite + React + TypeScript + Tailwind over Next.js 15?

| Concern | Vite + React | Next.js 15 |
|---|---|---|
| SSR requirement | None — fully authenticated SPA | Adds complexity without benefit |
| PWA / offline first | `vite-plugin-pwa` = best-in-class | Requires custom configuration |
| Build speed | Sub-second HMR | Slower RSC compilation |
| Bundle size | Smaller — no RSC runtime | Larger |
| Mobile scan UX | Direct DOM, no hydration delay | Hydration adds latency |
| Deployment | Static files behind Nginx | Requires Node.js server |

**Verdict:** For an inventory scanner PWA where all users are authenticated and there is zero SEO requirement, Vite gives faster development, smaller bundles, simpler PWA integration, and better mobile responsiveness.

### Why FastAPI over Flask?

- **Native async/await** — asyncpg keeps DB queries non-blocking under concurrent scan load
- **Pydantic v2 validation** built-in — no extra serialization code
- **Auto OpenAPI/Swagger docs** — instant API documentation
- **Dependency injection** — clean RBAC, DB sessions, background tasks
- **Background tasks + SSE** — needed for real-time alerts and future WebSocket scan streams
- **Type safety** — mypy/pyright catches bugs at dev time, not runtime
- **3–5× faster** than Flask under concurrent ASGI load (tested with wrk)

### Why PostgreSQL + TimescaleDB over InfluxDB?

- **One database** — relational + time-series in a single engine
- **Full SQL** — JOINs, CTEs, window functions across items AND events
- **TimescaleDB hypertables** give InfluxDB-class time-range performance (O(1) chunk pruning)
- **ACID transactions** across item mutations and event ledger in the same tx
- **pg_trgm** for fuzzy full-text search without Elasticsearch
- **Alembic migrations** — standard, version-controlled schema evolution
- **InfluxDB limitation** — no relational joins; you'd need a separate RDBMS anyway

---

## Repository Structure

```
.
├── backend/                          # FastAPI application
│   ├── app/
│   │   ├── api/v1/                   # Route handlers
│   │   │   ├── auth.py               # JWT auth + RBAC
│   │   │   ├── items.py              # Item CRUD + categories
│   │   │   ├── locations.py          # Areas + bins
│   │   │   ├── barcodes.py           # PNG/SVG/PDF label generation
│   │   │   ├── scans.py              # Stock-in/out/transfer/adjustment
│   │   │   ├── transactions.py       # Ledger + alerts
│   │   │   ├── dashboard.py          # KPI aggregations
│   │   │   ├── imports.py            # Excel/CSV pipeline
│   │   │   ├── ai.py                 # NLP search + forecasting
│   │   │   └── users.py              # User management
│   │   ├── core/
│   │   │   ├── config.py             # Pydantic Settings
│   │   │   ├── database.py           # Async SQLAlchemy engine
│   │   │   ├── security.py           # JWT + bcrypt
│   │   │   └── events.py             # Domain event bus (MQTT-ready)
│   │   ├── models/                   # SQLAlchemy ORM models
│   │   │   ├── user.py               # User, Role, UserRole
│   │   │   ├── item.py               # Item, Category, ItemBarcode
│   │   │   ├── location.py           # Area, Location, LocationBarcode
│   │   │   └── transaction.py        # InventoryEvent (hypertable), StockLevel,
│   │   │                             #   AuditLog (hypertable), Alert, ImportJob
│   │   ├── schemas/                  # Pydantic I/O schemas
│   │   ├── repositories/             # Data access layer (asyncpg-backed)
│   │   ├── services/
│   │   │   ├── inventory_service.py  # Stock mutations (single source of truth)
│   │   │   ├── barcode_service.py    # python-barcode + qrcode + reportlab
│   │   │   ├── scan_service.py       # Barcode resolution
│   │   │   └── import_service.py     # Excel/CSV migration pipeline
│   │   ├── ai/
│   │   │   ├── anomaly_detector.py   # Z-score (rule) + IsolationForest (ML)
│   │   │   ├── demand_forecaster.py  # SMA / Exp Smoothing / Linear Regression
│   │   │   └── nlp_search.py         # TF-IDF search (RAG-ready architecture)
│   │   └── main.py                   # FastAPI app + middleware
│   ├── migrations/                   # Alembic
│   │   └── versions/001_initial_schema.py  # TimescaleDB hypertables + seed roles
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend/                         # Vite + React + TypeScript + Tailwind PWA
│   ├── src/
│   │   ├── api/                      # Axios API clients
│   │   ├── components/
│   │   │   ├── layout/               # Layout, Sidebar, TopBar, MobileNav
│   │   │   ├── ui/                   # Button, Card, Input, Badge, Modal, ...
│   │   │   └── scanner/              # BarcodeScanner (@zxing/browser)
│   │   ├── hooks/                    # useScanner, useOffline, useDebounce
│   │   ├── offline/                  # IndexedDB (Dexie) + offline queue
│   │   ├── pages/                    # Dashboard, Inventory, Scan, Locations,
│   │   │                             #   Transactions, Alerts, Import, AiInsights
│   │   ├── store/                    # Zustand (auth state, persisted)
│   │   ├── types/                    # TypeScript type definitions
│   │   └── App.tsx                   # Router + QueryClient
│   ├── vite.config.ts                # vite-plugin-pwa (workbox, manifest)
│   ├── nginx.conf                    # SPA routing + API proxy
│   └── Dockerfile                    # Multi-stage: Vite build → Nginx
│
├── docker-compose.yml
├── .env.example
├── init.sql                          # TimescaleDB + pg_trgm extensions
└── README.md
```

---

## Database Schema

### TimescaleDB Hypertables

| Table | Partition Key | Retention Strategy |
|---|---|---|
| `inventory_events` | `occurred_at` (7-day chunks) | Keep all (immutable ledger) |
| `audit_logs` | `occurred_at` (30-day chunks) | Compress after 90 days |

### Barcode ID Strategy

```
Items:      {SKU}                       →  SIER-CHM-000001
            Primary barcode = Code128
            Optional QR = same value

Locations:  LOC:{LOCATION_CODE}         →  LOC:LABA-S01-B03
            Primary barcode = QR code
            Printed on bin labels
```

### Event Model (Immutable Ledger)

```
STOCK_IN  : item + to_location + qty     (positive delta)
STOCK_OUT : item + from_location + qty   (negative delta)
TRANSFER  : item + from + to + qty       (double-entry: debit src, credit dst)
ADJUSTMENT: item + location + delta      (cycle count correction)
IMPORT    : batch seeding from legacy data
```

---

## Scan Workflows (Mobile-First)

### Stock-In Flow
```
1. Select "Stock In"
2. Scan location QR code    → resolves to Location
3. Scan item barcode         → resolves to Item + shows current stock
4. Enter quantity (default 1)
5. Add reference / notes (optional)
6. Confirm → POST /scans/stock-in
```

### Stock-Out Flow
```
1. Select "Stock Out"
2. Scan location → resolves source location
3. Scan item → shows current stock, warns if LOW
4. Enter quantity + reason/borrower (optional)
5. Confirm → POST /scans/stock-out
   If negative stock: requires Manager override flag
```

### Transfer Flow
```
1. Select "Transfer"
2. Scan source location
3. Scan item
4. Scan destination location
5. Enter quantity
6. Confirm → POST /scans/transfer (double-entry update)
```

---

## PWA Offline Strategy

| Scenario | Behavior |
|---|---|
| Online | All API calls live; data cached in React Query |
| Network timeout (3s) | NetworkFirst cache serves stale data |
| Full offline | IndexedDB local cache for item/location lookups |
| Offline mutations | Queued in IndexedDB (Dexie); drained on reconnect |
| Service worker update | Auto-update via `registerType: "autoUpdate"` |

---

## AI Features

### Rule-Based (always available)
- **Z-score anomaly detection** — flags unusual withdrawal quantities inline
- **Rapid-fire detection** — flags >5 events within 10 minutes by same actor
- **SMA demand forecast** — simple moving average, immediate with <14 days data

### ML-Based (improves with data)
- **IsolationForest** — multivariate anomaly scoring (trained on >50 events)
- **Exponential smoothing** — optimal-alpha ES forecast (>30 days)
- **Linear regression forecast** — trend-aware, (>60 days data)

### NLP Search (TF-IDF, RAG-ready)
- Handles typos, synonyms (ethanol↔alcohol, eppendorf↔microcentrifuge tube)
- Bi-gram TF-IDF with 50k feature vocabulary
- **Phase 2 upgrade path**: swap `TFIDFSearchEngine` for `EmbeddingSearchEngine`
  using OpenAI `text-embedding-3-small` + pgvector — zero API change

---

## Quick Start

### Development

```bash
# Clone and setup
git clone <repo> && cd Inventory

# Copy environment
cp .env.example .env
# Edit .env with your values

# Start all services
docker compose up --build

# Frontend dev server (hot reload)
cd frontend && npm install && npm run dev

# Backend dev server
cd backend
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

### First Admin User

```bash
# After running migrations, create the first superuser
docker compose exec backend python -c "
import asyncio
from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.models.user import User

async def create_admin():
    async with AsyncSessionLocal() as s:
        admin = User(
            email='admin@sierlab.edu',
            username='admin',
            full_name='SIER Lab Admin',
            hashed_password=hash_password('ChangeMe123!'),
            is_superuser=True,
            is_active=True,
        )
        s.add(admin)
        await s.commit()
        print('Admin created: admin / ChangeMe123!')

asyncio.run(create_admin())
"
```

### Import Legacy Excel Data

```bash
# Via API
curl -X POST http://localhost:8000/api/v1/imports/excel \
  -H "Authorization: Bearer <token>" \
  -F "file=@Lab_Inventory_Barcode_System.xlsx"

# The importer reads:
#   Items_Master  → items + categories + locations + barcodes
#   Transactions  → inventory_events (historical ledger)
```

---

## MQTT Integration Points (Phase 2)

The system is MQTT-ready. To activate:

1. Set `MQTT_ENABLED=true` in `.env`
2. Uncomment the `mqtt` service in `docker-compose.yml`
3. The `EventBus` in `app/core/events.py` will publish to topics:
   - `sierlab/inventory/inventory.stock_in`
   - `sierlab/inventory/inventory.stock_out`
   - `sierlab/inventory/inventory.transfer`
   - `sierlab/inventory/alert.low_stock`
4. RFID readers publish to `sierlab/scan/rfid/{tag}` → backend subscribes and resolves via `ScanService`

---

## Security & Auditability

- **JWT RS256/HS256** with short-lived access tokens (60 min) + refresh tokens (30 days)
- **RBAC**: admin > manager > operator > viewer
- **Negative stock override**: requires Manager+ explicit flag + is recorded in event
- **Immutable ledger**: `inventory_events` rows are never updated/deleted; corrections create `ADJUSTMENT` events
- **Full audit trail**: `audit_logs` TimescaleDB hypertable captures every mutation with before/after snapshots
- **TimescaleDB compression**: audit logs compress at 90 days (up to 95% storage reduction)
- **Input sanitization**: all inputs go through Pydantic v2 strict validation
- **SQL injection protection**: SQLAlchemy ORM parameterized queries throughout

---

## Phased Roadmap

| Phase | Features | Status |
|---|---|---|
| 1 | Core inventory, barcode scan, PWA, Excel import, basic AI | ✅ Built |
| 2 | RFID reader integration via MQTT, real-time scan events | 🔜 Ready (MQTT hooks in place) |
| 3 | RAG knowledge base (SOPs, SDS sheets, equipment manuals) | 🔜 Architecture in place |
| 4 | Multi-site / multi-lab replication | 🔜 |
| 5 | Mobile native app (React Native, shared business logic) | 🔜 |

---

## Tech Stack

| Layer | Technology | Justification |
|---|---|---|
| Backend API | FastAPI + Uvicorn (ASGI) | Async, typed, fast, auto-docs |
| ORM | SQLAlchemy 2.0 async | Type-safe, supports asyncpg |
| Database | PostgreSQL 16 + TimescaleDB | Relational + time-series, ACID |
| Migrations | Alembic | Standard, battle-tested |
| Frontend | Vite + React 18 + TypeScript | Fastest PWA dev experience |
| Styling | Tailwind CSS v3 | Utility-first, mobile-first |
| State | Zustand + TanStack Query | Lightweight, cache-aware |
| Offline | Dexie (IndexedDB) + Workbox | Service worker + local queue |
| Barcode scan | @zxing/browser | Works offline, no native app |
| Barcode gen | python-barcode + qrcode | Code128 + QR, PDF labels |
| Auth | JWT (python-jose) + bcrypt | Stateless, RBAC-enabled |
| AI (rules) | SciPy + NumPy | No external API, instant |
| AI (ML) | scikit-learn | IsolationForest + regression |
| AI (search) | TF-IDF (sklearn) | Offline NLP, RAG-upgradeable |
| Containers | Docker Compose | Dev/prod parity |
| MQTT | paho-mqtt + Mosquitto | Phase 2 RFID integration |
