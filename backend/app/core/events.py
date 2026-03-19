"""
Event bus for internal domain events.
Architecture is MQTT-ready — the same EventBus.publish() call will
forward to the MQTT broker in Phase 2 simply by enabling MQTT in settings.

In Phase 1 events are in-process only (background tasks / SSE streams).
"""
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

    async def publish(self, event: DomainEvent) -> None:
        handlers = self._subscribers.get(str(event.event_type), [])
        await asyncio.gather(*(h(event) for h in handlers), return_exceptions=True)

        if settings.MQTT_ENABLED and self._mqtt_client:
            topic = f"{settings.MQTT_TOPIC_PREFIX}/{event.event_type}"
            self._mqtt_client.publish(topic, event.to_mqtt_payload())

    def connect_mqtt(self, client: Any) -> None:
        """Called during startup when MQTT is enabled (Phase 2)."""
        self._mqtt_client = client
        logger.info("MQTT client connected to EventBus")


event_bus = EventBus()
