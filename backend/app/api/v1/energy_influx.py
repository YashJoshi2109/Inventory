"""
GET /energy/grafana-live
Queries InfluxDB via the Grafana /api/ds/query proxy endpoint.
InfluxDB is Docker-internal (http://influxdb:8086); Grafana at port 3000
is the only externally-reachable gateway.

InfluxDB schema:
  measurement: energy_usage
  tags: source_id (array-01 | unit-01 | balance), source_type (solar | hvac | hwh | net)
  fields: generation_w, temp_c, target_c, setpoint_c, total_w, status
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter

from app.api.v1.auth import CurrentUser
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/energy", tags=["energy"])

_EMPTY_RESPONSE: dict[str, Any] = {
    "latest": None,
    "history": {"labels": [], "solar": [], "net": []},
    "live": False,
}

_DS_QUERY_URL = "/api/ds/query"


def _flux_last(field: str, source_id: str, source_type: str) -> str:
    return f"""
from(bucket: "{settings.INFLUXDB_BUCKET}")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "energy_usage")
  |> filter(fn: (r) => r.source_id == "{source_id}")
  |> filter(fn: (r) => r.source_type == "{source_type}")
  |> filter(fn: (r) => r._field == "{field}")
  |> last()
"""


def _flux_history(field: str, source_id: str, source_type: str) -> str:
    return f"""
from(bucket: "{settings.INFLUXDB_BUCKET}")
  |> range(start: -3h)
  |> filter(fn: (r) => r._measurement == "energy_usage")
  |> filter(fn: (r) => r.source_id == "{source_id}")
  |> filter(fn: (r) => r.source_type == "{source_type}")
  |> filter(fn: (r) => r._field == "{field}")
  |> aggregateWindow(every: 30s, fn: mean, createEmpty: false)
"""


def _build_query_payload(queries: list[tuple[str, str]]) -> dict:
    """Build Grafana ds/query JSON body. queries = [(refId, fluxQuery), ...]"""
    return {
        "queries": [
            {
                "refId": ref_id,
                "datasource": {"uid": settings.GRAFANA_DATASOURCE_UID},
                "rawQuery": True,
                "query": flux,
            }
            for ref_id, flux in queries
        ],
        "from": "now-3h",
        "to": "now",
    }


def _extract_scalar(frames: list[dict], ref_id: str) -> float | None:
    for frame in frames:
        schema = frame.get("schema", {})
        if schema.get("refId") != ref_id:
            continue
        data = frame.get("data", {})
        values = data.get("values", [])
        if len(values) >= 2 and values[1]:
            v = values[1][-1]  # last value
            return float(v) if v is not None else None
    return None


def _extract_series(frames: list[dict], ref_id: str) -> tuple[list[str], list[float]]:
    for frame in frames:
        schema = frame.get("schema", {})
        if schema.get("refId") != ref_id:
            continue
        data = frame.get("data", {})
        values = data.get("values", [])
        nanos = data.get("nanos", [None])
        if len(values) < 2:
            continue
        timestamps_ms = values[0]
        vals = values[1]
        labels: list[str] = []
        series: list[float] = []
        for i, ts_ms in enumerate(timestamps_ms):
            if ts_ms is None or vals[i] is None:
                continue
            from datetime import datetime, timezone
            dt = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
            labels.append(dt.strftime("%H:%M"))
            series.append(round(float(vals[i]), 2))
        return labels, series
    return [], []


async def _grafana_query(payload: dict) -> list[dict]:
    """POST to Grafana /api/ds/query, return all frames."""
    url = settings.GRAFANA_URL.rstrip("/") + _DS_QUERY_URL
    async with httpx.AsyncClient(timeout=8.0) as client:
        resp = await client.post(
            url,
            json=payload,
            auth=(settings.GRAFANA_USER, settings.GRAFANA_PASSWORD),
        )
        resp.raise_for_status()
        body = resp.json()

    frames: list[dict] = []
    for result in body.get("results", {}).values():
        frames.extend(result.get("frames", []))
    return frames


@router.get("/grafana-live")
async def get_grafana_live(_current_user: CurrentUser) -> dict[str, Any]:
    """
    Returns live InfluxDB sensor readings via Grafana HTTP proxy.
    Falls back to live=False if Grafana is unreachable or unconfigured.
    """
    if not settings.GRAFANA_PASSWORD:
        logger.warning("GRAFANA_PASSWORD not set — energy live data disabled")
        return _EMPTY_RESPONSE

    try:
        # ── Latest scalar queries ─────────────────────────────────────────────
        latest_payload = _build_query_payload([
            ("solar",  _flux_last("generation_w", "array-01", "solar")),
            ("temp",   _flux_last("temp_c",       "unit-01",  "hvac")),
            ("setpt",  _flux_last("setpoint_c",   "unit-01",  "hwh")),
            ("net",    _flux_last("total_w",       "balance",  "net")),
        ])
        latest_frames = await _grafana_query(latest_payload)

        solar_w = _extract_scalar(latest_frames, "solar")
        temp_c  = _extract_scalar(latest_frames, "temp")
        setpt_c = _extract_scalar(latest_frames, "setpt")
        net_w   = _extract_scalar(latest_frames, "net")

        # ── History queries ───────────────────────────────────────────────────
        history_payload = _build_query_payload([
            ("hsolar", _flux_history("generation_w", "array-01", "solar")),
            ("hnet",   _flux_history("total_w",       "balance",  "net")),
        ])
        history_frames = await _grafana_query(history_payload)

        s_labels, s_vals = _extract_series(history_frames, "hsolar")
        n_labels, n_vals = _extract_series(history_frames, "hnet")
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
        logger.warning("Grafana/InfluxDB query failed: %s", exc)
        return _EMPTY_RESPONSE
