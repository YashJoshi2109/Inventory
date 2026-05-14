# Energy Hub: InfluxDB Live Data Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull live sensor data from the SEAR Lab InfluxDB instance into the existing EcoEnergy Hub, replacing static/Postgres-only values with real-time readings polled every 15 seconds.

**Architecture:** A new FastAPI endpoint `/energy/grafana-live` queries InfluxDB via Flux using `influxdb-client-python` and returns a JSON shape that mirrors the existing `/energy/dashboard` response. The frontend adds a second `useQuery` hook that merges InfluxDB values (solar W, indoor temp °C, water heater setpoint, net balance) over the Postgres data, adds one new stat card, and upgrades the chart with higher-resolution InfluxDB timeseries.

**Tech Stack:** `influxdb-client` (Python async), FastAPI, React Query, Recharts, TypeScript

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/requirements.txt` | Modify | Add `influxdb-client` |
| `backend/app/core/config.py` | Modify | Add 4 `INFLUXDB_*` settings |
| `backend/app/api/v1/energy_influx.py` | Create | InfluxDB Flux queries + `/energy/grafana-live` route |
| `backend/app/api/router.py` | Modify | Register new router |
| `frontend/src/api/energy.ts` | Modify | Add `InfluxLiveData` type + `getGrafanaLive()` |
| `frontend/src/pages/EnergyDashboard.tsx` | Modify | Second query, merge, new Indoor Temp card, updated chart |

---

## Task 1: Add `influxdb-client` to requirements and config

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/app/core/config.py`
- Modify: `backend/.env` (add 4 lines — user fills in real values)

- [ ] **Step 1: Add package to requirements.txt**

Open `backend/requirements.txt` and add after the `httpx` line:

```
influxdb-client==3.7.0
```

- [ ] **Step 2: Add InfluxDB settings to config.py**

In `backend/app/core/config.py`, add these 4 fields inside the `Settings` class after the JWT section (around line 78):

```python
# InfluxDB (SEAR Lab Grafana data source)
INFLUXDB_URL: str = "http://18.234.235.221:8086"
INFLUXDB_TOKEN: str = ""
INFLUXDB_ORG: str = ""
INFLUXDB_BUCKET: str = ""
```

- [ ] **Step 3: Add env vars to .env**

Add to `backend/.env` (replace placeholder values with real credentials from user):

```
INFLUXDB_URL=http://18.234.235.221:8086
INFLUXDB_TOKEN=PASTE_TOKEN_HERE
INFLUXDB_ORG=PASTE_ORG_HERE
INFLUXDB_BUCKET=PASTE_BUCKET_HERE
```

- [ ] **Step 4: Install package**

```bash
cd backend && pip install influxdb-client==3.7.0
```

Expected output: `Successfully installed influxdb-client-3.7.0`

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend/app/core/config.py
git commit -m "feat(energy): add influxdb-client dep + config settings"
```

---

## Task 2: Create `energy_influx.py` — InfluxDB queries + route

**Files:**
- Create: `backend/app/api/v1/energy_influx.py`

- [ ] **Step 1: Create the file**

```python
"""
GET /energy/grafana-live
Queries the SEAR Lab InfluxDB instance (same data source as Grafana) and
returns the latest sensor readings + 3-hour timeseries.

InfluxDB measurement: energy_usage
Tags:  source (array-01 | unit-01 | balance), type (solar | hvac | hwh | net)
Fields: generation_w, temp_c, setpoint_c, total_w
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter
from influxdb_client.client.influxdb_client_async import InfluxDBClientAsync

from app.api.v1.auth import CurrentUser
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/energy", tags=["energy"])

_EMPTY_HISTORY: dict[str, list] = {
    "labels": [], "solar": [], "net": [],
}

_EMPTY_RESPONSE: dict[str, Any] = {
    "latest": None,
    "history": _EMPTY_HISTORY,
    "live": False,
}


def _flux_last(field: str, source: str, src_type: str) -> str:
    return f"""
from(bucket: "{settings.INFLUXDB_BUCKET}")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "energy_usage")
  |> filter(fn: (r) => r.source == "{source}")
  |> filter(fn: (r) => r.type == "{src_type}")
  |> filter(fn: (r) => r._field == "{field}")
  |> last()
"""


def _flux_history(field: str, source: str, src_type: str) -> str:
    return f"""
from(bucket: "{settings.INFLUXDB_BUCKET}")
  |> range(start: -3h)
  |> filter(fn: (r) => r._measurement == "energy_usage")
  |> filter(fn: (r) => r.source == "{source}")
  |> filter(fn: (r) => r.type == "{src_type}")
  |> filter(fn: (r) => r._field == "{field}")
  |> aggregateWindow(every: 30s, fn: mean, createEmpty: false)
"""


async def _scalar(client: InfluxDBClientAsync, flux: str) -> float | None:
    query_api = client.query_api()
    tables = await query_api.query(flux, org=settings.INFLUXDB_ORG)
    for table in tables:
        for record in table.records:
            v = record.get_value()
            if v is not None:
                return float(v)
    return None


async def _series(
    client: InfluxDBClientAsync, flux: str
) -> tuple[list[str], list[float]]:
    query_api = client.query_api()
    tables = await query_api.query(flux, org=settings.INFLUXDB_ORG)
    labels: list[str] = []
    values: list[float] = []
    for table in tables:
        for record in table.records:
            ts = record.get_time()
            v = record.get_value()
            if ts is not None and v is not None:
                labels.append(
                    ts.strftime("%H:%M") if isinstance(ts, datetime) else str(ts)
                )
                values.append(round(float(v), 2))
    return labels, values


@router.get("/grafana-live")
async def get_grafana_live(_current_user: CurrentUser) -> dict[str, Any]:
    """
    Returns live InfluxDB sensor data merged into EnergyLatest shape.
    Falls back to live=False (empty) if InfluxDB is unreachable or misconfigured.
    """
    if not settings.INFLUXDB_TOKEN or not settings.INFLUXDB_ORG or not settings.INFLUXDB_BUCKET:
        logger.warning("InfluxDB not configured — INFLUXDB_TOKEN/ORG/BUCKET missing")
        return _EMPTY_RESPONSE

    try:
        async with InfluxDBClientAsync(
            url=settings.INFLUXDB_URL,
            token=settings.INFLUXDB_TOKEN,
            org=settings.INFLUXDB_ORG,
            timeout=5_000,
        ) as client:
            # Latest scalars (parallel-ish — all awaited sequentially but fast)
            solar_w   = await _scalar(client, _flux_last("generation_w", "array-01", "solar"))
            temp_c    = await _scalar(client, _flux_last("temp_c",       "unit-01",  "hvac"))
            setpt_c   = await _scalar(client, _flux_last("setpoint_c",   "unit-01",  "hwh"))
            net_w     = await _scalar(client, _flux_last("total_w",      "balance",  "net"))

            # Timeseries (solar + net balance for chart)
            s_labels, s_vals = await _series(client, _flux_history("generation_w", "array-01", "solar"))
            n_labels, n_vals = await _series(client, _flux_history("total_w",      "balance",  "net"))

            # Use solar labels as canonical x-axis (usually matches net)
            labels = s_labels or n_labels

        return {
            "latest": {
                "solar_current_power_w": solar_w,
                "ac_current_temp_c":     temp_c,
                "hwh_set_point_c":       setpt_c,
                "net_balance_w":         net_w,
            },
            "history": {
                "labels": labels,
                "solar":  s_vals,
                "net":    n_vals,
            },
            "live": True,
        }

    except Exception as exc:
        logger.warning("InfluxDB query failed: %s", exc)
        return _EMPTY_RESPONSE
```

- [ ] **Step 2: Verify file is syntactically valid**

```bash
cd backend && python -c "from app.api.v1.energy_influx import router; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/v1/energy_influx.py
git commit -m "feat(energy): add /energy/grafana-live InfluxDB endpoint"
```

---

## Task 3: Register the new router

**Files:**
- Modify: `backend/app/api/router.py`

- [ ] **Step 1: Add import and include_router**

In `backend/app/api/router.py`, the current import line is:

```python
from app.api.v1 import auth, items, locations, barcodes, scans, transactions, dashboard, imports, ai, users, chat, passkeys, energy, rfid
```

Change it to:

```python
from app.api.v1 import auth, items, locations, barcodes, scans, transactions, dashboard, imports, ai, users, chat, passkeys, energy, energy_influx, rfid
```

Then after `api_router.include_router(energy.router)` add:

```python
api_router.include_router(energy_influx.router)
```

- [ ] **Step 2: Start backend and verify route exists**

```bash
cd backend && uvicorn app.main:app --reload --port 8000
```

In a second terminal:

```bash
curl -s http://localhost:8000/api/v1/energy/grafana-live \
  -H "Authorization: Bearer YOUR_DEV_TOKEN" | python3 -m json.tool
```

Expected: JSON with `"live": false` (InfluxDB not yet configured with real token) or `"live": true` if token already set.

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/router.py
git commit -m "feat(energy): register energy_influx router"
```

---

## Task 4: Frontend types + API method

**Files:**
- Modify: `frontend/src/api/energy.ts`

- [ ] **Step 1: Add InfluxLiveData interface and API method**

Open `frontend/src/api/energy.ts`. After the existing `EnergyDashboardData` interface, add:

```typescript
export interface InfluxLatest {
  solar_current_power_w: number | null;
  ac_current_temp_c: number | null;
  hwh_set_point_c: number | null;
  net_balance_w: number | null;
}

export interface InfluxHistory {
  labels: string[];
  solar: number[];
  net: number[];
}

export interface InfluxLiveData {
  latest: InfluxLatest | null;
  history: InfluxHistory;
  live: boolean;
}
```

Then add to the `energyApi` object after `getDashboard`:

```typescript
  getGrafanaLive: async (): Promise<InfluxLiveData> => {
    const { data } = await apiClient.get<InfluxLiveData>("/energy/grafana-live");
    return data;
  },
```

- [ ] **Step 2: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors on `energy.ts`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/energy.ts
git commit -m "feat(energy): add InfluxLiveData type + getGrafanaLive API"
```

---

## Task 5: Update EnergyDashboard — second query, merge, new stat card, chart

**Files:**
- Modify: `frontend/src/pages/EnergyDashboard.tsx`

- [ ] **Step 1: Add second useQuery and merge logic**

At the top of `EnergyDashboard.tsx`, add the import:

```typescript
import { energyApi, type EnergyLatest, type InfluxLiveData } from "@/api/energy";
```

Inside the `EnergyDashboard` function, after the existing `useQuery` block (around line 232), add:

```typescript
const { data: influxData } = useQuery<InfluxLiveData>({
  queryKey: ["energy-grafana-live"],
  queryFn: () => energyApi.getGrafanaLive(),
  refetchInterval: 15_000,
  staleTime: 10_000,
});

// Merge: InfluxDB values override Postgres where non-null
const mergedLatest = latest
  ? {
      ...latest,
      solar_current_power_w:
        influxData?.latest?.solar_current_power_w ?? latest.solar_current_power_w,
      net_balance_w:
        influxData?.latest?.net_balance_w ?? latest.net_balance_w,
    }
  : latest;

const influxLive  = influxData?.live === true;
const anyLive     = influxLive || !!data?.live;
const indoorTempC = influxData?.latest?.ac_current_temp_c ?? null;
```

- [ ] **Step 2: Replace `latest` usages with `mergedLatest` in stat cards**

Find every reference to `latest?.solar_current_power_w` and `latest?.net_balance_w` in the JSX stat cards (lines ~360–400) and replace `latest` with `mergedLatest` for those two fields only. The other fields (`ac_current_temp_f`, `hwh_set_point_f`, etc.) continue to use `latest`.

Example — Solar Production card changes from:
```tsx
value={fmt(latest?.solar_current_power_w ?? 0)}
```
to:
```tsx
value={fmt(mergedLatest?.solar_current_power_w ?? 0)}
```

- [ ] **Step 3: Add Indoor Temp stat card**

In the 6-card grid (starts around line 349), add a 7th card after the Water Heater card:

```tsx
<StatCard
  icon={Thermometer}
  label="Indoor Temp"
  value={indoorTempC != null ? fmt(indoorTempC, 1) : "—"}
  unit="°C"
  accent="#06b6d4"
  sub="AC sensor · live"
/>
```

Update the grid class from `xl:grid-cols-6` to `xl:grid-cols-7` to accommodate 7 cards:
```tsx
<div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7 gap-3">
```

- [ ] **Step 4: Update the live badge to show InfluxDB source**

Find the live indicator div (around line 292). Replace the text content:

```tsx
{data?.live ? `Live · ${syncTime}` : "No data"}
```

with:

```tsx
{influxLive
  ? `InfluxDB · ${syncTime}`
  : data?.live
  ? `Live · ${syncTime}`
  : "No data"}
```

Then use `anyLive` (already defined in Step 1) instead of `data?.live` everywhere in the indicator div's style props and icon/text conditionals:

```tsx
style={{
  background: anyLive ? "rgba(52,211,153,0.08)" : "rgba(239,68,68,0.08)",
  border: `1px solid ${anyLive ? "rgba(52,211,153,0.25)" : "rgba(239,68,68,0.25)"}`,
  color: anyLive ? "#34d399" : "#f87171",
}}
>
  {anyLive ? <Wifi size={11} /> : <WifiOff size={11} />}
```

- [ ] **Step 5: Upgrade chart with InfluxDB timeseries**

Find `chartData` useMemo (around line 239). Replace it:

```typescript
const chartData = useMemo(() => {
  // Prefer InfluxDB history (30s resolution) over Postgres (5-min buckets)
  if (influxData?.history?.labels?.length) {
    return influxData.history.labels.map((label, i) => ({
      label,
      Solar: influxData.history.solar[i] ?? 0,
      "Net Balance": influxData.history.net[i] ?? 0,
    }));
  }
  // Fall back to Postgres history
  if (!history?.labels) return [];
  return history.labels.map((label, i) => ({
    label,
    Solar:       history.solar[i] ?? 0,
    "HVAC":      history.ac[i] ?? 0,
    "Water Htr": history.hwh[i] ?? 0,
    Total:       history.consumption[i] ?? 0,
  }));
}, [history, influxData]);
```

In the chart JSX, the `<Line>` components already handle `Solar`. Add a `Net Balance` line after the existing Solar line (only rendered when InfluxDB data is active):

```tsx
{influxLive && (
  <Line
    type="monotone"
    dataKey="Net Balance"
    stroke="#34d399"
    strokeWidth={2}
    strokeDasharray="4 2"
    dot={false}
    activeDot={{ r: 5, fill: "#34d399" }}
  />
)}
```

- [ ] **Step 6: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/EnergyDashboard.tsx
git commit -m "feat(energy): merge InfluxDB live data into energy hub + Indoor Temp card"
```

---

## Task 6: Add InfluxDB vars to Cloud Run / production

**Files:**
- Cloud Run service environment variables (via gcloud CLI)

- [ ] **Step 1: Set secrets in Cloud Run**

```bash
gcloud run services update inventory-backend \
  --region us-east-1 \
  --update-env-vars \
  INFLUXDB_URL=http://18.234.235.221:8086,\
  INFLUXDB_TOKEN=PASTE_TOKEN,\
  INFLUXDB_ORG=PASTE_ORG,\
  INFLUXDB_BUCKET=PASTE_BUCKET
```

- [ ] **Step 2: Verify deployment picks up vars**

```bash
gcloud run services describe inventory-backend --region us-east-1 \
  --format="value(spec.template.spec.containers[0].env)" | grep INFLUX
```

Expected: all 4 vars listed

- [ ] **Step 3: Hit prod endpoint to verify**

```bash
curl -s https://YOUR_CLOUD_RUN_URL/api/v1/energy/grafana-live \
  -H "Authorization: Bearer PROD_TOKEN" | python3 -m json.tool
```

Expected: `"live": true` with real wattage values (e.g. `"solar_current_power_w": 3300`)

---

## Task 7: End-to-end smoke test

- [ ] **Step 1: Open the energy hub in the browser**

Navigate to `/energy` in the app. Confirm:
- "Indoor Temp" stat card appears (7th card in the grid)
- Live badge shows "InfluxDB · HH:MM:SS"
- Solar card shows ~3300 W (not 0)
- Chart has Solar + Net Balance lines

- [ ] **Step 2: Kill the InfluxDB connection temporarily**

Set `INFLUXDB_TOKEN=""` in `.env`, restart backend. Confirm:
- Energy hub still loads (falls back to Postgres data)
- Live badge falls back to Postgres "Live" indicator
- No 500 errors in console

- [ ] **Step 3: Restore token, confirm recovery**

Restore token, restart. Confirm InfluxDB badge returns and values update.

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat(energy): InfluxDB live data integration complete"
```
