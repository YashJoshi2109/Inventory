#!/usr/bin/env python3
"""
Supabase Writer
Replaces CSV persistence for the HVAC energy data collector.
Writes each reading row to the `energy_readings` table in Supabase Postgres.

Requirements:
    pip install supabase

Environment variables (add to .env):
    SUPABASE_URL=https://xxxx.supabase.co
    SUPABASE_SERVICE_KEY=eyJ...   # use service_role key (bypasses RLS)
"""

import math
import os
from datetime import datetime
from typing import Any

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

# Power constants (keep in sync with dashboard_data.py and energy.py)
AC_RUN_POWER   = 1500
HWH_RUN_POWER  = 4500
HWH_IDLE_POWER = 5
BASE_LOAD      = 200
BREAKER_EST    = 300


def _get_client():
    """Lazily initialise the Supabase client."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise EnvironmentError(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env"
        )
    from supabase import create_client  # type: ignore
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def _clean(val: Any) -> Any:
    """Convert NaN / inf / None to None so Postgres accepts the value."""
    if val is None:
        return None
    if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
        return None
    return val


def _compute_wattage(
    ac_power_mode: str | None,
    hwh_running: bool | None,
    solar_current_power_w: float | None,
) -> dict[str, float]:
    """Derive consumption / balance from raw API values."""
    ac_w   = AC_RUN_POWER if (ac_power_mode not in (None, "POWER_OFF", "nan", "None", "")) else 0
    hwh_w  = HWH_RUN_POWER if hwh_running else HWH_IDLE_POWER
    total  = ac_w + hwh_w + BASE_LOAD + BREAKER_EST
    solar  = float(solar_current_power_w or 0)
    net    = solar - total
    return {
        "ac_consumption_w":    float(ac_w),
        "hwh_consumption_w":   float(hwh_w),
        "total_consumption_w": float(total),
        "net_balance_w":       float(net),
    }


def write_reading(
    *,
    timestamp: datetime | None = None,
    # AC
    ac_device_name: str | None = None,
    ac_power_mode: str | None = None,
    ac_operation_mode: str | None = None,
    ac_run_state: str | None = None,
    ac_current_temp_c: float | None = None,
    ac_target_temp_c: float | None = None,
    ac_current_temp_f: float | None = None,
    ac_target_temp_f: float | None = None,
    ac_fan_speed: str | None = None,
    ac_recommendation: str | None = None,
    # HWH
    hwh_set_point_f: float | None = None,
    hwh_mode: str | None = None,
    hwh_mode_name: str | None = None,
    hwh_running: bool | None = None,
    hwh_tank_health: float | None = None,
    hwh_compressor_health: float | None = None,
    hwh_todays_energy_kwh: float | None = None,
    hwh_connected: bool | None = None,
    hwh_recommendation: str | None = None,
    # Solar
    solar_current_power_w: float | None = None,
    solar_energy_lifetime_wh: float | None = None,
    solar_system_status: str | None = None,
    # Recommendations
    overall_recommendation: str | None = None,
    recommendation_reason: str | None = None,
) -> dict[str, Any]:
    """
    Insert one reading into energy_readings.
    Returns the inserted row (Supabase returns the full row with id + timestamp).
    """
    wattage = _compute_wattage(ac_power_mode, hwh_running, solar_current_power_w)

    row = {
        "timestamp":               (timestamp or datetime.utcnow()).isoformat(),
        # AC
        "ac_device_name":          _clean(ac_device_name),
        "ac_power_mode":           _clean(ac_power_mode),
        "ac_operation_mode":       _clean(ac_operation_mode),
        "ac_run_state":            _clean(ac_run_state),
        "ac_current_temp_c":       _clean(ac_current_temp_c),
        "ac_target_temp_c":        _clean(ac_target_temp_c),
        "ac_current_temp_f":       _clean(ac_current_temp_f),
        "ac_target_temp_f":        _clean(ac_target_temp_f),
        "ac_fan_speed":            _clean(ac_fan_speed),
        "ac_recommendation":       _clean(ac_recommendation),
        "ac_consumption_w":        wattage["ac_consumption_w"],
        # HWH
        "hwh_set_point_f":         _clean(hwh_set_point_f),
        "hwh_mode":                _clean(hwh_mode),
        "hwh_mode_name":           _clean(hwh_mode_name),
        "hwh_running":             bool(hwh_running) if hwh_running is not None else None,
        "hwh_tank_health":         _clean(hwh_tank_health),
        "hwh_compressor_health":   _clean(hwh_compressor_health),
        "hwh_todays_energy_kwh":   _clean(hwh_todays_energy_kwh),
        "hwh_connected":           bool(hwh_connected) if hwh_connected is not None else None,
        "hwh_recommendation":      _clean(hwh_recommendation),
        "hwh_consumption_w":       wattage["hwh_consumption_w"],
        # Solar
        "solar_current_power_w":   _clean(solar_current_power_w),
        "solar_energy_lifetime_wh":_clean(solar_energy_lifetime_wh),
        "solar_system_status":     _clean(solar_system_status),
        # Computed
        "total_consumption_w":     wattage["total_consumption_w"],
        "net_balance_w":           wattage["net_balance_w"],
        # Recommendations
        "overall_recommendation":  _clean(overall_recommendation),
        "recommendation_reason":   _clean(recommendation_reason),
    }

    client = _get_client()
    response = client.table("energy_readings").insert(row).execute()
    inserted = response.data[0] if response.data else row
    print(f"✓ Supabase: wrote reading at {row['timestamp']} | solar={solar_current_power_w}W | net={wattage['net_balance_w']:.0f}W")
    return inserted


def fetch_latest() -> dict[str, Any] | None:
    """Fetch the most recent row from Supabase (for sanity checks)."""
    client = _get_client()
    response = (
        client.table("energy_readings")
        .select("*")
        .order("timestamp", desc=True)
        .limit(1)
        .execute()
    )
    return response.data[0] if response.data else None


def fetch_history(hours: int = 24) -> list[dict[str, Any]]:
    """Fetch the last N hours of readings ordered ascending."""
    from datetime import timedelta, timezone
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    client = _get_client()
    response = (
        client.table("energy_readings")
        .select("timestamp,solar_current_power_w,ac_consumption_w,hwh_consumption_w,total_consumption_w,net_balance_w")
        .gte("timestamp", since)
        .order("timestamp", desc=False)
        .limit(288)
        .execute()
    )
    return response.data or []


# ── SQL Migration helper ───────────────────────────────────────────────────────

MIGRATION_SQL = """
-- Run this once in your Supabase SQL editor
CREATE TABLE IF NOT EXISTS energy_readings (
    id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    timestamp                 timestamptz NOT NULL DEFAULT now(),
    -- AC (LG ThinQ)
    ac_device_name            text,
    ac_power_mode             text,
    ac_operation_mode         text,
    ac_run_state              text,
    ac_current_temp_c         double precision,
    ac_target_temp_c          double precision,
    ac_current_temp_f         double precision,
    ac_target_temp_f          double precision,
    ac_fan_speed              text,
    ac_recommendation         text,
    ac_consumption_w          double precision DEFAULT 0,
    -- Water Heater (Rheem EcoNet)
    hwh_set_point_f           double precision,
    hwh_mode                  text,
    hwh_mode_name             text,
    hwh_running               boolean DEFAULT false,
    hwh_tank_health           double precision,
    hwh_compressor_health     double precision,
    hwh_todays_energy_kwh     double precision,
    hwh_connected             boolean DEFAULT true,
    hwh_recommendation        text,
    hwh_consumption_w         double precision DEFAULT 0,
    -- Solar (Enphase)
    solar_current_power_w     double precision DEFAULT 0,
    solar_energy_lifetime_wh  double precision,
    solar_system_status       text,
    -- Computed
    total_consumption_w       double precision DEFAULT 0,
    net_balance_w             double precision DEFAULT 0,
    -- Recommendations
    overall_recommendation    text,
    recommendation_reason     text
);

-- Index for fast time-range queries
CREATE INDEX IF NOT EXISTS idx_energy_readings_timestamp
    ON energy_readings (timestamp DESC);

-- Row Level Security: allow service_role full access, authenticated users read-only
ALTER TABLE energy_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "service_role_all" ON energy_readings
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "authenticated_read" ON energy_readings
    FOR SELECT TO authenticated USING (true);
"""

if __name__ == "__main__":
    print("=== Supabase Writer Test ===")
    print()
    print("Migration SQL to run in Supabase SQL editor:")
    print(MIGRATION_SQL)
    print()
    print("Testing connection and write...")
    try:
        result = write_reading(
            ac_power_mode="COOL",
            ac_current_temp_f=72.0,
            ac_target_temp_f=70.0,
            hwh_running=False,
            hwh_set_point_f=120.0,
            solar_current_power_w=2500.0,
            overall_recommendation="Running optimally on solar power.",
            recommendation_reason="Solar surplus available — good time to run high-load appliances.",
        )
        print(f"✓ Write successful: id={result.get('id')}")
        latest = fetch_latest()
        print(f"✓ Read back: {latest}")
    except Exception as e:
        print(f"✗ Error: {e}")
