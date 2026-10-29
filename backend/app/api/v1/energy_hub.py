"""
Energy hub upstream: the lab's standalone HVAC dashboard
(https://github.com/sear-labs/lab-energy-monitoring).

That program polls the LG ThinQ air conditioner, the Rheem EcoNet water heater
and the Enphase inverter itself and serves ``/api/data`` (the latest reading)
and ``/api/history`` (its SQLite tiers). This module fetches both and reshapes
them into the ``energy_readings`` row layout that ``/energy/dashboard`` already
returns, so the React Energy Hub shows the live lab without a separate
collector writing to Postgres.

The in-process cache is deliberate: the hub runs on Render's free tier, which
sleeps when idle and takes tens of seconds to wake. A recent payload is served
while a refresh runs; ``None`` comes back only when nothing has ever been
fetched, and the router then falls back to the ``energy_readings`` table.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

#: Modes the hub reports when the air conditioner is drawing nothing. Anything
#: else without a measured wattage is assumed to run at the nameplate figure the
#: caller passes in (the same assumption ``energy.py`` makes for Postgres rows).
_AC_OFF_MODES = {"", "NONE", "OFF", "OFFLINE", "POWER_OFF", "STANDBY"}

#: How long a fetched payload is reused before another request to the hub.
FRESH_SECONDS = 60
#: How long a stale payload is still served when the hub does not answer.
STALE_SECONDS = 15 * 60
#: After a failed fetch, how long further requests reuse that outcome instead of
#: each waiting out the timeout in turn behind the lock.
RETRY_AFTER_SECONDS = 30


def _num(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _ac_watts(power_w: Any, mode: Any, ac_run_w: float) -> float:
    measured = _num(power_w)
    if measured is not None:
        return measured
    return 0.0 if str(mode or "").upper() in _AC_OFF_MODES else float(ac_run_w)


def _parse_ts(value: Any) -> datetime | None:
    """The hub's timestamps are ISO 8601, naive ones in UTC."""
    if not isinstance(value, str) or not value:
        return None
    try:
        ts = datetime.fromisoformat(value)
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def latest_from_hub(data: dict[str, Any], *, ac_run_w: float) -> dict[str, Any] | None:
    """Reshape ``/api/data`` into an ``energy_readings``-style row.

    Returns None when the payload carries no timestamp, which is what the hub
    sends before its first collection cycle.
    """
    ts = _parse_ts(data.get("timestamp_utc") or data.get("timestamp"))
    if ts is None:
        return None
    ac = data.get("ac") or {}
    hwh = data.get("hwh") or {}
    solar = data.get("solar") or {}
    return {
        "timestamp": ts,
        "ac_device_name": ac.get("device_name"),
        "ac_power_mode": ac.get("power_mode"),
        "ac_operation_mode": None,
        "ac_run_state": None,
        "ac_current_temp_c": _num(ac.get("current_temp_c")),
        "ac_target_temp_c": _num(ac.get("target_temp_c")),
        "ac_current_temp_f": _num(ac.get("current_temp_f")),
        "ac_target_temp_f": _num(ac.get("target_temp_f")),
        "ac_fan_speed": None,
        "ac_consumption_w": _ac_watts(ac.get("power_w"), ac.get("power_mode"), ac_run_w),
        "hwh_set_point_f": _num(hwh.get("set_point_f")),
        "hwh_mode": hwh.get("mode"),
        "hwh_mode_name": hwh.get("mode"),
        "hwh_running": bool(hwh.get("running")),
        "hwh_tank_health": _num(hwh.get("tank_health")),
        "hwh_compressor_health": _num(hwh.get("compressor_health")),
        "hwh_todays_energy_kwh": _num(hwh.get("energy_kwh")),
        "hwh_connected": bool(hwh.get("connected", True)),
        "hwh_consumption_w": _num(hwh.get("current_power_w")) or 0.0,
        "solar_current_power_w": _num(solar.get("current_power_w")) or 0.0,
        "solar_energy_lifetime_wh": _num(solar.get("energy_lifetime_wh")),
        "solar_system_status": solar.get("status"),
        "overall_recommendation": None,
        "recommendation_reason": None,
    }


def history_from_hub(rows: list[dict[str, Any]], *, ac_run_w: float) -> list[dict[str, Any]]:
    """Reshape ``/api/history`` rows, oldest first, dropping any without a timestamp."""
    out: list[dict[str, Any]] = []
    for row in rows:
        ts = _parse_ts(row.get("timestamp"))
        if ts is None:
            continue
        out.append({
            "timestamp": ts,
            "ac_power_mode": row.get("ac_mode"),
            "ac_consumption_w": _ac_watts(None, row.get("ac_mode"), ac_run_w),
            "hwh_running": bool(row.get("hwh_running")),
            "hwh_consumption_w": _num(row.get("hwh_current_power_w")) or 0.0,
            "solar_current_power_w": _num(row.get("solar_current_power_w")) or 0.0,
        })
    out.sort(key=lambda r: r["timestamp"])
    return out


# ── Fetching, with a stale-while-revalidate cache ───────────────────────────

_cache: dict[str, Any] = {"at": 0.0, "hours": 0, "data": None, "history": None, "failed_at": None}
_lock = asyncio.Lock()


def _cached_or_none(now: float) -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
    """What a failed refresh returns: the last payload while it is recent, else None."""
    stale_ok = _cache["data"] is not None and now - _cache["at"] < STALE_SECONDS
    return (_cache["data"], _cache["history"]) if stale_ok else None


async def fetch_hub(
    base_url: str, *, hours: int, timeout_s: float
) -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
    """Return ``(data, history_rows)`` from the hub, or None if it is unreachable and nothing is cached."""
    base = base_url.rstrip("/")
    if not base:
        return None
    now = time.monotonic()
    fresh = _cache["data"] is not None and now - _cache["at"] < FRESH_SECONDS and _cache["hours"] >= hours
    if fresh:
        return _cache["data"], _cache["history"]

    async with _lock:
        now = time.monotonic()
        if _cache["data"] is not None and now - _cache["at"] < FRESH_SECONDS and _cache["hours"] >= hours:
            return _cache["data"], _cache["history"]
        # Requests that queued behind a refresh that just failed share its
        # outcome; otherwise each would wait out the timeout in turn.
        failed_at = _cache["failed_at"]
        if failed_at is not None and now - failed_at < RETRY_AFTER_SECONDS:
            return _cached_or_none(now)
        try:
            async with httpx.AsyncClient(timeout=timeout_s) as client:
                data_res, hist_res = await asyncio.gather(
                    client.get(f"{base}/api/data"),
                    client.get(f"{base}/api/history", params={"limit": max(60, hours * 60)}),
                )
            data_res.raise_for_status()
            hist_res.raise_for_status()
            data = data_res.json()
            history = hist_res.json().get("data") or []
            if not isinstance(data, dict) or not isinstance(history, list):
                raise ValueError("unexpected payload shape")
        except Exception as exc:  # noqa: BLE001 — any failure means "use what we have"
            _cache["failed_at"] = time.monotonic()
            cached = _cached_or_none(_cache["failed_at"])
            logger.warning("Energy hub %s unreachable (%s); %s", base, exc,
                           "serving cached payload" if cached else "falling back to Postgres")
            return cached
        _cache.update({"at": time.monotonic(), "hours": hours, "data": data, "history": history,
                       "failed_at": None})
        return data, history
