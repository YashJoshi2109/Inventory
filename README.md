# SEAR Lab Inventory Control System

> **AI-powered, mobile-first laboratory inventory management** — Real-time QR scanning, glassmorphism UI, demand forecasting, SmartScan vision AI, live energy monitoring, and full audit trail.

[![Live App](https://img.shields.io/badge/Frontend-Vercel-black)](https://sierlab-inventory.vercel.app)
[![API](https://img.shields.io/badge/Backend-Render-blue)](https://sear-lab-inventory.onrender.com)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11-blue)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61dafb)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)](https://typescriptlang.org)

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Rate Limiting](#rate-limiting)
- [SmartScan Vision AI](#smartscan-vision-ai)
- [Energy Hub](#energy-hub)
- [AI Copilot](#ai-copilot)
- [Database Schema](#database-schema)
- [Deployment](#deployment)
- [Project Structure](#project-structure)

---

## Overview

SEAR Lab Inventory is a production-grade inventory system built for the **UTA SEAR Lab**. It enables researchers to track reagents, consumables, and equipment using QR codes printed on every item and rack location. Built with a modern async Python backend and a React/TypeScript frontend with glassmorphism design system.

**Key capabilities:**
- Track stock in/out/transfer with full audit trail
- Print QR codes for every item and shelf location
- Scan QR codes to check out / restock items in < 3 seconds
- AI-powered demand forecasting to predict reorder dates
- SmartScan: point camera at any item → AI identifies and pre-fills inventory form
- Live energy dashboard showing HVAC, water heater, and solar production
- AI Copilot chat for natural-language inventory queries
- Role-based access control (Admin / Manager / Viewer)
- Passkey / WebAuthn authentication + email OTP fallback

---

## Features

### Core Inventory

| Feature | Description |
|---------|-------------|
| **QR Scan Checkout** | Scan shelf QR → scan item QR → confirm stock movement in one flow |
| **Multi-Location** | Items tracked across racks, shelves, and sub-locations |
| **Audit Trail** | Every stock-in, stock-out, transfer, and adjustment logged |
| **Low Stock Alerts** | Configurable reorder thresholds with email + in-app notifications |
| **Bulk Import** | CSV / Excel import with validation and error reporting |
| **Category Management** | Nested categories with color coding |
| **Demand Forecasting** | ML-based 7/30-day consumption forecast per consumable item |

### SmartScan (Vision AI)

| Feature | Description |
|---------|-------------|
| **Camera Capture** | Live camera viewfinder with front/back flip |
| **5 Analysis Modes** | Full Scan, Classify, OCR, Count, Shelf Audit |
| **AI Detection** | Gemini Vision → OpenRouter fallback chain |
| **Per-User Quota** | 15 scans/hour · 50 scans/day per user |
| **Image Compression** | Auto-resize to ≤1024px before AI call (OOM-safe on 512 MB servers) |
| **Quota Exceeded UX** | Countdown timer + "Add Manually" fallback — never a dead end |
| **Review & Edit** | Human verification step before adding to inventory |

### Energy Hub (HVAC Live Monitor)

| Feature | Description |
|---------|-------------|
| **Live Polling** | 15-second refresh from Supabase |
| **Solar Gauge** | Animated SVG half-circle gauge showing solar coverage % |
| **5-Min Aggregation** | Background task collapses raw readings → 96× less data |
| **Dashboard Widget** | Framer Motion animated EcoEnergy widget on main dashboard |
| **Energy Trends** | Area chart with solar generation vs consumption |

### AI Copilot

| Feature | Description |
|---------|-------------|
| **Natural Language Search** | "Find ethanol in C1 rack" → instant results |
| **Streaming Responses** | Token-by-token SSE streaming |
| **Context Aware** | Knows inventory, locations, and recent transactions |
| **Rate Limited** | 30 messages/minute per IP, sliding-window |

### Authentication & RBAC

| Feature | Description |
|---------|-------------|
| **Passkeys / WebAuthn** | Biometric / device auth (no passwords) |
| **Email OTP** | Magic-link fallback |
| **JWT Sessions** | Signed access + refresh token pair |
| **Role-Based Access** | Admin / Manager / Viewer with per-route enforcement |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Browser (PWA)                          │
│  React 18 + TypeScript + Vite + Tailwind + Framer Motion    │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTPS / SSE
┌────────────────────▼────────────────────────────────────────┐
│              FastAPI (Python 3.11, ASGI/uvicorn)            │
│  Auth · Inventory · Energy · AI · Alerts · Notifications    │
└──────┬──────────────────────────────────────────┬───────────┘
       │ asyncpg                                  │ HTTPS
┌──────▼───────┐                      ┌───────────▼──────────┐
│  PostgreSQL  │                      │  External AI APIs    │
│  (Supabase)  │                      │  Gemini · OpenRouter │
└──────────────┘                      └──────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   HVAC Python Collector                      │
│  LG ThinQ AC · Rheem EcoNet WHH · Enphase Solar             │
│  Writes to Supabase every 15 seconds                        │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

- **Single DB for relational + time-series** — PostgreSQL handles both inventory events and energy readings
- **5-minute aggregation** — background task collapses raw HVAC readings (every 15s) into per-bucket averages → 20× storage reduction per hour
- **Image compression pipeline** — frontend compresses to ≤1280px, backend re-compresses to ≤1024px with Pillow → prevents OOM on 512 MB instances
- **Per-user vision rate limiting** — keyed on `user_id` (not IP) so shared lab networks don't exhaust quota for everyone

---

## Tech Stack

### Backend

| Layer | Tech |
|-------|------|
| Framework | FastAPI 0.115 (async) |
| Language | Python 3.11 |
| ORM | SQLAlchemy 2.0 async + asyncpg |
| Database | PostgreSQL 15 (Supabase) |
| Auth | python-jose JWT + webauthn + passlib |
| AI | google-genai (Gemini) + openai (OpenRouter) |
| Image | Pillow 11 |
| ML | scikit-learn, numpy, scipy |
| Server | uvicorn[standard] |

### Frontend

| Layer | Tech |
|-------|------|
| Framework | React 18 + TypeScript 5 |
| Build | Vite 5 |
| Styling | Tailwind CSS 3 |
| Animation | Framer Motion 11 |
| State | Zustand + React Query v5 |
| Charts | Recharts |
| Icons | Lucide React |
| Routing | React Router v6 |

---

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 20+
- PostgreSQL 15+ (or Supabase project)

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp ../.env.example .env            # fill in your values
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev                        # → http://localhost:5173
```

### HVAC Collector (optional)

```bash
cd hvac_collector
pip install -r requirements.txt
cp .env.example .env               # add device credentials
python run_live.py
```

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | `postgresql+asyncpg://user:pass@host/db` |
| `DATABASE_SSL` | | `true` for Supabase/production |
| `SECRET_KEY` | ✅ | Random 64-char string for JWT signing |
| `GEMINI_API_KEY` | ✅ | Google Gemini API key (vision + chat) |
| `GEMINI_VISION_MODEL` | | Default: `gemini-2.0-flash` |
| `GEMINI_VISION_FALLBACK_MODELS` | | Comma-separated fallback model IDs |
| `GEMINI_CHAT_MODEL` | | Default: `gemini-2.0-flash` |
| `OPENROUTER_API_KEY` | | OpenRouter key (vision fallback) |
| `OPENROUTER_VISION_MODEL` | | e.g. `google/gemini-flash-1.5` |
| `SMTP_HOST` | | SMTP server for email OTP |
| `SMTP_PORT` | | Default: `587` |
| `SMTP_USER` | | SMTP username / sender address |
| `SMTP_PASSWORD` | | SMTP password |
| `BREVO_API_KEY` | | Brevo transactional email (alternative) |
| `FRONTEND_URL` | | CORS origin, e.g. `https://your-app.vercel.app` |
| `MQTT_ENABLED` | | `true` to enable IoT broker |
| `ENVIRONMENT` | | `development` or `production` |

### Frontend (`frontend/.env`)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend base URL, e.g. `/api/v1` |

### HVAC Collector (`hvac_collector/.env`)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `LG_USERNAME` | LG ThinQ account email |
| `LG_PASSWORD` | LG ThinQ account password |
| `ECONET_USERNAME` | Rheem EcoNet account email |
| `ECONET_PASSWORD` | Rheem EcoNet account password |
| `ENPHASE_API_KEY` | Enphase developer API key |
| `ENPHASE_SYSTEM_ID` | Your Enphase system ID |

---

## API Reference

All endpoints are prefixed with `/api/v1`. Protected endpoints require `Authorization: Bearer <token>`.

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/login` | Email OTP request |
| `POST` | `/auth/verify-otp` | Verify OTP → returns JWT pair |
| `POST` | `/auth/refresh` | Refresh access token |
| `GET` | `/auth/me` | Current user profile |
| `POST` | `/auth/webauthn/register/begin` | Start passkey registration |
| `POST` | `/auth/webauthn/authenticate/complete` | Complete passkey login |

### Inventory

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/items` | List items (paginated, filterable) |
| `POST` | `/items` | Create item |
| `GET` | `/items/{id}` | Get item with stock levels |
| `PATCH` | `/items/{id}` | Update item |
| `POST` | `/items/import` | Bulk import CSV/Excel |
| `GET` | `/locations` | List all locations |
| `POST` | `/transactions/stock-in` | Record stock arrival |
| `POST` | `/transactions/stock-out` | Record consumption |
| `POST` | `/transactions/transfer` | Move between locations |

### Energy

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/energy/dashboard?hours=24` | Latest reading + chart history + stats |
| `GET` | `/energy/latest` | Single latest reading |
| `POST` | `/energy/readings` | Insert reading (HVAC collector) |
| `POST` | `/energy/aggregate` | **[Admin]** Trigger 5-min aggregation |

### AI

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/ai/search?q=query` | NLP inventory search |
| `GET` | `/ai/forecast/{item_id}` | Demand forecast |
| `GET` | `/ai/vision/status` | Vision quota (global + per-user) |
| `POST` | `/ai/vision/analyze` | SmartScan image analysis |
| `POST` | `/ai/metadata/suggest` | AI metadata suggestions |
| `POST` | `/ai/index/rebuild` | **[Admin]** Rebuild NLP search index |

---

## Rate Limiting

All limits use an in-memory **sliding-window** counter.

| Scope | Limit | Window | Key |
|-------|-------|--------|-----|
| Global API | 300 requests | 1 minute | Per IP |
| Chat messages | 30 messages | 1 minute | Per IP |
| Vision scans | **15 scans** | 1 hour | Per user ID |
| Vision scans | **50 scans** | 24 hours | Per user ID |

**Vision quota exceeded response:**

```json
HTTP 429
{
  "detail": {
    "code": "VISION_USER_QUOTA",
    "message": "Scan limit reached (15/hr). Try again in 1847s.",
    "retry_after_seconds": 1847,
    "scans_remaining": 0,
    "scans_limit": 15
  }
}
```

The frontend handles this with a dedicated quota screen showing a live countdown and an **"Add Item Manually"** escape hatch so users are never stuck.

---

## SmartScan Vision AI

### Analysis Modes

| Mode | Description |
|------|-------------|
| **Full Scan** | Detect, classify, OCR, count, damage check, shelf audit |
| **Classify** | Identify item type, brand, model, category |
| **OCR** | Extract all text (serial numbers, CAS numbers) |
| **Count** | Count distinct items in frame |
| **Audit** | Shelf organization assessment |

### Provider Chain

```
1. Gemini primary model
2. Gemini fallback models
3. OpenRouter vision models
4. → 429 with structured quota error + countdown UI
```

### Image Pipeline (Memory-Safe)

```
Camera (≤1280px, JPEG 0.80)
    → compressForUpload() [frontend Canvas, quality 0.78]
    → Backend: reject >5 MB
    → Pillow resize ≤1024px, JPEG 80%
    → del image_bytes after API call
    → Gemini/OpenRouter
    → VisionAnalysisResult JSON
```

---

## Energy Hub

Monitors real-time power from three sources:

| Source | Device |
|--------|--------|
| **HVAC** | LG ThinQ AC |
| **Water Heater** | Rheem EcoNet |
| **Solar** | Enphase Envoy |

### 5-Minute Aggregation

The `energy_cleanup_loop` background task (runs every 5 min):
1. Finds all readings older than 10 minutes
2. Groups into 5-minute time buckets
3. Inserts one averaged row per bucket, deletes originals
4. Result: ≤12 rows/hour instead of 240

Trigger manually (admin only):

```bash
curl -X POST /api/v1/energy/aggregate -H "Authorization: Bearer <admin_token>"
```

---

## AI Copilot

Conversational interface to your inventory using Gemini with streaming SSE.

- Natural language queries about stock, locations, transactions
- Demand forecasting integration
- Rate limited: 30 messages/minute/IP

---

## Database Schema

### Core Tables

```sql
users, roles, user_roles          -- Auth & RBAC
passkey_credentials               -- WebAuthn store
categories, items                 -- Inventory catalog
locations, stock_levels           -- Where things are
inventory_events                  -- Full audit trail
alerts                            -- Low stock & anomalies
```

### Energy Table

```sql
energy_readings (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    timestamp             timestamptz NOT NULL DEFAULT now(),
    ac_power_mode         text,        -- POWER_ON / POWER_OFF
    ac_current_temp_c     double precision,
    ac_consumption_w      double precision,
    hwh_mode              text,
    hwh_running           boolean,
    hwh_consumption_w     double precision,
    solar_current_power_w double precision,
    total_consumption_w   double precision,
    net_balance_w         double precision,  -- positive = surplus
    overall_recommendation text
);
CREATE INDEX idx_energy_readings_timestamp ON energy_readings (timestamp DESC);
```

---

## Deployment

### Backend — Render.com

1. New **Web Service** → connect GitHub repo
2. Root Directory: `backend`
3. Build: `pip install -r requirements.txt`
4. Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Add all environment variables
6. Instance: **512 MB minimum** (1 GB recommended)

### Frontend — Vercel

1. Import GitHub repo
2. Root Directory: `frontend`, Framework: Vite
3. Build: `npm run build`, Output: `dist`
4. Add `VITE_API_URL` → your Render URL + `/api/v1`

### HVAC Collector

```bash
cd hvac_collector
nohup python run_live.py &         # or use systemd
```

---

## Project Structure

```
Inventory/
├── backend/
│   ├── app/
│   │   ├── api/v1/
│   │   │   ├── ai.py           # SmartScan + NLP + forecast
│   │   │   ├── auth.py         # JWT + WebAuthn + OTP
│   │   │   ├── energy.py       # Energy dashboard + aggregation
│   │   │   └── items.py        # Inventory CRUD
│   │   ├── ai/                 # Copilot, forecaster, NLP search
│   │   ├── core/
│   │   │   ├── database.py     # AsyncEngine + session factory
│   │   │   └── rate_limit.py   # Sliding-window (IP + per-user)
│   │   ├── models/             # SQLAlchemy ORM
│   │   └── main.py             # FastAPI app + background tasks
│   └── requirements.txt
│
├── frontend/
│   └── src/
│       ├── api/                # Typed API clients
│       ├── pages/
│       │   ├── Dashboard.tsx   # Main dashboard + EcoEnergy widget
│       │   ├── SmartScan.tsx   # Vision AI + quota UX
│       │   ├── EnergyDashboard.tsx
│       │   └── Scan.tsx        # QR scan workflow
│       └── store/              # Zustand auth store
│
└── hvac_collector/
    ├── EnergyDataCollector.py  # AC + WHH + Solar collector
    ├── run_live.py             # 15-second polling loop
    └── supabase_writer.py      # Supabase helpers
```

---

## Development Tips

**Kill stale uvicorn process:**

```bash
pkill -9 -f "uvicorn app.main"
cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Check vision quota:**

```bash
curl http://localhost:8000/api/v1/ai/vision/status \
  -H "Authorization: Bearer <token>"
# → user_scans_remaining, user_scans_remaining_day
```

**TypeScript check:**

```bash
cd frontend && node_modules/.bin/tsc --noEmit
```

---

## License

MIT © 2026 UTA SEAR Lab
