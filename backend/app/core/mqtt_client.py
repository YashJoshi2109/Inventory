"""
Production-oriented MQTT client factory for domain event publishing.

Designed for scale:
  - QoS 1 (at-least-once) by default — subscribers won't silently miss events
  - Configurable max inflight — backpressure vs throughput (HiveMQ / EMQX)
  - TLS + optional client certs for cloud brokers (AWS IoT, Azure, etc.)
  - Unique client_id per process — safe with multiple Uvicorn workers (each worker = own connection)
  - Automatic reconnect via paho loop when broker drops

Subscribe to topics: ``{MQTT_TOPIC_PREFIX}/#`` (e.g. ``searlab/inventory/#``).
Payload: JSON from ``DomainEvent.to_dict()`` (UTF-8).
"""
from __future__ import annotations

import logging
import os
import socket
import paho.mqtt.client as mqtt

from app.core.config import settings

logger = logging.getLogger(__name__)


def _on_connect_v2(client: mqtt.Client, userdata: object, flags: object, rc: object, properties: object | None) -> None:
    try:
        ok = rc == 0 or (getattr(rc, "is_failure", None) is False)
        if ok:
            logger.info("MQTT session established with broker")
        else:
            logger.warning("MQTT connect not accepted: %s", rc)
    except Exception:
        logger.warning("MQTT on_connect handler error", exc_info=True)


def _on_disconnect_v2(
    client: mqtt.Client,
    userdata: object,
    disconnect_flags: object,
    rc: object,
    properties: object | None,
) -> None:
    if rc == 0:
        logger.info("MQTT disconnected cleanly")
    else:
        logger.warning("MQTT unexpected disconnect (will retry if loop running): %s", rc)


def build_mqtt_client() -> mqtt.Client:
    """
    Build and *connect* a client; caller must ``loop_start()`` and register with EventBus.

    Raises on fatal misconfiguration; connection errors are retried by paho's loop.
    """
    if not settings.MQTT_ENABLED:
        raise RuntimeError("build_mqtt_client called while MQTT_ENABLED is false")

    host = settings.MQTT_BROKER_HOST.strip()
    if not host:
        raise ValueError("MQTT_BROKER_HOST is empty")

    cid = (settings.MQTT_CLIENT_ID or "").strip()
    if not cid:
        cid = f"sear-inv-{socket.gethostname()}-{os.getpid()}"[:63]

    qos = settings.MQTT_QOS
    if qos not in (0, 1, 2):
        raise ValueError("MQTT_QOS must be 0, 1, or 2")

    client = mqtt.Client(
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        client_id=cid,
        protocol=mqtt.MQTTv311,
        reconnect_on_failure=True,
    )

    client.on_connect = _on_connect_v2
    client.on_disconnect = _on_disconnect_v2

    if settings.MQTT_USE_TLS:
        client.tls_set(
            ca_certs=settings.MQTT_TLS_CA_PATH or None,
            certfile=settings.MQTT_TLS_CERT_PATH or None,
            keyfile=settings.MQTT_TLS_KEY_PATH or None,
        )
        if settings.MQTT_TLS_INSECURE:
            client.tls_insecure_set(True)
            logger.warning("MQTT_TLS_INSECURE=true — broker certificate is not verified")

    if settings.MQTT_USERNAME:
        client.username_pw_set(settings.MQTT_USERNAME, settings.MQTT_PASSWORD or "")

    try:
        client.max_inflight_messages_set(settings.MQTT_MAX_INFLIGHT)
    except Exception as e:
        logger.debug("max_inflight_messages_set not applied: %s", e)

    logger.info(
        "MQTT connecting to %s:%s (TLS=%s, QoS=%s, prefix=%s)",
        host,
        settings.MQTT_BROKER_PORT,
        settings.MQTT_USE_TLS,
        qos,
        settings.MQTT_TOPIC_PREFIX,
    )
    client.connect(host, settings.MQTT_BROKER_PORT, keepalive=settings.MQTT_KEEPALIVE)
    client.loop_start()
    return client
