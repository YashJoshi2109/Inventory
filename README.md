# SEAR Lab Inventory Control System

> **AI-powered, mobile-first laboratory inventory management** — Real-time QR scanning, glassmorphism UI, demand forecasting, and full audit trail.

[![Live App](https://img.shields.io/badge/Frontend-Vercel-black)](https://sierlab-inventory.vercel.app)
[![API](https://img.shields.io/badge/Backend-Render-blue)](https://sear-lab-inventory.onrender.com)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## Table of Contents
- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Screenshots](#screenshots)
- [Scanner Workflow](#scanner-workflow)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [Deployment](#deployment)
- [Development Setup](#development-setup)
- [Environment Variables](#environment-variables)

---

## Overview

SEAR Lab Inventory is a production-grade inventory system built for laboratory environments. It enables researchers to track reagents, consumables, and equipment using QR codes printed on every item and rack location.

**Key business objectives:**
- Track stock in/out with full audit trail
- QR-code scanning for all operations (no manual entry required)
- Real-time low-stock and anomaly alerts
- AI-powered demand forecasting and natural language search
- Offline-capable PWA for mobile use in labs

---

## Features

### Core Inventory
- **Full CRUD** for items with categories, supplier, reorder levels
- **Location management** — hierarchical Areas → Racks
- **Stock operations** — Add, Remove, Transfer between racks
- **Immutable ledger** — every operation logged with user, timestamp, quantity

### QR Code System
- Auto-generated QR codes for every item (stored as BYTEA blobs in DB)
- Auto-generated QR codes for every rack/location
- Printable label sheets (PDF) with QR codes
- Scanner works with `@zxing/browser` — works on any phone camera

### 4-Mode Scanner Workflow
| Mode | Description |
|------|-------------|
| **Add** | Scan existing item QR → scan rack → add stock. OR manually create new item (auto-SKU) → generate QR → print → scan rack |
| **Remove** | Scan item → pick rack from stock-level list → enter qty → confirm |
| **Transfer** | Scan item → view stock by location → select source rack → scan destination → confirm |
| **Modify** | Scan item → edit all details in pre-filled form → save |

### AI & Analytics
- **Anomaly Detection** — Z-score and Isolation Forest models
- **Demand Forecasting** — SMA, Exponential Smoothing, Linear Regression
- **NLP Search** — TF-IDF based search ("ethanol for cell culture", "low reorder items")
- **Dashboard** — KPI cards, category donut chart, top-consumed bar chart, activity feed

### User Management
- JWT authentication (access + refresh tokens)
- Role-based access control (admin, manager, viewer)
- **Self-registration** — users can sign up and select viewer/manager role
- Admin assigns admin role manually

### PWA / Offline
- Installable on iOS and Android
- Offline scan queue with sync on reconnect (IndexedDB via Dexie)

### MQTT (optional — large-scale integrations)
- Publishes **JSON domain events** to a broker (stock in/out/transfer/adjustment, item created/updated, login)
- **QoS 1** by default, TLS + auth configurable — see [`docs/MQTT.md`](docs/MQTT.md)
- Local broker: `docker compose --profile mqtt up` + `mosquitto.conf`

---

## Tech Stack

### Frontend
| Technology | Purpose |
|-----------|---------|
| **React 18** + Vite | UI framework |
| **TypeScript** | Type safety |
| **Tailwind CSS** | Styling (glassmorphism theme) |
| **Zustand** | Auth state management |
| **TanStack Query** | Server state + caching |
| **@zxing/browser** | QR/barcode scanning |
| **vite-plugin-pwa** | PWA + service worker |
| **Recharts** | Dashboard charts |
| **Framer Motion** | UI animations |
| **Dexie** | IndexedDB offline queue |

### Backend
| Technology | Purpose |
|-----------|---------|
| **FastAPI** | REST API |
| **SQLAlchemy 2.0** (async) | ORM |
| **Alembic** | Database migrations |
| **Pydantic v2** | Request/response validation |
| **Python-Jose** | JWT tokens |
| **Passlib + bcrypt** | Password hashing |
| **qrcode** | QR code generation |
| **reportlab** | PDF label generation |
| **pandas + openpyxl** | Excel import |
| **scikit-learn** | Anomaly detection & forecasting |

### Database
- **Supabase (PostgreSQL 17)**
- `pg_trgm` for fuzzy text search
- `uuid-ossp` for UUID generation
- BRIN indexes on `occurred_at` for time-series
- Composite B-tree indexes for inventory queries
- `BYTEA` columns for QR image blob storage

### Infrastructure
- **Frontend**: Vercel (auto-deploy from main branch)
- **Backend**: Render (Python 3.11.9 pinned)
- **Database**: Supabase cloud PostgreSQL
- **CI/CD**: GitHub Actions

---

## Scanner Workflow

### Remove Stock — New UX
1. Scan item QR code
2. System fetches stock levels across all racks
3. **Location picker** shows all racks with their stock counts — tap to select
4. Alternatively scan the rack QR directly
5. Enter quantity and optional reason/borrower
6. Confirm → stock removed, audit log created

### Transfer — Fixing "No stock at source"
The transfer flow now validates stock at the source location **before** confirming:
1. Scan item → system loads stock by location
2. **Stock distribution** shown per rack
3. Select source rack from list (or scan QR) — 0-stock racks are filtered
4. Scan destination rack
5. Confirm → transfer recorded

### Auto-SKU Generation
When creating a new item manually, the SKU field auto-populates as `SKU-XXX` (based on current item count) — no manual entry needed.

---

## API Reference

### Authentication
```
POST /api/v1/auth/register    Public self-registration (viewer/manager)
POST /api/v1/auth/login       Get access + refresh tokens
POST /api/v1/auth/refresh     Refresh access token
GET  /api/v1/auth/me          Get current user profile
```

### Items
```
GET    /api/v1/items                    List items (paginated, filterable)
POST   /api/v1/items                    Create item (auto-generates QR blob)
GET    /api/v1/items/{id}               Get item details
PATCH  /api/v1/items/{id}               Update item
DELETE /api/v1/items/{id}               Deactivate item
GET    /api/v1/items/{id}/stock-levels  Stock per location
GET    /api/v1/items/categories         List categories
```

### Scanner
```
POST /api/v1/scans/lookup        Resolve barcode → item or location
POST /api/v1/scans/stock-in      Add stock to location
POST /api/v1/scans/stock-out     Remove stock from location
POST /api/v1/scans/transfer      Transfer between locations
POST /api/v1/scans/modify-item   Update item details by scan
```

### Locations
```
GET  /api/v1/locations           List all areas + racks
POST /api/v1/locations           Create area or rack (auto-generates QR blob)
```

### Barcodes
```
GET  /api/v1/barcodes/item/{id}/qr/png         Item QR (from DB blob)
GET  /api/v1/barcodes/location/{id}/qr/png     Location QR (from DB blob)
POST /api/v1/barcodes/labels/print             Print label sheet (PDF)
```

### Dashboard & AI
```
GET /api/v1/dashboard/stats      KPIs, charts, recent activity
GET /api/v1/ai/search?q=...      NLP item search
GET /api/v1/ai/forecast/{id}     Demand forecast for item
GET /api/v1/ai/anomalies         Detected stock anomalies
```

---

## Database Schema

### Core Tables
```sql
items          — SKU, name, category, unit, supplier, reorder_level
item_barcodes  — barcode_value, barcode_type, qr_image (BYTEA)
locations      — code, name, area_id (hierarchical)
location_barcodes — barcode_value, qr_image (BYTEA)
stock_levels   — item_id, location_id, quantity (materialized view)
inventory_events — item_id, event_kind, quantity, from/to location, actor
```

### User Tables
```sql
users     — email, username, full_name, hashed_password, is_active
roles     — name (admin/manager/viewer), description
user_roles — user_id, role_id (many-to-many)
```

### Event Kinds
```
STOCK_IN  · STOCK_OUT  · TRANSFER  · ADJUSTMENT  · CYCLE_COUNT  · IMPORT
```

---

## Deployment

### Frontend (Vercel)
```bash
# Auto-deploys from main branch
# Build command: npm run build
# Output dir: dist
# Root dir: frontend
```

### Backend (Render)
```yaml
# render.yaml
services:
  - type: web
    name: sear-lab-backend
    env: python
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn app.main:app --host 0.0.0.0 --port $PORT
    envVars:
      - key: PYTHON_VERSION
        value: "3.11.9"
```

### Database (Supabase)
- Session mode pooler for async SQLAlchemy compatibility
- IPv6 connection string required for Render

---

## Development Setup

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL (or Supabase account)

### Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # Fill in DATABASE_URL, SECRET_KEY
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env.local       # Set VITE_API_URL=http://localhost:8000/api/v1
npm run dev
```

### Docker Compose (full stack)
```bash
cp .env.example .env
docker compose up --build
# Frontend: http://localhost:5173
# Backend:  http://localhost:8000
# API docs: http://localhost:8000/docs
```

---

## Environment Variables

### Backend `.env`
```env
DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/db
SECRET_KEY=your-256-bit-secret
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=30
CORS_ORIGINS=["http://localhost:5173","https://yourapp.vercel.app"]
```

### Frontend `.env.local`
```env
VITE_API_URL=https://your-backend.onrender.com/api/v1
```

---

## Default Credentials (Development)
```
Admin:   sear_admin / searlab2024!
Manager: lab_manager / searlab2024!
Viewer:  viewer / searlab2024!
```
> ⚠️ Change all passwords before production deployment.

---

## Changelog

### v1.4 (Latest)
- **Registration page** — self-service account creation with role selection
- **Remove flow UX** — shows stock-by-location picker after item scan; no more mandatory rack QR scan
- **Transfer validation** — prevents "0 available at source" by showing valid source locations and pre-validating stock
- **Auto-SKU** — new item form auto-fills SKU field from DB count
- **AI Insights on mobile** — accessible from bottom nav
- **Dashboard** — custom pie chart tooltip with category name + count + percentage; formatted bar chart labels
- **Glassmorphism UI** — full redesign with cyan brand, frosted glass cards, grid background, glowing nav

### v1.3
- 4-mode scanner workflow (Add, Remove, Transfer, Modify)
- QR blobs stored as BYTEA in PostgreSQL
- Scanner `firedRef` lock — eliminates multiple toast/lookup on scan

### v1.2
- Real data import from Excel (10 SEAR Lab SKUs)
- Location QR generation and print labels
- SEAR Lab branding

### v1.1
- FastAPI + SQLAlchemy async backend
- Supabase PostgreSQL deployment
- JWT auth with RBAC

### v1.0
- Initial MVP

---

*Built with for the SEAR Lab research team.*
