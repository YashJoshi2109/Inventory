# Energy Hub: InfluxDB Live Data Integration

**Date:** 2026-05-14  
**Status:** Approved

## Overview

Augment the existing EcoEnergy Hub with real-time data from the SEAR Lab's InfluxDB instance (the same data source Grafana uses). Backend queries InfluxDB directly; frontend merges results over existing Postgres data with a 15s poll interval.

## Architecture

```
InfluxDB (18.234.235.221:8086)
    │
    └── FastAPI GET /energy/grafana-live
            │  (falls back to empty on error)
            └── EnergyDashboard.tsx (useQuery, 15s)
                    │
                    ├── merges with existing /energy/dashboard (Postgres)
                    └── renders stat cards + chart
```

## Backend

**New file:** `backend/app/api/v1/energy_influx.py`  
Registered on the existing energy router as `GET /energy/grafana-live`.

**Dependencies:**
- Add `influxdb-client` to `requirements.txt`

**Env vars (added to `.env` and Cloud Run secrets):**
```
INFLUXDB_URL=http://18.234.235.221:8086
INFLUXDB_TOKEN=<token>
INFLUXDB_ORG=<org>
INFLUXDB_BUCKET=<bucket>
```

**InfluxDB → response field mapping:**

| InfluxDB field | measurement filter | Response key |
|---|---|---|
| `generation_w` | source=array-01, type=solar | `solar_current_power_w` |
| `temp_c` | source=unit-01, type=hvac | `ac_current_temp_c` |
| `setpoint_c` | source=unit-01, type=hwh | `hwh_set_point_c` (new) |
| `total_w` | source=balance, type=net | `net_balance_w` |

**Latest query:** Flux `last()` on each field — returns single scalar per metric.

**History query:** Flux `aggregateWindow(every: 10s, fn: mean)` over last 3 hours — returns timeseries arrays.

**Response shape** (mirrors `/energy/dashboard`):
```json
{
  "latest": {
    "solar_current_power_w": 3300,
    "ac_current_temp_c": 22.78,
    "hwh_set_point_c": 52.22,
    "net_balance_w": 2100
  },
  "history": {
    "labels": ["14:00", "14:01", ...],
    "solar": [3300, 3280, ...],
    "net": [2100, 2050, ...]
  },
  "live": true
}
```

**Error handling:** If InfluxDB is unreachable, returns `{ "live": false, "latest": null, "history": { ... empty arrays } }`. Never 500s.

**Auth:** Same `CurrentUser` dependency as existing energy endpoints.

## Frontend

**`frontend/src/api/energy.ts`**
- Add `InfluxLiveData` interface
- Add `energyApi.getGrafanaLive()` → `GET /energy/grafana-live`

**`frontend/src/pages/EnergyDashboard.tsx`**
- Second `useQuery` key `["energy-grafana-live"]`, `refetchInterval: 15_000`
- Merge strategy: InfluxDB values override Postgres for overlapping fields (`solar_current_power_w`, `net_balance_w`)
- New stat card: **Indoor Temp** (`ac_current_temp_c`, unit °C, accent `#0088ff`)
- Chart: when InfluxDB history available, use it for Solar + Net series (higher resolution than Postgres 5-min buckets)
- Live badge: shows `InfluxDB · Live` (green) when `influxData?.live === true`, else falls back to Postgres badge

## Data Flow

```
Every 15s:
  1. useQuery["energy-dashboard"]     → GET /energy/dashboard    (Postgres, existing)
  2. useQuery["energy-grafana-live"]  → GET /energy/grafana-live (InfluxDB, new)
  3. Merge: influx fields take precedence where non-null
  4. Render stat cards + chart from merged data
```

## Files Changed

| File | Change |
|---|---|
| `backend/app/api/v1/energy_influx.py` | New — InfluxDB query logic + route |
| `backend/app/api/v1/energy.py` | Register new router |
| `backend/app/main.py` | Include influx router (if separate) |
| `requirements.txt` | Add `influxdb-client` |
| `.env` | Add 4 INFLUXDB_* vars |
| `frontend/src/api/energy.ts` | Add interface + API method |
| `frontend/src/pages/EnergyDashboard.tsx` | Second query, merge, new stat card, updated chart |

## Out of Scope

- Writing back to InfluxDB
- Replacing Postgres pipeline
- Historical data beyond 3 hours from InfluxDB
- AC control / HWH control via InfluxDB
