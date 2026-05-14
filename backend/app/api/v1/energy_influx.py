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
from datetime import datetime
from typing import Any

from fastapi import APIRouter
from influxdb_client.client.influxdb_client_async import InfluxDBClientAsync

from app.api.v1.auth import CurrentUser
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/energy", tags=["energy"])

_EMPTY_RESPONSE: dict[str, Any] = {
    "latest": None,
    "history": {"labels": [], "solar": [], "net": []},
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
    Returns live InfluxDB sensor data in EnergyLatest-compatible shape.
    Falls back to live=False (empty) if InfluxDB is unreachable or unconfigured.
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
            solar_w = await _scalar(client, _flux_last("generation_w", "array-01", "solar"))
            temp_c  = await _scalar(client, _flux_last("temp_c",       "unit-01",  "hvac"))
            setpt_c = await _scalar(client, _flux_last("setpoint_c",   "unit-01",  "hwh"))
            net_w   = await _scalar(client, _flux_last("total_w",      "balance",  "net"))

            s_labels, s_vals = await _series(client, _flux_history("generation_w", "array-01", "solar"))
            n_labels, n_vals = await _series(client, _flux_history("total_w",      "balance",  "net"))

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
