from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import httpx
from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.events import DomainEvent, EventType, event_bus
from app.models.item import Item
from app.models.location import Location
from app.models.transaction import Alert
from app.models.user import Role, RoleName, User, UserRole
from app.repositories.item_repo import ItemRepository
from app.repositories.transaction_repo import AlertRepository, StockLevelRepository

log = logging.getLogger(__name__)


def _build_resend_html(body: str) -> str:
    # Keep templates simple; clients can style via HTML additions.
    return f"""
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
      {body}
    </div>
    """.strip()


async def _send_resend_email(*, to_emails: list[str], subject: str, html: str, text: str) -> None:
    if not settings.RESEND_API_KEY or not settings.RESEND_FROM_EMAIL:
        return
    if not to_emails:
        return

    # Resend rejects requests without a User-Agent in some environments.
    headers = {
        "Authorization": f"Bearer {settings.RESEND_API_KEY}",
        "Content-Type": "application/json",
        "User-Agent": "sear-lab-inventory/1.0",
    }
    payload = {
        "from": settings.RESEND_FROM_EMAIL,
        "to": to_emails,
        "subject": subject,
        "html": html,
        "text": text,
    }

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post("https://api.resend.com/emails", headers=headers, json=payload)
            r.raise_for_status()
    except Exception:
        log.exception("Resend email send failed (subject=%s)", subject)


async def _get_recipient_emails(*, session) -> list[str]:
    # Notify admin/manager by default.
    roles = [RoleName.ADMIN.value, RoleName.MANAGER.value]
    if settings.ALERT_EMAIL_RECIPIENT_ROLES:
        roles = settings.ALERT_EMAIL_RECIPIENT_ROLES

    stmt = (
        select(User.email)
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .where(User.is_active == True)  # noqa: E712
        .where(Role.name.in_(roles))
        .where(User.email != None)  # noqa: E711
        .distinct()
    )
    res = await session.execute(stmt)
    return [e for e in res.scalars().all() if e]


async def _ensure_low_stock_alert(*, session, item: Item, total_qty: Decimal) -> Alert | None:
    alert_repo = AlertRepository(session)
    existing = await alert_repo.get_for_item(item.id)
    if any(a.alert_type == "low_stock" and not a.is_resolved for a in existing):
        return None

    severity = "critical" if total_qty <= 0 else "warning"
    message = (
        f"Low stock alert: {item.name} ({item.sku}). "
        f"On-hand: {float(total_qty)} {item.unit}. "
        f"Reorder level: {float(item.reorder_level)}."
    )

    alert = Alert(
        item_id=item.id,
        alert_type="low_stock",
        severity=severity,
        message=message,
        extra_data=None,
        is_resolved=False,
    )
    session.add(alert)
    await session.flush()
    return alert


async def _send_low_stock_email(*, item: Item, total_qty: Decimal, recipients: list[str]) -> None:
    subject = f"[SEAR Lab Inventory] Low stock: {item.sku}"
    html = _build_resend_html(
        f"""
        <h3 style="margin:0 0 8px 0;">Low stock detected</h3>
        <p style="margin:0 0 10px 0;">{item.name} ({item.sku})</p>
        <ul style="margin:0; padding-left: 18px;">
          <li>On-hand: <b>{float(total_qty)}</b> {item.unit}</li>
          <li>Reorder level: <b>{float(item.reorder_level)}</b></li>
        </ul>
        <p style="margin-top:14px; color:#6b7280; font-size:13px;">
          This notification is triggered automatically by your inventory system.
        </p>
        """
    )
    text = f"Low stock: {item.name} ({item.sku}). On-hand {float(total_qty)} {item.unit}, reorder level {float(item.reorder_level)}."
    await _send_resend_email(to_emails=recipients, subject=subject, html=html, text=text)


async def _handle_transfer_email(event: DomainEvent) -> None:
    if not settings.RESEND_ENABLE_TRANSFER:
        return
    if not event.actor_id:
        return

    async with AsyncSessionLocal() as session:
        user_stmt = select(User).where(User.id == event.actor_id)
        res = await session.execute(user_stmt)
        actor = res.scalar_one_or_none()
        if not actor or not actor.email:
            return

        payload = event.payload or {}
        item_id = payload.get("item_id")
        from_location_id = payload.get("from_location_id")
        to_location_id = payload.get("to_location_id")
        quantity = payload.get("quantity")

        if not item_id:
            return

        item_repo = ItemRepository(session)
        item = await item_repo.get_by_id(int(item_id))
        if not item:
            return

        from_loc = None
        to_loc = None
        if from_location_id:
            from_loc = await session.get(Location, int(from_location_id))
        if to_location_id:
            to_loc = await session.get(Location, int(to_location_id))

        subject = f"[SEAR Lab Inventory] Transfer recorded: {item.sku}"
        html = _build_resend_html(
            f"""
            <h3 style="margin:0 0 8px 0;">Transfer recorded</h3>
            <p style="margin:0 0 10px 0;">{actor.full_name} performed a transfer.</p>
            <ul style="margin:0; padding-left: 18px;">
              <li>Item: <b>{item.name}</b> ({item.sku})</li>
              <li>Quantity: <b>{quantity}</b> {item.unit}</li>
              <li>From: <b>{from_loc.code if from_loc else from_location_id}</b></li>
              <li>To: <b>{to_loc.code if to_loc else to_location_id}</b></li>
            </ul>
            """
        )
        text = (
            f"Transfer recorded by {actor.username}: {item.name} ({item.sku}), quantity {quantity}. "
            f"From {from_loc.code if from_loc else from_location_id} to {to_loc.code if to_loc else to_location_id}."
        )
        await _send_resend_email(to_emails=[actor.email], subject=subject, html=html, text=text)


async def _check_and_notify_low_stock(*, changed_item_id: int | None = None) -> None:
    if not settings.RESEND_ENABLE_LOW_STOCK:
        return
    if not settings.RESEND_API_KEY or not settings.RESEND_FROM_EMAIL:
        return

    async with AsyncSessionLocal() as session:
        item_repo = ItemRepository(session)
        stock_repo = StockLevelRepository(session)

        items_to_check: list[Item] = []
        if changed_item_id:
            item = await item_repo.get_by_id(changed_item_id)
            if item and item.is_active:
                items_to_check = [item]
        else:
            # For full scan, use existing query method.
            low = await item_repo.get_low_stock_items()
            items_to_check = [item for item, _ in low]

        if not items_to_check:
            return

        recipients = await _get_recipient_emails(session)
        alert_repo = AlertRepository(session)

        created_any = False
        for item in items_to_check:
            total_qty = await stock_repo.get_total_for_item(item.id)
            low_alerts = [
                a for a in (await alert_repo.get_for_item(item.id)) if a.alert_type == "low_stock" and not a.is_resolved
            ]

            if total_qty > Decimal(str(item.reorder_level)):
                # If stock recovered, resolve any low-stock alerts so UI is accurate.
                if low_alerts:
                    now = datetime.now(timezone.utc)
                    for a in low_alerts:
                        a.is_resolved = True
                        a.resolved_at = now
                    await session.commit()
                continue

            # total_qty is low: create an alert only if one doesn't already exist.
            alert = await _ensure_low_stock_alert(session=session, item=item, total_qty=total_qty)
            if alert:
                created_any = True
                await session.commit()
                await _send_low_stock_email(item=item, total_qty=total_qty, recipients=recipients)

        if created_any:
            return


async def _handle_inventory_event_for_low_stock(event: DomainEvent) -> None:
    # Fire after stock mutations so we can catch low stock immediately.
    payload = event.payload or {}
    item_id = payload.get("item_id")
    if not item_id:
        return
    await _check_and_notify_low_stock(changed_item_id=int(item_id))


async def low_stock_monitor_loop() -> None:
    # Periodic safety net in case the server was down during a transition.
    while True:
        try:
            await _check_and_notify_low_stock(changed_item_id=None)
        except Exception:
            log.exception("Low-stock monitor tick failed")
        await asyncio.sleep(settings.LOW_STOCK_CHECK_INTERVAL_SECONDS)


def register_notification_handlers() -> None:
    # Transfer: notify the actor.
    event_bus.subscribe(EventType.TRANSFER, _handle_transfer_email)

    # Low stock: check after STOCK_OUT and TRANSFER.
    event_bus.subscribe(EventType.STOCK_OUT, _handle_inventory_event_for_low_stock)
    event_bus.subscribe(EventType.STOCK_IN, _handle_inventory_event_for_low_stock)
    event_bus.subscribe(EventType.TRANSFER, _handle_inventory_event_for_low_stock)

