"""The energy hub payloads, as the lab's dashboard served them on 2026-10-29, reshaped."""
from datetime import timezone

from app.api.v1.energy_hub import history_from_hub, latest_from_hub

DATA = {
    "timestamp": "2026-10-29T18:10:17.550247",
    "timestamp_utc": "2026-10-29T18:10:17+00:00",
    "ac": {"device_name": "LG AC (Offline)", "power_mode": "OFFLINE", "current_temp_f": None,
           "target_temp_f": None, "current_temp_c": None, "target_temp_c": None,
           "power_w": None, "energy_kwh": None},
    "hwh": {"device_name": "Rheem Water Heater", "set_point_f": 125, "mode": "ENERGY_SAVING",
            "running": False, "tank_health": 100, "energy_kwh": 0.4, "current_power_w": 0.0,
            "compressor_health": 100, "connected": True},
    "solar": {"current_power_w": None, "energy_lifetime_wh": None, "status": "offline"},
}

HISTORY = [
    {"timestamp": "2026-10-29T18:10:17", "solar_current_power_w": None, "hwh_current_power_w": 0.0,
     "ac_mode": "OFFLINE", "hwh_running": False},
    {"timestamp": "2026-10-29T17:10:17", "solar_current_power_w": 812.5, "hwh_current_power_w": 4500.0,
     "ac_mode": "COOL", "hwh_running": True},
    {"timestamp": "not a date"},
]


def test_latest_uses_utc_timestamp_and_treats_offline_ac_as_zero_watts():
    row = latest_from_hub(DATA, ac_run_w=1500)
    assert row is not None
    assert row["timestamp"].tzinfo == timezone.utc
    assert row["timestamp"].hour == 18
    # An offline air conditioner must not be booked at nameplate power.
    assert row["ac_consumption_w"] == 0.0
    assert row["hwh_set_point_f"] == 125
    assert row["hwh_todays_energy_kwh"] == 0.4
    assert row["hwh_consumption_w"] == 0.0
    assert row["solar_current_power_w"] == 0.0
    assert row["solar_system_status"] == "offline"


def test_latest_without_timestamp_is_none():
    assert latest_from_hub({"ac": {}, "hwh": {}, "solar": {}}, ac_run_w=1500) is None


def test_history_is_sorted_oldest_first_and_estimates_ac_from_mode():
    rows = history_from_hub(HISTORY, ac_run_w=1500)
    assert [r["timestamp"].hour for r in rows] == [17, 18]      # the unparseable row is dropped
    assert rows[0]["ac_consumption_w"] == 1500                  # COOL, no meter: nameplate estimate
    assert rows[1]["ac_consumption_w"] == 0.0                   # OFFLINE
    assert rows[0]["solar_current_power_w"] == 812.5
    assert rows[0]["hwh_consumption_w"] == 4500.0


def test_failed_refresh_is_shared_for_retry_window(monkeypatch):
    """Requests queued behind a failed fetch reuse its outcome instead of each timing out."""
    import asyncio
    from app.api.v1 import energy_hub as hub

    calls = {"n": 0}

    class _Client:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **k):
            calls["n"] += 1
            raise ConnectionError("down")

    monkeypatch.setattr(hub.httpx, "AsyncClient", _Client)
    monkeypatch.setitem(hub._cache, "data", None)
    monkeypatch.setitem(hub._cache, "failed_at", None)

    async def run():
        return await asyncio.gather(*(hub.fetch_hub("http://hub.test", hours=1, timeout_s=1) for _ in range(5)))

    results = asyncio.run(run())
    assert results == [None] * 5
    assert calls["n"] == 2          # one attempt (two GETs); the other four shared the failure
