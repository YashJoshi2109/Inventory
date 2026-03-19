# SEAR Lab — AI-Powered Inventory Control System

A production-grade, AI-powered laboratory inventory control platform for the **SEAR Lab at Woolf Hall, UTA**.
Replaces spreadsheet-based operations with a robust, auditable, event-driven, API-first platform featuring barcode-driven scan workflows, real-time alerts, and intelligent search.

![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript)
![PostgreSQL](https://img.shields.io/badge/Supabase+PostgreSQL-17-336791?logo=postgresql)
![Vercel](https://img.shields.io/badge/Vercel-Frontend-000?logo=vercel)
![Render](https://img.shields.io/badge/Render-Backend-46E3B7?logo=render)

**Live Deployment:**
- Frontend: Vercel (auto-deploys from `main`)
- Backend: Render (`https://sierlab-inventory-backend.onrender.com`)
- Database: Supabase (PostgreSQL 17 with connection pooler)

---

## Features

### Core Inventory Management
- **10 real SKUs** seeded from SEAR Lab's actual Excel inventory (Beakers, Test Tubes, Pipette Tips, Petri Dishes, Distilled Water, Centrifuge Tubes, Nitrile Gloves, Lab Coat, pH Buffer, Alcohol 70%)
- **CRUD operations** — create, read, update, deactivate items with full category support (Glassware, Consumables, Chemicals, PPE)
- **10 rack locations** (A1–D2) under Woolf Hall SEAR Lab area with auto-generated QR barcodes
- **Stock levels** tracked per item per location with real-time quantity updates
- **Low stock alerts** with configurable reorder levels and urgency classification

### Barcode-Driven Scanner Workflow
- **Scan Item → Scan Rack → Choose Action** (Add / Remove / Transfer)
- For transfers: scan destination rack after choosing Transfer
- Every new item auto-generates a **Code128 barcode** (value = SKU)
- Every rack auto-generates a **QR code** (value = `LOC:RACK_CODE`)
- **Print label sheets** — Avery 5160-compatible PDF generation for batch printing
- Individual barcode/QR download buttons on item detail pages
- Uses `@zxing/browser` for camera-based scanning — works on any phone browser

### Dashboard & Analytics
- **KPI cards**: Total SKUs, Low Stock count, Active Alerts, Today's Activity
- **Category distribution** pie chart (Glassware, Consumables, Chemicals, PPE)
- **Top consumed items** horizontal bar chart (30-day window)
- **Recent activity** feed with timestamped event log

### AI-Powered Intelligence
- **Anomaly detection** — Z-score (rule-based) + IsolationForest (ML) for unusual withdrawal patterns
- **Demand forecasting** — SMA, Exponential Smoothing, Linear Regression
- **Natural language search** — TF-IDF with typo tolerance (ethanol↔alcohol, eppendorf↔microcentrifuge tube)
- **RAG-ready architecture** — swap TF-IDF for OpenAI embeddings + pgvector with zero API change

### PWA & Offline Support
- Full Progressive Web App with Workbox service worker
- Offline item/location lookups via IndexedDB (Dexie)
- Offline mutation queue — drained automatically on reconnect
- Install-to-home-screen support on mobile

### Excel Import Pipeline
- Upload `SEAR Lab - Inventory Control Database.xlsx` via `/imports/excel`
- Auto-parses Master_Inventory, Incoming_Transactions, Outgoing_Transactions sheets
- Creates items, categories, locations, barcodes, and historical transaction events

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
| Deployment | Static files on Vercel | Requires Node.js server |

### Why FastAPI over Flask?

- **Native async/await** — asyncpg keeps DB queries non-blocking under concurrent scan load
- **Pydantic v2 validation** built-in — no extra serialization code
- **Auto OpenAPI/Swagger docs** — instant API documentation at `/docs`
- **Dependency injection** — clean RBAC, DB sessions, background tasks
- **Type safety** — mypy/pyright catches bugs at dev time, not runtime
- **3–5x faster** than Flask under concurrent ASGI load

### Why Supabase PostgreSQL over self-hosted?

- **Managed PostgreSQL 17** with automatic backups
- **Connection pooler** (PgBouncer) for production connection management
- **Built-in extensions**: `pg_trgm` (fuzzy search), `uuid-ossp`
- **Zero infrastructure** — no Docker DB container needed in production
- **Native partitioning** on `inventory_events.occurred_at` for time-series performance

---

## Repository Structure

```
.
├── backend/                          # FastAPI application (Python 3.11)
│   ├── app/
│   │   ├── api/v1/                   # Route handlers
│   │   │   ├── auth.py               # JWT auth + RBAC
│   │   │   ├── items.py              # Item CRUD + categories
│   │   │   ├── locations.py          # Areas + racks/bins
│   │   │   ├── barcodes.py           # PNG/SVG/QR/PDF label generation
│   │   │   ├── scans.py              # Barcode-driven stock operations (/scans/apply)
│   │   │   ├── transactions.py       # Ledger + alerts
│   │   │   ├── dashboard.py          # KPI aggregations
│   │   │   ├── imports.py            # Excel/CSV pipeline
│   │   │   ├── ai.py                 # NLP search + forecasting
│   │   │   └── users.py              # User management
│   │   ├── core/
│   │   │   ├── config.py             # Pydantic Settings
│   │   │   ├── database.py           # Async SQLAlchemy engine + Supabase pooler
│   │   │   ├── security.py           # JWT + bcrypt
│   │   │   └── events.py             # Domain event bus (MQTT-ready)
│   │   ├── models/                   # SQLAlchemy ORM models
│   │   │   ├── user.py               # User, Role, UserRole
│   │   │   ├── item.py               # Item, Category, ItemBarcode
│   │   │   ├── location.py           # Area, Location, LocationBarcode
│   │   │   └── transaction.py        # InventoryEvent, StockLevel, AuditLog, Alert, ImportJob
│   │   ├── schemas/                  # Pydantic I/O schemas
│   │   │   └── transaction.py        # Includes BarcodeScanApplyRequest for scan workflow
│   │   ├── repositories/             # Data access layer (asyncpg-backed)
│   │   ├── services/
│   │   │   ├── inventory_service.py  # Stock mutations + apply_barcode_scan()
│   │   │   ├── barcode_service.py    # python-barcode + qrcode + reportlab
│   │   │   ├── scan_service.py       # Barcode resolution (SKU → Item, LOC:CODE → Location)
│   │   │   └── import_service.py     # Excel/CSV migration pipeline
│   │   ├── ai/
│   │   │   ├── anomaly_detector.py   # Z-score (rule) + IsolationForest (ML)
│   │   │   ├── demand_forecaster.py  # SMA / Exp Smoothing / Linear Regression
│   │   │   └── nlp_search.py         # TF-IDF search (RAG-ready architecture)
│   │   └── main.py                   # FastAPI app + CORS + middleware
│   ├── migrations/                   # Alembic
│   │   └── versions/001_initial_schema.py
│   ├── requirements.txt
│   ├── runtime.txt                   # Python 3.11.9 (pinned for Render)
│   ├── .python-version               # Python 3.11.9
│   └── Dockerfile
│
├── frontend/                         # Vite + React 18 + TypeScript + Tailwind PWA
│   ├── src/
│   │   ├── api/                      # Axios API clients
│   │   │   ├── client.ts             # Base axios instance with JWT interceptors
│   │   │   ├── auth.ts               # Login, refresh, getMe
│   │   │   ├── items.ts              # Items CRUD + barcode blob downloads
│   │   │   └── transactions.ts       # Events, alerts, dashboard, scan apply
│   │   ├── components/
│   │   │   ├── layout/               # Layout, Sidebar, TopBar, MobileNav
│   │   │   ├── ui/                   # Button, Card, Input, Badge, Modal, Spinner, EmptyState
│   │   │   └── scanner/              # BarcodeScanner (@zxing/browser)
│   │   ├── hooks/                    # useScanner, useOffline, useDebounce
│   │   ├── offline/                  # IndexedDB (Dexie) + offline queue
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx         # KPIs, charts, recent activity
│   │   │   ├── Inventory.tsx         # Item list + Add Item modal
│   │   │   ├── ItemDetail.tsx        # Item details, rack-wise stock, barcode/QR/label downloads
│   │   │   ├── Scan.tsx              # Scan Item → Scan Rack → Action → Confirm workflow
│   │   │   ├── Locations.tsx         # Areas/racks list + Add Area/Rack modals + QR download
│   │   │   ├── Transactions.tsx      # Full event ledger with filters
│   │   │   ├── Alerts.tsx            # Low stock / anomaly alerts
│   │   │   ├── Import.tsx            # Excel upload
│   │   │   ├── AiInsights.tsx        # NLP search + demand forecast
│   │   │   └── Login.tsx             # Authentication
│   │   ├── store/                    # Zustand (auth state, persisted)
│   │   ├── types/                    # TypeScript type definitions
│   │   └── App.tsx                   # Router + QueryClient + Protected Routes
│   ├── vite.config.ts                # vite-plugin-pwa (workbox, manifest)
│   ├── nginx.conf                    # SPA routing + API proxy (Docker)
│   └── Dockerfile                    # Multi-stage: Vite build → Nginx
│
├── docker-compose.yml                # Local development stack
├── render.yaml                       # Render deployment blueprint
├── .env.example                      # Environment variable template
├── .vercelignore                     # Excludes backend from Vercel build
├── init.sql                          # PostgreSQL extensions setup
├── SEAR_Lab_Barcodes.pdf             # Pre-generated barcode label sheets
├── Lab_Inventory_Barcode_System.xlsx # Original legacy data
└── README.md
```

---

## Database Schema

### Supabase PostgreSQL with Native Partitioning

| Table | Partition Strategy | Purpose |
|---|---|---|
| `inventory_events` | Native range partition on `occurred_at` | Immutable event ledger |
| `audit_logs` | Native range partition on `occurred_at` | Full mutation history |
| `stock_levels` | None (small, frequently updated) | Current quantity per item per location |
| `items` | None | Master item catalog |
| `locations` | None | Rack/bin registry |
| `categories` | None | Item classification |
| `item_barcodes` | None | Code128 barcodes per item |
| `location_barcodes` | None | QR barcodes per rack |

### Indexes

- **BRIN index** on `inventory_events.occurred_at` for time-range queries
- **Composite B-tree** on `(item_id, occurred_at)` for item history
- **Partial B-tree** on `stock_levels` for low-stock queries
- **pg_trgm GIN index** on `items.name` for fuzzy search

### Barcode ID Strategy

```
Items:      {SKU}                       →  SKU-001, SKU-002, ...
            Primary barcode = Code128
            Optional QR = same value

Locations:  LOC:{LOCATION_CODE}         →  LOC:A1, LOC:B2, LOC:D1
            Primary barcode = QR code
            Printed on rack labels
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

## Scan Workflow (Mobile-First)

The scanner uses a **single unified endpoint** `POST /scans/apply` that accepts raw barcode strings and resolves them server-side.

### Step-by-Step Flow

```
1. Open Scan page (camera activates automatically)
2. Scan ITEM barcode (Code128)     → Resolves to Item (shows name, current stock)
3. Scan RACK barcode (QR)          → Resolves to Location
4. Choose action: Add / Remove / Transfer
5. For Transfer: scan DESTINATION rack barcode
6. Enter quantity + optional notes
7. Confirm → POST /scans/apply
```

### API Payload (`POST /scans/apply`)

```json
{
  "item_barcode": "SKU-001",
  "rack_barcode": "LOC:A1",
  "event_type": "stock_out",
  "quantity": 2,
  "reason": "Experiment A1",
  "destination_rack_barcode": "LOC:B2",  // only for transfer
  "notes": "For acid-base titration"
}
```

---

## Seeded Data (Real SEAR Lab Inventory)

### 10 SKUs

| SKU | Item | Category | Unit | Location | Qty | Reorder Level | Supplier |
|---|---|---|---|---|---|---|---|
| SKU-001 | Beakers 500ml | Glassware | EA | A1 | 8 | 20 | Lab Supply Co |
| SKU-002 | Test Tubes | Glassware | BOX | A2 | 5 | 3 | Lab Supply Co |
| SKU-003 | Pipette Tips 1000ul | Consumables | BOX | B1 | 2 | 5 | BioTech Labs |
| SKU-004 | Petri Dishes | Consumables | BOX | B2 | 1 | 10 | Lab Supply Co |
| SKU-005 | Distilled Water 1L | Chemicals | EA | C1 | -3 | 8 | Water Supplies Inc |
| SKU-006 | Centrifuge Tubes 1.5ml | Consumables | BOX | B3 | 0 | 10 | BioTech Labs |
| SKU-007 | Gloves Nitrile M | PPE | BOX | D1 | 1 | 2 | Safety Plus |
| SKU-008 | Lab Coat | PPE | EA | D2 | 0 | 4 | Safety Plus |
| SKU-009 | pH Buffer 7.0 | Chemicals | EA | C2 | -1 | 3 | ChemSource |
| SKU-010 | Alcohol 70% | Chemicals | EA | C3 | 5 | 2 | ChemSource |

### 11 Transactions (from Excel)

- **6 Stock-In**: PO-2026-001 through PO-2026-004, REC-2026-005, REC-2026-006
- **5 Stock-Out**: Experiment A1, Experiment A2, Equipment cleaning, Lab Work, Calibration

### Lab Settings

| Setting | Value |
|---|---|
| Lab Name | SEAR Lab |
| Address | Woolf Hall |
| Reorder Contact | Dr. Erick Jones |
| Email | erick.jones@uta.edu |

---

## Deployment

### Production Stack

| Service | Platform | Details |
|---|---|---|
| Frontend | **Vercel** | Auto-deploys from `main` branch, `frontend/` root |
| Backend | **Render** | Python 3.11.9, `backend/` root, `render.yaml` blueprint |
| Database | **Supabase** | PostgreSQL 17, connection pooler (session mode) |
| Repository | **GitHub** | `YashJoshi2109/Inventory` |

### Environment Variables

**Vercel (Frontend):**
```
VITE_API_URL=https://sierlab-inventory-backend.onrender.com/api/v1
```

**Render (Backend):**
```
POSTGRES_HOST=aws-1-us-east-1.pooler.supabase.com
POSTGRES_PORT=5432
POSTGRES_DB=postgres
POSTGRES_USER=postgres.vcyvsjasentcicsnpylz
POSTGRES_PASSWORD=<set in Render dashboard>
DATABASE_SSL=true
SECRET_KEY=<set in Render dashboard>
CORS_ORIGINS=<your Vercel URL>
PYTHON_VERSION=3.11.9
```

### Local Development

```bash
# Clone
git clone https://github.com/YashJoshi2109/Inventory.git && cd Inventory

# Copy environment
cp .env.example .env
# Edit .env with your Supabase credentials

# Option A: Docker Compose (full stack)
docker compose up --build

# Option B: Manual (hot reload)
# Backend
cd backend
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

### Default Admin Login

```
Username: admin
Password: ChangeMe123!
```

---

## API Endpoints

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/auth/login` | Get JWT access + refresh tokens |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| GET | `/api/v1/auth/me` | Current user profile |

### Items
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/items` | List items (paginated, filterable) |
| POST | `/api/v1/items` | Create item (auto-generates barcode) |
| GET | `/api/v1/items/{id}` | Item detail |
| PATCH | `/api/v1/items/{id}` | Update item |
| DELETE | `/api/v1/items/{id}` | Deactivate item |
| GET | `/api/v1/items/{id}/stock-levels` | Stock per location |
| GET | `/api/v1/items/categories` | List categories |

### Locations
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/locations` | List locations (filterable by area) |
| POST | `/api/v1/locations` | Create rack (auto-generates QR barcode) |
| GET | `/api/v1/locations/areas` | List areas |
| POST | `/api/v1/locations/areas` | Create area |

### Scan Operations
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/scans/apply` | Unified barcode-driven stock operation |
| POST | `/api/v1/scans/resolve` | Resolve barcode to item/location |

### Barcodes
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/barcodes/item/{id}/png` | Item barcode image (Code128) |
| GET | `/api/v1/barcodes/item/{id}/qr/png` | Item QR code image |
| GET | `/api/v1/barcodes/location/{id}/qr/png` | Location QR code image |
| GET | `/api/v1/barcodes/location/{id}/qr/svg` | Location QR code SVG |
| POST | `/api/v1/barcodes/labels/print` | Avery 5160 PDF label sheet |

### Transactions & Alerts
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/transactions` | Event ledger (paginated, filterable) |
| GET | `/api/v1/transactions/alerts` | Active alerts |
| PATCH | `/api/v1/transactions/alerts/{id}` | Resolve alert |

### Dashboard
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/dashboard/stats` | KPIs, charts, recent activity |

### AI
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/ai/search?q=...` | NLP search |
| GET | `/api/v1/ai/forecast/{item_id}` | Demand forecast |
| GET | `/api/v1/ai/anomalies` | Anomaly detection |

### Import
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/imports/excel` | Upload Excel file |

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
- **Linear regression forecast** — trend-aware (>60 days data)

### NLP Search (TF-IDF, RAG-ready)
- Handles typos, synonyms (ethanol↔alcohol, eppendorf↔microcentrifuge tube)
- Bi-gram TF-IDF with 50k feature vocabulary
- **Phase 2 upgrade path**: swap `TFIDFSearchEngine` for `EmbeddingSearchEngine` using OpenAI `text-embedding-3-small` + pgvector — zero API change

---

## Security & Auditability

- **JWT HS256** with short-lived access tokens (60 min) + refresh tokens (30 days)
- **RBAC**: admin > manager > operator > viewer
- **Negative stock override**: requires Manager+ explicit flag, recorded in event
- **Immutable ledger**: `inventory_events` rows are never updated/deleted; corrections create `ADJUSTMENT` events
- **Full audit trail**: `audit_logs` captures every mutation with before/after snapshots
- **Barcode auth**: all barcode image endpoints require JWT — frontend fetches via authenticated API client (blob URLs)
- **Input sanitization**: all inputs go through Pydantic v2 strict validation
- **SQL injection protection**: SQLAlchemy ORM parameterized queries throughout
- **CORS**: configured per-environment (Vercel domain whitelisted)

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Backend API | FastAPI + Uvicorn (ASGI) | 0.115 |
| ORM | SQLAlchemy 2.0 async + asyncpg | 2.0.36 |
| Database | Supabase PostgreSQL | 17 |
| Migrations | Alembic | 1.14 |
| Frontend | Vite + React + TypeScript | 6.0 / 18.3 / 5.7 |
| Styling | Tailwind CSS | 3.4 |
| State | Zustand + TanStack Query | 5.0 / 5.62 |
| Offline | Dexie (IndexedDB) + Workbox | 4.0 / 7.3 |
| Charts | Recharts | 2.14 |
| Forms | React Hook Form + Zod | 7.54 / 3.24 |
| Animations | Framer Motion | 11.15 |
| Barcode scan | @zxing/browser | 0.1.5 |
| Barcode gen | python-barcode + qrcode + reportlab | — |
| Auth | JWT (python-jose) + bcrypt | — |
| AI (rules) | SciPy + NumPy | 1.14 / 2.1 |
| AI (ML) | scikit-learn | 1.5 |
| AI (search) | TF-IDF (sklearn) | — |
| Import | Pandas + openpyxl | 2.2 / 3.1 |
| MQTT | paho-mqtt (Phase 2) | 2.1 |
| Hosting | Vercel + Render + Supabase | — |

---

## MQTT Integration Points (Phase 2)

The system is MQTT-ready. To activate:

1. Set `MQTT_ENABLED=true` in `.env`
2. Uncomment the `mqtt` service in `docker-compose.yml`
3. The `EventBus` in `app/core/events.py` will publish to topics:
   - `searlab/inventory/stock_in`
   - `searlab/inventory/stock_out`
   - `searlab/inventory/transfer`
   - `searlab/alert/low_stock`
4. RFID readers publish to `searlab/scan/rfid/{tag}` → backend subscribes and resolves via `ScanService`

---

## Phased Roadmap

| Phase | Features | Status |
|---|---|---|
| 1 | Core inventory, barcode scan, PWA, Excel import, basic AI | Done |
| 1.5 | Real SEAR Lab data, barcode-driven scan workflow, Vercel+Render deployment | Done |
| 2 | RFID reader integration via MQTT, real-time scan events | Ready (hooks in place) |
| 3 | RAG knowledge base (SOPs, SDS sheets, equipment manuals) | Architecture in place |
| 4 | Multi-site / multi-lab replication | Planned |
| 5 | Mobile native app (React Native, shared business logic) | Planned |

---

## License

Private — SEAR Lab, University of Texas at Arlington
