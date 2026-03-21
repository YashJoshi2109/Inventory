"""
Event bus for internal domain events.

- In-process: ``subscribe`` + ``publish`` runs async handlers (same process).
- MQTT: when ``MQTT_ENABLED``, each ``publish`` also enqueues JSON to the broker
  (non-blocking for the asyncio loop via ``asyncio.to_thread``).

External consumers should subscribe to ``{MQTT_TOPIC_PREFIX}/#`` and parse JSON payloads.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from collections.abc import Callable, Coroutine
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)


class EventType(StrEnum):
    STOCK_IN = "inventory.stock_in"
    STOCK_OUT = "inventory.stock_out"
    TRANSFER = "inventory.transfer"
    ADJUSTMENT = "inventory.adjustment"
    LOW_STOCK = "alert.low_stock"
    ITEM_CREATED = "item.created"
    ITEM_UPDATED = "item.updated"
    SCAN = "scan.performed"
    IMPORT_COMPLETED = "import.completed"
    USER_LOGIN = "auth.login"


@dataclass
class DomainEvent:
    event_type: EventType
    payload: dict[str, Any]
    actor_id: int | None = None
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    correlation_id: str | None = None

    def to_dict(self) -> dict:
        d = asdict(self)
        d["timestamp"] = self.timestamp.isoformat()
        d["event_type"] = str(self.event_type)
        return d

    def to_mqtt_payload(self) -> bytes:
        return json.dumps(self.to_dict()).encode()


HandlerFn = Callable[[DomainEvent], Coroutine[Any, Any, None]]


class EventBus:
    def __init__(self) -> None:
        self._subscribers: dict[str, list[HandlerFn]] = defaultdict(list)
        self._mqtt_client: Any = None  # paho.mqtt.client.Client | None

    def subscribe(self, event_type: EventType, handler: HandlerFn) -> None:
        self._subscribers[str(event_type)].append(handler)

    @property
    def mqtt_connected(self) -> bool:
        c = self._mqtt_client
        if c is None:
            return False
        try:
            return bool(c.is_connected())
        except Exception:
            return False

    async def publish(self, event: DomainEvent) -> None:
        handlers = self._subscribers.get(str(event.event_type), [])
        await asyncio.gather(*(h(event) for h in handlers), return_exceptions=True)

        if settings.MQTT_ENABLED and self._mqtt_client is not None:
            await self._publish_mqtt(event)

    def _publish_mqtt_sync(self, event: DomainEvent) -> None:
        client = self._mqtt_client
        if client is None:
            return
        prefix = settings.MQTT_TOPIC_PREFIX.strip().strip("/")
        # Topic: searlab/inventory/inventory.stock_in
        topic = f"{prefix}/{event.event_type}"
        payload = event.to_mqtt_payload()
        try:
            info = client.publish(
                topic,
                payload,
                qos=settings.MQTT_QOS,
                retain=settings.MQTT_RETAIN,
            )
            if info.rc != 0:
                logger.warning("MQTT publish returned rc=%s topic=%s", info.rc, topic)
        except Exception:
            logger.exception("MQTT publish failed topic=%s", topic)

    async def _publish_mqtt(self, event: DomainEvent) -> None:
        await asyncio.to_thread(self._publish_mqtt_sync, event)

    def connect_mqtt(self, client: Any) -> None:
        """Register the connected paho client (after connect + loop_start)."""
        self._mqtt_client = client
        logger.info("MQTT client registered with EventBus")

    def disconnect_mqtt(self) -> None:
        """Stop network loop and disconnect (app shutdown)."""
        c = self._mqtt_client
        self._mqtt_client = None
        if c is None:
            return
        try:
            c.loop_stop()
        except Exception as e:
            logger.debug("MQTT loop_stop: %s", e)
        try:
            c.disconnect()
        except Exception as e:
            logger.debug("MQTT disconnect: %s", e)
        logger.info("MQTT client disconnected from EventBus")


event_bus = EventBus()
