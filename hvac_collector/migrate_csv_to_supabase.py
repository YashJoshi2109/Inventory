#!/usr/bin/env python3
"""
CSV → Supabase Migration
Reads the historical energy_data.csv and bulk-inserts every row into the
`energy_readings` Supabase table.

Usage:
    cd hvac_collector
    python migrate_csv_to_supabase.py                     # uses energy_data.csv
    python migrate_csv_to_supabase.py path/to/other.csv   # custom path

Prerequisites:
  1. energy_readings table created (run MIGRATION_SQL from supabase_writer.py)
  2. SUPABASE_URL and SUPABASE_SERVICE_KEY set in ../.env or .env
"""

import sys
import math
import os
from datetime import datetime
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

# Load from parent .env (the Inventory repo root) first, then local
load_dotenv(Path(__file__).parent.parent / ".env")
load_dotenv(Path(__file__).parent / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

CSV_PATH = sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / "energy_data.csv"

# Power constants (keep in sync with supabase_writer.py and energy.py)
AC_RUN_POWER   = 1500
HWH_RUN_POWER  = 4500
HWH_IDLE_POWER = 5
BASE_LOAD      = 200
BREAKER_EST    = 300

BATCH_SIZE = 50  # rows per Supabase insert call


def _clean(val):
    """Coerce NaN/inf/None/empty strings to None for Postgres."""
    if val is None:
        return None
    if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
        return None
    if isinstance(val, str) and val.strip().lower() in ("", "nan", "none", "null"):
        return None
    return val


def _to_bool(val):
    if val is None:
        return None
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.strip().lower() in ("true", "1", "yes")
    return bool(val)


def _compute_wattage(ac_power_mode, hwh_running, solar_w):
    ac_w  = AC_RUN_POWER if ac_power_mode not in (None, "POWER_OFF", "nan", "None", "") else 0
    hwh_w = HWH_RUN_POWER if hwh_running else HWH_IDLE_POWER
    total = ac_w + hwh_w + BASE_LOAD + BREAKER_EST
    solar = float(solar_w or 0)
    return {
        "ac_consumption_w":    float(ac_w),
        "hwh_consumption_w":   float(hwh_w),
        "total_consumption_w": float(total),
        "net_balance_w":       float(solar - total),
    }


def row_to_record(r) -> dict:
    ts_raw = r.get("timestamp")
    try:
        ts = datetime.fromisoformat(str(ts_raw)).isoformat()
    except Exception:
        ts = datetime.utcnow().isoformat()

    ac_mode   = _clean(r.get("ac_power_mode"))
    hwh_run   = _to_bool(_clean(r.get("hwh_running")))
    solar_w   = _clean(r.get("solar_current_power_w"))
    try:
        solar_w = float(solar_w) if solar_w is not None else None
    except (ValueError, TypeError):
        solar_w = None

    wattage = _compute_wattage(ac_mode, hwh_run, solar_w)

    def f(col):
        v = _clean(r.get(col))
        if v is None:
            return None
        try:
            return float(v)
        except (ValueError, TypeError):
            return None

    return {
        "timestamp":                ts,
        "ac_device_name":           _clean(r.get("ac_device_name")),
        "ac_power_mode":            ac_mode,
        "ac_operation_mode":        _clean(r.get("ac_operation_mode")),
        "ac_run_state":             _clean(r.get("ac_run_state")),
        "ac_current_temp_c":        f("ac_current_temp_c"),
        "ac_target_temp_c":         f("ac_target_temp_c"),
        "ac_current_temp_f":        f("ac_current_temp_f"),
        "ac_target_temp_f":         f("ac_target_temp_f"),
        "ac_fan_speed":             _clean(r.get("ac_fan_speed")),
        "ac_recommendation":        _clean(r.get("ac_recommendation")),
        "ac_consumption_w":         wattage["ac_consumption_w"],
        "hwh_set_point_f":          f("hwh_set_point_f"),
        "hwh_mode":                 _clean(r.get("hwh_mode")),
        "hwh_mode_name":            _clean(r.get("hwh_mode_name")),
        "hwh_running":              hwh_run,
        "hwh_tank_health":          f("hwh_tank_health"),
        "hwh_compressor_health":    f("hwh_compressor_health"),
        "hwh_todays_energy_kwh":    f("hwh_todays_energy_kwh"),
        "hwh_connected":            _to_bool(_clean(r.get("hwh_connected"))),
        "hwh_recommendation":       _clean(r.get("hwh_recommendation")),
        "hwh_consumption_w":        wattage["hwh_consumption_w"],
        "solar_current_power_w":    solar_w,
        "solar_energy_lifetime_wh": f("solar_energy_lifetime_wh"),
        "solar_system_status":      _clean(r.get("solar_system_status")),
        "total_consumption_w":      wattage["total_consumption_w"],
        "net_balance_w":            wattage["net_balance_w"],
        "overall_recommendation":   _clean(r.get("overall_recommendation")),
        "recommendation_reason":    _clean(r.get("recommendation_reason")),
    }


def migrate():
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("✗ SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env")
        sys.exit(1)

    csv_path = Path(CSV_PATH)
    if not csv_path.exists():
        print(f"✗ CSV not found: {csv_path}")
        sys.exit(1)

    print(f"📂 Reading {csv_path} ...")
    df = pd.read_csv(csv_path, low_memory=False)
    total = len(df)
    print(f"   {total} rows found\n")

    from supabase import create_client  # type: ignore
    client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    records = [row_to_record(row) for _, row in df.iterrows()]

    inserted = 0
    errors = 0
    for i in range(0, total, BATCH_SIZE):
        batch = records[i : i + BATCH_SIZE]
        try:
            client.table("energy_readings").insert(batch).execute()
            inserted += len(batch)
            print(f"  ✓ Inserted rows {i + 1}–{min(i + BATCH_SIZE, total)} ({inserted}/{total})")
        except Exception as e:
            errors += len(batch)
            print(f"  ✗ Batch {i}–{i + BATCH_SIZE} failed: {e}")

    print(f"\n{'='*50}")
    print(f"Migration complete: {inserted} inserted, {errors} failed")
    print(f"{'='*50}")


if __name__ == "__main__":
    migrate()
