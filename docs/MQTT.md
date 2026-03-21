# MQTT integration — SEAR Lab Inventory

The API publishes **JSON domain events** to an MQTT broker whenever inventory-changing operations occur (and on login / item lifecycle). This lets you plug in **large-scale** consumers without changing the core app:

- **Data warehouse / analytics** (subscribe → Kafka / BigQuery / Snowflake)
- **ERP / MES** (stock sync)
- **Notifications** (Slack, PagerDuty) via a small bridge service
- **Edge / IoT** (digital signage, pick-to-light — with appropriate security)

## Enable

```env
MQTT_ENABLED=true
MQTT_BROKER_HOST=localhost
MQTT_BROKER_PORT=1883
MQTT_TOPIC_PREFIX=searlab/inventory
```

Restart the backend. `/health` includes `mqtt.connected` when `MQTT_ENABLED=true`.

## Topics

Pattern: `{MQTT_TOPIC_PREFIX}/{event_type}`

| Topic suffix (event_type) | When |
|---------------------------|------|
| `inventory.stock_in` | Stock added to a location |
| `inventory.stock_out` | Stock removed |
| `inventory.transfer` | Transfer between locations |
| `inventory.adjustment` | Cycle count / adjustment |
| `item.created` | New item + QR created |
| `item.updated` | PATCH item or scan modify |
| `auth.login` | User login (audit) |

Subscribe with wildcard: `searlab/inventory/#`

## Payload

UTF-8 JSON, shape:

```json
{
  "event_type": "inventory.stock_in",
  "payload": { "item_id": 1, "location_id": 2, "quantity": 5.0 },
  "actor_id": 3,
  "timestamp": "2026-03-20T12:00:00+00:00",
  "correlation_id": null
}
```

## Production settings

| Variable | Recommendation |
|----------|----------------|
| `MQTT_QOS` | `1` (at-least-once) — default |
| `MQTT_USE_TLS` | `true` on public networks |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | Always for cloud brokers |
| `MQTT_MAX_INFLIGHT` | Raise for burst publish (100–1000); broker may cap |
| `MQTT_RETAIN` | Usually `false` for events (avoid stale “last message” semantics) |

## Local broker (Docker)

```bash
docker compose --profile mqtt up -d mqtt
```

Set `MQTT_BROKER_HOST=mqtt` if the API runs **inside** the same Compose stack; use `localhost` if the API runs on the host.

## Uvicorn workers

Each worker process opens **its own** MQTT connection (unique `client_id`). That is normal; scale subscribers on the broker side (clustered EMQX / HiveMQ).

## Not published yet

- `import.completed` — wire when import jobs finish
- `alert.low_stock` — wire when alerts are created
- `scan.performed` — redundant with stock_* for most use cases; add if you need per-scan telemetry
