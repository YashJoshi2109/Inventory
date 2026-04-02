"""
Energy Dashboard API
Exposes energy readings stored in Supabase (energy_readings table).
The HVAC Python collector writes directly to Supabase; this router reads it back
for the React dashboard using the same SQLAlchemy connection pool.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Query
from sqlalchemy import text

from app.api.v1.auth import CurrentUser
from app.core.database import DbSession

router = APIRouter(prefix="/energy", tags=["energy"])

# ── Power constants (kept in sync with dashboard_data.py) ─────────────────────
AC_RUN_POWER   = 1500   # W
HWH_RUN_POWER  = 4500   # W
HWH_IDLE_POWER = 5      # W
BASE_LOAD      = 200    # W
BREAKER_EST    = 300    # W


def _derive(row: dict[str, Any]) -> dict[str, Any]:
    """Add computed wattage / net-balance fields if the DB row lacks them."""
    ac_mode = str(row.get("ac_power_mode") or "")
    ac_w = row.get("ac_consumption_w") or (
        AC_RUN_POWER if ac_mode not in ("POWER_OFF", "nan", "None", "") else 0
    )
    hwh_running = row.get("hwh_running") in (True, "true", "True", 1)
    hwh_w = row.get("hwh_consumption_w") or (
        HWH_RUN_POWER if hwh_running else HWH_IDLE_POWER
    )
    total_w = row.get("total_consumption_w") or (ac_w + hwh_w + BASE_LOAD + BREAKER_EST)
    solar_w = float(row.get("solar_current_power_w") or 0)
    net_w   = row.get("net_balance_w") or (solar_w - total_w)

    return {
        **row,
        "ac_consumption_w":    round(ac_w, 2),
        "hwh_consumption_w":   round(hwh_w, 2),
        "total_consumption_w": round(total_w, 2),
        "net_balance_w":       round(net_w, 2),
        "solar_current_power_w": round(solar_w, 2),
    }


def _clean(val: Any) -> Any:
    """Replace NaN / None with 0 for numeric fields."""
    if val is None:
        return 0
    try:
        f = float(val)
        import math
        return 0 if math.isnan(f) else f
    except (TypeError, ValueError):
        return val


def _row_to_dict(row: Any) -> dict[str, Any]:
    """Convert a SQLAlchemy Row to a plain dict, cleaning numerics."""
    d = dict(row._mapping)  # type: ignore[attr-defined]
    return {k: _clean(v) if isinstance(v, (int, float)) else v for k, v in d.items()}


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/dashboard")
async def get_dashboard(
    session: DbSession,
    _current_user: CurrentUser,
    hours: int = Query(default=24, ge=1, le=168),
) -> dict[str, Any]:
    """
    Single endpoint that returns latest reading + chart history + summary stats.
    Matches the shape consumed by the React EnergyDashboard component.
    """
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    # ── Latest reading ─────────────────────────────────────────────────────────
    latest_result = await session.execute(
        text("""
            SELECT *
            FROM energy_readings
            ORDER BY timestamp DESC
            LIMIT 1
        """)
    )
    latest_row = latest_result.fetchone()

    if not latest_row:
        return {
            "latest": None,
            "history": {"labels": [], "solar": [], "ac": [], "hwh": [], "consumption": [], "net": []},
            "stats": {"solar_peak_today": 0, "total_consumption_avg": 0, "savings_status": "UNKNOWN"},
            "live": False,
        }

    latest = _derive(_row_to_dict(latest_row))
    if isinstance(latest.get("timestamp"), datetime):
        latest["timestamp"] = latest["timestamp"].strftime("%Y-%m-%d %H:%M:%S")

    # ── Historical data for chart ──────────────────────────────────────────────
    history_result = await session.execute(
        text("""
            SELECT
                timestamp,
                solar_current_power_w,
                ac_consumption_w,
                hwh_consumption_w,
                total_consumption_w,
                net_balance_w,
                ac_power_mode,
                hwh_running
            FROM energy_readings
            WHERE timestamp >= :since
            ORDER BY timestamp ASC
            LIMIT 288
        """),
        {"since": since},
    )
    history_rows = [_row_to_dict(r) for r in history_result.fetchall()]
    history_rows = [_derive(r) for r in history_rows]

    def fmt_label(ts: Any) -> str:
        if isinstance(ts, datetime):
            return ts.strftime("%H:%M")
        if isinstance(ts, str):
            try:
                return datetime.fromisoformat(ts).strftime("%H:%M")
            except ValueError:
                return str(ts)
        return str(ts)

    history = {
        "labels":      [fmt_label(r["timestamp"]) for r in history_rows],
        "solar":       [r["solar_current_power_w"] for r in history_rows],
        "ac":          [r["ac_consumption_w"] for r in history_rows],
        "hwh":         [r["hwh_consumption_w"] for r in history_rows],
        "consumption": [r["total_consumption_w"] for r in history_rows],
        "net":         [r["net_balance_w"] for r in history_rows],
    }

    # ── Today's summary stats ──────────────────────────────────────────────────
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    stats_result = await session.execute(
        text("""
            SELECT
                MAX(solar_current_power_w) AS solar_peak_today,
                AVG(total_consumption_w)   AS total_consumption_avg
            FROM energy_readings
            WHERE timestamp >= :today
        """),
        {"today": today_start},
    )
    stats_row = stats_result.fetchone()
    solar_peak = float(stats_row.solar_peak_today or 0) if stats_row else 0
    cons_avg   = float(stats_row.total_consumption_avg or 0) if stats_row else 0

    net_balance = float(latest.get("net_balance_w", 0))

    return {
        "latest":  latest,
        "history": history,
        "stats": {
            "solar_peak_today":       round(solar_peak, 1),
            "total_consumption_avg":  round(cons_avg, 1),
            "savings_status":         "SURPLUS" if net_balance >= 0 else "DEFICIT",
        },
        "live": True,
    }


@router.get("/latest")
async def get_latest(session: DbSession, _current_user: CurrentUser) -> dict[str, Any]:
    """Return only the latest reading."""
    result = await session.execute(
        text("SELECT * FROM energy_readings ORDER BY timestamp DESC LIMIT 1")
    )
    row = result.fetchone()
    if not row:
        return {}
    return _derive(_row_to_dict(row))


@router.post("/readings", status_code=201)
async def create_reading(
    payload: dict[str, Any],
    session: DbSession,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    """
    Insert a new energy reading row.
    Called by the HVAC Python collector as an alternative to direct Supabase writes.
    """
    cols = [c for c in payload if c != "id"]
    placeholders = ", ".join(f":{c}" for c in cols)
    col_str = ", ".join(cols)

    await session.execute(
        text(f"INSERT INTO energy_readings ({col_str}) VALUES ({placeholders})"),
        payload,
    )
    return {"ok": True}
