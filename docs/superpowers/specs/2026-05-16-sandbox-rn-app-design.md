# SEAR Lab Inventory — Conference Sandbox React Native App

**Date:** 2026-05-16  
**Status:** Approved  
**Target:** Conference kiosk demo (self-service, multi-device iOS + Android)

---

## 1. Goal

Build a production-identical React Native app (Expo) connected to a fully isolated sandbox backend. Conference attendees register with real email OTP, get their own pre-seeded SEAR Lab inventory universe, and interact with every feature — SmartScan, AI Copilot, Energy Hub, Inventory, Transactions, Admin — without ever touching production data.

---

## 2. Architecture

### 2.1 Sandbox Backend (Approach A — Separate Cloud Run + DB)

| Component | Details |
|---|---|
| Cloud Run service | Same Docker image as prod · `cloudbuild-sandbox.yaml` trigger |
| URL | `sandbox-api-xxxx.run.app` (exact URL assigned by Cloud Run on first deploy) |
| Database | New Cloud SQL instance `inventory-sandbox` (db-f1-micro) |
| Auth | Own users table — attendee accounts are sandbox-only |
| Activation | `SANDBOX_MODE=true` env var enables `SandboxOwnerMiddleware` |
| Prod impact | Zero — prod Cloud Run and Cloud SQL untouched |

### 2.2 Data Isolation

- `owner_id INT FK users(id)` added to `items`, `categories`, `areas`, `locations` in sandbox DB only
- `sandbox_seeded BOOL DEFAULT false` added to `users`
- `SandboxOwnerMiddleware` injects `owner_id = current_user.id` filter on all inventory/location queries
- `InventoryEvent.performed_by` already scopes transactions per user
- Energy data seeded per user via `owner_id` InfluxDB tag on all synthetic measurements; all queries filter by this tag

### 2.3 React Native App

- **Repo:** `inventory-sandbox-app` (new, separate from main repo)
- **Framework:** Expo SDK 52 + Expo Router
- **Distribution:** EAS Internal Distribution (no App Store needed)
- **API target:** Sandbox Cloud Run URL only (single constant in `constants/api.ts`)

---

## 3. Navigation Structure

### Auth Stack
```
Splash → Login → Register → OTP Verify → [seed trigger] → Main App
```

On OTP confirm: `POST /api/v1/sandbox/seed` fires automatically. Shows "Setting up your lab..." screen (~300ms). Idempotent.

### Main Tab Navigator (6 tabs)

| Tab | Primary Screen | Key Sub-screens |
|---|---|---|
| 🏠 Dashboard | DashboardScreen | AlertDetail |
| 📷 Quick Scan | ScanScreen | ItemFoundSheet, ActionConfirm |
| 🔬 SmartScan | SmartScanScreen | EPC/SGTIN-96, RFID, auto-actions, ZPL preview, batch print |
| 📦 Inventory | InventoryScreen | ItemDetail, ItemEdit, CategoryBrowse, LocationBrowse |
| 🤖 AI Copilot | CopilotScreen | DocUpload, KnowledgeBase |
| ⚡ Energy | EnergyDashboard | Solar/AC/HWH charts, Grid Forecast, Lab Hours |

### Slide-out Drawer (≡)
- Transactions → EventDetail
- Admin → UserList, RoleRequests
- Settings → ProfileEdit, ChangePassword

---

## 4. Per-User Seed Data

Triggered once on first OTP verify. Scoped to `owner_id = user.id`.

### Inventory (30 items, 5 categories)
- **Consumable:** Nitrile gloves (S/M/L), pipette tips, 50mL centrifuge tubes, filter paper
- **Chemical:** Ethanol 95%, HCl 37%, NaOH pellets, PBS buffer, DI water
- **Equipment:** Vortex mixer, hot plate, pH meter, micropipette P200
- **Supply:** Lab notebook, Sharpies, parafilm, microscope slides
- **Asset:** Centrifuge rotor, UV lamp, safety goggles, lab coat

### Locations (8 bins, 3 areas)
- `LAB-A`: S01-B01 (chemicals), S01-B02 (consumables)
- `COLD-ROOM`: CR-B01 (reagents), CR-B02 (buffers)
- `STORAGE`: ST-B01 through ST-B04

### Transactions (50 events, last 30 days)
- Mix of STOCK_IN, STOCK_OUT, TRANSFER, ADJUSTMENT
- 3 items below reorder level → dashboard low-stock alerts fire on first load
- 1 expired item → expiry alert
- Realistic timestamp spread for activity chart

### Energy Data (InfluxDB, 30 days)
- Solar: daytime generation curves, zero at night
- AC + HWH: realistic daily consumption patterns
- Net grid: calculated from solar vs load
- Lab hours: Mon–Fri 8am–8pm active
- Grid Forecast: synthetic next-24h data

---

## 5. Backend Changes

### 5.1 New Files
| File | Purpose |
|---|---|
| `backend/app/api/v1/sandbox.py` | Seed + reset + status endpoints |
| `backend/app/services/sandbox_seed.py` | Seed data definitions + InfluxDB energy writer |
| `backend/app/middleware/sandbox_owner.py` | `SandboxOwnerMiddleware` — owner_id filter injection |
| `backend/cloudbuild-sandbox.yaml` | Cloud Build trigger for sandbox Cloud Run deploy |

### 5.2 Modified Files
| File | Change |
|---|---|
| `backend/app/models/user.py` | Add `sandbox_seeded: bool` column |
| `backend/app/models/item.py` | Add `owner_id` FK to `items`, `categories` |
| `backend/app/models/location.py` | Add `owner_id` FK to `areas`, `locations` |
| `backend/app/main.py` | Mount sandbox router + conditionally add middleware |
| `backend/migrations/` | New Alembic migration for all schema changes |

### 5.3 Sandbox API Endpoints
```
POST /api/v1/sandbox/seed          # idempotent per-user seed
POST /api/v1/sandbox/reset         # superadmin — wipe + re-seed one user
GET  /api/v1/sandbox/status        # returns seed state + counts
```

### 5.4 Prod Isolation
`SANDBOX_MODE=true` env var present only on sandbox Cloud Run. Middleware and seed router are mounted only when this var is set. Prod deployment: no var → no middleware → no impact.

---

## 6. RN Project Structure

```
inventory-sandbox-app/
├── app/
│   ├── (auth)/           login.tsx · register.tsx · verify-otp.tsx
│   ├── (tabs)/           index · scan · smartscan · inventory · copilot · energy
│   └── (drawer)/         transactions · admin · settings
├── components/
│   ├── ui/               Button · Card · Badge · Input · BottomSheet
│   ├── scan/             CameraScanner · BarcodeOverlay · RFIDScanner
│   ├── inventory/        ItemCard · StockBadge · LocationPill
│   ├── energy/           GaugeChart · AreaChart · GridForecast
│   └── copilot/          ChatBubble · DocChip · TypingIndicator
├── lib/
│   ├── api/              TanStack Query hooks per domain
│   ├── store/            Zustand: auth slice · scan state
│   └── utils/            EPC parser · GS1 decoder · barcode utils
├── constants/
│   └── api.ts            SANDBOX_API_URL (single source of truth)
└── app.config.ts         Expo config + EAS build profiles
```

---

## 7. Tech Stack

| Layer | Choice |
|---|---|
| Framework | Expo SDK 52 + Expo Router |
| Language | TypeScript |
| Styling | NativeWind 4 (Tailwind for RN) |
| Navigation | React Navigation 6 (Stack + Tab + Drawer) |
| Data fetching | TanStack Query v5 |
| Global state | Zustand |
| Camera / Scan | expo-camera + expo-barcode-scanner |
| Charts | Victory Native XL |
| Secure storage | expo-secure-store (JWT) |
| Distribution | EAS Internal Distribution |

---

## 8. Conference Day Reset

| Option | When to use |
|---|---|
| **Option 1 — Full DB wipe** | Night before event: drop + recreate sandbox DB, run migrations |
| **Option 2 — Truncate only** (recommended) | Quick reset between sessions: TRUNCATE sandbox tables, keep user accounts, re-seed on next login |
| **Option 3 — Per-user admin reset** | Live during demo: `POST /sandbox/reset?user_id=X` from superadmin account |

---

## 9. Build & Deployment Sequence

1. **Sandbox infra** — Cloud SQL instance · Cloud Run service · Alembic migration · health check
2. **Backend: seed + middleware** — `sandbox_seed.py` · `SandboxOwnerMiddleware` · seed router · integration test
3. **RN: scaffold + auth** — Expo init · NativeWind · Zustand · auth stack · seed trigger on OTP verify
4. **RN: core screens** — Dashboard · Inventory · Transactions · Locations · Settings · Admin
5. **RN: scan screens** — Quick Scan (expo-camera) · SmartScan (EPC, RFID, auto-actions, ZPL)
6. **RN: AI + Energy** — Copilot chat (streaming) · Energy Hub (gauges + charts + Grid Forecast)
7. **EAS Build + distribution** — iOS (TestFlight internal) · Android (APK) · smoke test all screens on conference devices

---

## 10. Constraints

- Prod web app and API: **zero changes, zero downtime risk**
- Attendee accounts: sandbox-only, no prod user table pollution
- Sandbox DB can be nuked at any time with no consequences
- RN app distributed via EAS internal link — no App Store review cycle
- SmartScan RFID bridge requires physical RP902 device; demo works without it (barcode/QR path always available)
