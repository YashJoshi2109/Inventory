from __future__ import annotations

import asyncio
import base64
import logging
import smtplib
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from email.message import EmailMessage

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


def _smtp_configured() -> bool:
    return bool(settings.SMTP_HOST and settings.SMTP_PORT and settings.SMTP_USER and settings.SMTP_PASSWORD)


async def _send_smtp_email(
    *,
    to_emails: list[str],
    subject: str,
    html: str,
    text: str,
    attachments: list[dict[str, Any]] | None = None,
) -> bool:
    """
    Send email using SMTP in a background thread (blocking I/O).
    Attachments format: [{ filename, contentType, content_base64 }]
    """
    if not _smtp_configured():
        return False
    if not to_emails:
        return False

    from_email = (settings.SMTP_FROM_EMAIL or settings.SMTP_USER).strip()
    if not from_email:
        return False

    msg = EmailMessage()
    msg["From"] = from_email
    msg["To"] = ", ".join(to_emails)
    msg["Subject"] = subject

    # Plain + HTML
    msg.set_content(text or "")
    if html:
        msg.add_alternative(html, subtype="html")

    # Attachments
    if attachments:
        for a in attachments:
            filename = a.get("filename") or "attachment"
            content_type = a.get("contentType") or "application/octet-stream"
            b64 = a.get("content_base64") or ""
            try:
                raw = base64.b64decode(b64)
            except Exception:
                continue
            maintype, _, subtype = content_type.partition("/")
            if not subtype:
                maintype, subtype = "application", "octet-stream"
            msg.add_attachment(raw, maintype=maintype, subtype=subtype, filename=filename)

    def _send_blocking() -> None:
        if settings.SMTP_SSL:
            server: smtplib.SMTP = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20)
        else:
            server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20)
        try:
            server.ehlo()
            if settings.SMTP_STARTTLS and not settings.SMTP_SSL:
                server.starttls()
                server.ehlo()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(msg)
        finally:
            try:
                server.quit()
            except Exception:
                pass

    try:
        await asyncio.to_thread(_send_blocking)
        return True
    except Exception:
        log.exception("SMTP email send failed (subject=%s)", subject)
        return False


def _build_resend_html(body: str) -> str:
    # Keep templates simple; clients can style via HTML additions.
    return f"""
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
      {body}
    </div>
    """.strip()


async def _send_resend_email(
    *,
    to_emails: list[str],
    subject: str,
    html: str,
    text: str,
    attachments: list[dict[str, Any]] | None = None,
    raise_on_fail: bool = False,
) -> bool:
    """
    Send an email via Resend.

    Returns True if the request succeeded, False otherwise (including missing config).
    """
    if not settings.RESEND_API_KEY or not settings.RESEND_FROM_EMAIL:
        return False
    if not to_emails:
        return False

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
    if attachments:
        payload["attachments"] = attachments

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post("https://api.resend.com/emails", headers=headers, json=payload)
            r.raise_for_status()
            return True
    except httpx.HTTPStatusError as exc:
        # Include response body for actionable debugging (safe: Resend doesn't echo API key).
        try:
            resp_text = exc.response.text
        except Exception:
            resp_text = "<unreadable>"
        log.exception(
            "Resend email send failed (subject=%s, status=%s, from=%s, to=%s, body=%s)",
            subject,
            exc.response.status_code if exc.response else None,
            payload.get("from"),
            payload.get("to"),
            resp_text[:1000],
        )
        if raise_on_fail:
            raise
        return False
    except Exception:
        log.exception("Resend email send failed (subject=%s)", subject)
        if raise_on_fail:
            raise
        return False


async def _send_email(
    *,
    to_emails: list[str],
    subject: str,
    html: str,
    text: str,
    attachments_resend: list[dict[str, Any]] | None = None,
    attachments_smtp: list[dict[str, Any]] | None = None,
) -> bool:
    """
    Primary: SMTP (if configured). Fallback: Resend.
    """
    smtp_ok = await _send_smtp_email(
        to_emails=to_emails,
        subject=subject,
        html=html,
        text=text,
        attachments=attachments_smtp,
    )
    if smtp_ok:
        return True
    return await _send_resend_email(
        to_emails=to_emails,
        subject=subject,
        html=html,
        text=text,
        attachments=attachments_resend,
    )


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
    await _send_email(to_emails=recipients, subject=subject, html=html, text=text)


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
        await _send_email(to_emails=[actor.email], subject=subject, html=html, text=text)


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

        recipients = await _get_recipient_emails(session=session)
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


async def send_item_qr_email(*, to_email: str, item_sku: str, item_name: str, qr_png: bytes) -> tuple[bool, str]:
    """
    Emails the generated item QR PNG to `to_email` as an attachment.
    """
    if not to_email:
        return False, "No recipient email configured on your account."
    subject = f"[SEAR Lab Inventory] Your item QR: {item_sku}"
    html = _build_resend_html(
        f"""
        <h3 style="margin:0 0 8px 0;">Your item QR is ready</h3>
        <p style="margin:0 0 10px 0;">Use the attached QR to scan-manage <b>{item_name}</b>.</p>
        <ul style="margin:0; padding-left: 18px;">
          <li>SKU: <b>{item_sku}</b></li>
        </ul>
        <p style="margin-top:14px; color:#6b7280; font-size:13px;">
          If you did not request this, you can ignore this email.
        </p>
        """
    )
    text = f"Item QR ready. SKU: {item_sku}. Item: {item_name}."

    try:
        smtp_attachments = [
            {
                "filename": f"{item_sku}-qr.png",
                "contentType": "image/png",
                "content_base64": base64.b64encode(qr_png).decode("ascii"),
            }
        ]
        resend_attachments = [
            {
                "filename": f"{item_sku}-qr.png",
                "contentType": "image/png",
                "content": base64.b64encode(qr_png).decode("ascii"),
            }
        ]
        ok = await _send_email(
            to_emails=[to_email],
            subject=subject,
            html=html,
            text=text,
            attachments_resend=resend_attachments,
            attachments_smtp=smtp_attachments,
        )
        return (True, "QR sent to your email.") if ok else (False, "QR email send failed.")
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code if exc.response else 0
        detail = ""
        try:
            detail = exc.response.text
        except Exception:
            detail = ""
        if detail and len(detail) > 500:
            detail = detail[:500] + "…"
        msg = f"Resend rejected the request (HTTP {status}). {detail}".strip()
        return False, msg
    except Exception:
        return False, "Resend email send failed. Check server logs and your Resend configuration."


async def send_welcome_email(*, to_email: str, full_name: str, username: str) -> tuple[bool, str]:
    if not to_email:
        return False, "No recipient email configured on your account."

    subject = "[SEAR Lab Inventory] Welcome"
    html = _build_resend_html(
        f"""
        <h3 style="margin:0 0 8px 0;">Welcome to SEAR Lab Inventory</h3>
        <p style="margin:0 0 10px 0;">Hi <b>{full_name}</b>, your account has been created successfully.</p>
        <ul style="margin:0; padding-left: 18px;">
          <li>Username: <b>{username}</b></li>
        </ul>
        """
    )
    text = f"Welcome to SEAR Lab Inventory. Username: {username}."

    ok = await _send_email(to_emails=[to_email], subject=subject, html=html, text=text)
    return (True, "Welcome email sent.") if ok else (False, "Welcome email could not be sent.")


async def send_login_email(*, to_email: str, full_name: str, ip: str | None) -> tuple[bool, str]:
    if not to_email:
        return False, "No recipient email configured on your account."

    subject = "[SEAR Lab Inventory] Login notification"
    ip_html = f"<li>IP: <b>{ip}</b></li>" if ip else "<li>IP: <b>unknown</b></li>"
    html = _build_resend_html(
        f"""
        <h3 style="margin:0 0 8px 0;">Login notification</h3>
        <p style="margin:0 0 10px 0;">Hi <b>{full_name}</b>, we noticed a login to your account.</p>
        <ul style="margin:0; padding-left: 18px;">
          {ip_html}
        </ul>
        <p style="margin-top:14px; color:#6b7280; font-size:13px;">
          If this wasn’t you, please reset your password immediately.
        </p>
        """
    )
    text = f"Login notification. IP: {ip or 'unknown'}."

    ok = await _send_email(to_emails=[to_email], subject=subject, html=html, text=text)
    return (True, "Login email sent.") if ok else (False, "Login email could not be sent.")

