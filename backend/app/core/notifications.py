from __future__ import annotations

import asyncio
import base64
import json
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


def _format_resend_http_error(exc: httpx.HTTPStatusError) -> str:
    """Turn Resend API errors into short, actionable messages for logs and admin UI."""
    status = exc.response.status_code if exc.response else 0
    raw = ""
    if exc.response:
        try:
            raw = exc.response.text or ""
        except Exception:
            raw = ""
    parsed = ""
    if raw.strip():
        try:
            data = json.loads(raw)
            if isinstance(data, dict) and data.get("message") is not None:
                parsed = str(data["message"]).strip()
        except (json.JSONDecodeError, TypeError):
            pass
    if not parsed:
        parsed = raw.strip().replace("\n", " ")
        if len(parsed) > 320:
            parsed = parsed[:320] + "…"
    hint = ""
    lower = parsed.lower()
    if status == 403 and ("testing emails" in lower or "verify a domain" in lower or "onboarding@" in lower):
        hint = (
            " Tip: With Resend’s test sender, only the account owner’s inbox receives mail. "
            "Verify your domain in Resend and set RESEND_FROM_EMAIL to an address on that domain."
        )
    return f"Resend HTTP {status}: {parsed}{hint}"


def _format_brevo_http_error(exc: httpx.HTTPStatusError) -> str:
    status = exc.response.status_code if exc.response else 0
    raw = ""
    if exc.response:
        try:
            raw = exc.response.text or ""
        except Exception:
            raw = ""
    parsed = ""
    if raw.strip():
        try:
            data = json.loads(raw)
            if isinstance(data, dict):
                if data.get("message") is not None:
                    parsed = str(data["message"]).strip()
                elif data.get("error") is not None:
                    parsed = str(data["error"]).strip()
        except (json.JSONDecodeError, TypeError):
            pass
    if not parsed:
        parsed = raw.strip().replace("\n", " ")
        if len(parsed) > 220:
            parsed = parsed[:220] + "…"
    return f"Brevo HTTP {status}: {parsed}"


def _brevo_attachments_from_resend(attachments_resend: list[dict[str, Any]] | None) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for a in attachments_resend or []:
        name = a.get("filename") or a.get("name") or "attachment"
        content = a.get("content") or ""
        if isinstance(content, str) and content.strip():
            out.append({"name": str(name), "content": content})
    return out


def _brevo_configured() -> bool:
    return bool(str(settings.BREVO_API_KEY or "").strip() and str(settings.BREVO_SENDER_EMAIL or "").strip())


async def _send_brevo_email(
    *,
    to_emails: list[str],
    subject: str,
    html: str,
    text: str,
    attachments: list[dict[str, str]] | None = None,
    raise_on_fail: bool = False,
) -> bool:
    """
    Brevo transactional API: https://developers.brevo.com/docs/getting-started
    """
    if not _brevo_configured() or not to_emails:
        return False

    sender_email = str(settings.BREVO_SENDER_EMAIL).strip()
    sender_name = (settings.BREVO_SENDER_NAME or settings.APP_NAME or "SIER Lab").strip()

    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "api-key": str(settings.BREVO_API_KEY).strip(),
        "User-Agent": "sear-lab-inventory/1.0",
    }
    recipients = [{"email": str(e).strip().lower()} for e in to_emails if e and str(e).strip()]
    if not recipients:
        return False

    payload: dict[str, Any] = {
        "sender": {"name": sender_name, "email": sender_email},
        "to": recipients,
        "subject": subject,
        "htmlContent": html or f"<pre>{text}</pre>",
        "textContent": text or "",
    }
    if attachments:
        payload["attachment"] = attachments

    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            r = await client.post("https://api.brevo.com/v3/smtp/email", headers=headers, json=payload)
            r.raise_for_status()
            return True
    except httpx.HTTPStatusError as exc:
        log.warning(
            "Brevo email failed (subject=%s): %s",
            subject,
            _format_brevo_http_error(exc),
        )
        if raise_on_fail:
            raise
        return False
    except Exception:
        log.exception("Brevo email failed (subject=%s)", subject)
        if raise_on_fail:
            raise
        return False


def _smtp_configured() -> bool:
    if not settings.SMTP_ENABLED:
        return False
    return bool(settings.SMTP_HOST and settings.SMTP_PORT and settings.SMTP_USER and settings.SMTP_PASSWORD)


async def _send_smtp_email(
    *,
    to_emails: list[str],
    subject: str,
    html: str,
    text: str,
    attachments: list[dict[str, Any]] | None = None,
    raise_on_fail: bool = False,
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
        if raise_on_fail:
            raise
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
        brief = _format_resend_http_error(exc)
        log.warning(
            "Resend email send failed (subject=%s, from=%s, to=%s): %s",
            subject,
            payload.get("from"),
            payload.get("to"),
            brief,
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
    """Brevo (if configured), else SMTP then Resend."""
    if _brevo_configured():
        b_att = _brevo_attachments_from_resend(attachments_resend)
        if await _send_brevo_email(
            to_emails=to_emails,
            subject=subject,
            html=html,
            text=text,
            attachments=b_att or None,
            raise_on_fail=False,
        ):
            return True
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


async def _send_email_with_detail(
    *,
    to_emails: list[str],
    subject: str,
    html: str,
    text: str,
    attachments_resend: list[dict[str, Any]] | None = None,
    attachments_smtp: list[dict[str, Any]] | None = None,
    prefer_resend: bool = False,
) -> tuple[bool, str]:
    """
    Brevo first (if configured), then Resend/SMTP chain.
    """
    if not to_emails:
        return False, "No recipients provided."

    chain = ""
    if _brevo_configured():
        b_att = _brevo_attachments_from_resend(attachments_resend)
        try:
            brevo_ok = await _send_brevo_email(
                to_emails=to_emails,
                subject=subject,
                html=html,
                text=text,
                attachments=b_att or None,
                raise_on_fail=True,
            )
            if brevo_ok:
                return True, "Email sent via Brevo."
        except httpx.HTTPStatusError as exc:
            chain = _format_brevo_http_error(exc) + " "
        except Exception as exc:
            chain = f"Brevo failed ({exc.__class__.__name__}). "
        else:
            chain = "Brevo did not return success. "

    ok, detail = await _deliver_via_resend_and_smtp(
        to_emails=to_emails,
        subject=subject,
        html=html,
        text=text,
        attachments_resend=attachments_resend,
        attachments_smtp=attachments_smtp,
        prefer_resend=prefer_resend,
    )
    if ok:
        return True, detail
    return False, f"{chain}{detail}".strip()


async def _deliver_via_resend_and_smtp(
    *,
    to_emails: list[str],
    subject: str,
    html: str,
    text: str,
    attachments_resend: list[dict[str, Any]] | None = None,
    attachments_smtp: list[dict[str, Any]] | None = None,
    prefer_resend: bool = False,
) -> tuple[bool, str]:
    """
    Resend and/or SMTP only (no Brevo). Used after Brevo attempt in _send_email_with_detail.

    Default: SMTP first, then Resend.
    prefer_resend=True: Resend first, then SMTP.
    """
    if not to_emails:
        return False, "No recipients provided."

    smtp_enabled = _smtp_configured()
    resend_enabled = bool(settings.RESEND_API_KEY and settings.RESEND_FROM_EMAIL)
    smtp_err = "SMTP is not configured."

    if prefer_resend and resend_enabled:
        resend_failed = ""
        try:
            resend_ok = await _send_resend_email(
                to_emails=to_emails,
                subject=subject,
                html=html,
                text=text,
                attachments=attachments_resend,
                raise_on_fail=True,
            )
            if resend_ok:
                return True, "Email sent via Resend."
        except httpx.HTTPStatusError as exc:
            resend_failed = _format_resend_http_error(exc)
        except Exception as exc:
            resend_failed = f"Resend failed: {exc.__class__.__name__}".strip()
        else:
            resend_failed = "Resend returned without success (check API key / from address)."

        if smtp_enabled:
            try:
                smtp_ok = await _send_smtp_email(
                    to_emails=to_emails,
                    subject=subject,
                    html=html,
                    text=text,
                    attachments=attachments_smtp,
                    raise_on_fail=True,
                )
                if smtp_ok:
                    return True, "Email sent via SMTP (Resend was unavailable or failed)."
            except Exception as exc:
                detail = str(exc).strip() or exc.__class__.__name__
                if len(detail) > 180:
                    detail = detail[:180] + "…"
                smtp_part = f"SMTP failed ({exc.__class__.__name__}): {detail}"
                return False, f"{resend_failed} {smtp_part}".strip()
            return False, f"{resend_failed} SMTP did not succeed.".strip()
        return False, resend_failed

    if smtp_enabled:
        try:
            smtp_ok = await _send_smtp_email(
                to_emails=to_emails,
                subject=subject,
                html=html,
                text=text,
                attachments=attachments_smtp,
                raise_on_fail=True,
            )
            if smtp_ok:
                return True, "Email sent via SMTP."
        except Exception as exc:
            detail = str(exc).strip() or exc.__class__.__name__
            if len(detail) > 180:
                detail = detail[:180] + "…"
            smtp_err = f"SMTP failed ({exc.__class__.__name__}): {detail}"
            if not resend_enabled:
                return False, smtp_err
    else:
        smtp_err = "SMTP is not configured."

    if resend_enabled:
        try:
            resend_ok = await _send_resend_email(
                to_emails=to_emails,
                subject=subject,
                html=html,
                text=text,
                attachments=attachments_resend,
                raise_on_fail=True,
            )
            if resend_ok:
                return True, "Email sent via Resend fallback."
            return False, f"{smtp_err} Resend returned without success (check API key / from address)."
        except httpx.HTTPStatusError as exc:
            return False, f"{smtp_err} {_format_resend_http_error(exc)}".strip()
        except Exception as exc:
            return False, f"{smtp_err} Resend failed: {exc.__class__.__name__}".strip()

    return False, f"{smtp_err} Resend is not configured."


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
    if not (
        _brevo_configured()
        or (settings.RESEND_API_KEY and settings.RESEND_FROM_EMAIL)
        or _smtp_configured()
    ):
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
                # Email notifications for low stock are disabled — alerts appear in the UI only.

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
    ok, detail = await _send_email_with_detail(
        to_emails=[to_email],
        subject=subject,
        html=html,
        text=text,
        attachments_resend=resend_attachments,
        attachments_smtp=smtp_attachments,
    )
    if ok:
        return True, "QR sent to your email."
    return False, f"QR email send failed. {detail}"


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

    ok, detail = await _send_email_with_detail(
        to_emails=[to_email],
        subject=subject,
        html=html,
        text=text,
        prefer_resend=True,
    )
    return (True, "Welcome email sent.") if ok else (False, f"Welcome email could not be sent. {detail}")


async def send_role_request_to_managers(
    *,
    requester_name: str,
    requester_username: str,
    requester_email: str,
    request_id: int,
    message: str | None,
    manager_emails: list[str],
) -> tuple[bool, str]:
    """Notify all managers that a user has requested the Manager role."""
    if not manager_emails:
        return False, "No manager emails provided."

    msg_block = (
        f'<li>Message: <i>"{message}"</i></li>'
        if message
        else ""
    )
    subject = f"[SEAR Lab] Manager role request from {requester_name}"
    html = _build_resend_html(
        f"""
        <h3 style="margin:0 0 10px 0;">Manager Role Request</h3>
        <p style="margin:0 0 12px 0;">
          <b>{requester_name}</b> (<code>{requester_username}</code>) has requested
          the <b>Manager</b> role on SEAR Lab Inventory.
        </p>
        <ul style="margin:0 0 14px 0; padding-left:18px;">
          <li>Email: <b>{requester_email}</b></li>
          <li>Request ID: <b>#{request_id}</b></li>
          {msg_block}
        </ul>
        <p style="margin:0; color:#6b7280; font-size:13px;">
          Log in to the Inventory System and go to the <b>Alerts</b> page
          to approve or reject this request.
        </p>
        """
    )
    text = (
        f"Manager role request from {requester_name} ({requester_username}). "
        f"Email: {requester_email}. "
        f"Log in to Alerts to approve or reject."
    )
    ok, detail = await _send_email_with_detail(
        to_emails=manager_emails,
        subject=subject,
        html=html,
        text=text,
        prefer_resend=True,
    )
    return (True, "Manager notification sent.") if ok else (False, f"Notification email failed. {detail}")


async def send_role_request_decision(
    *,
    to_email: str,
    full_name: str,
    approved: bool,
    review_note: str | None,
) -> tuple[bool, str]:
    """Notify the requester whether their Manager role request was approved or rejected."""
    if not to_email:
        return False, "No recipient email."

    if approved:
        subject = "[SEAR Lab] Manager role approved"
        status_html = '<span style="color:#10b981;font-weight:bold;">✓ Approved</span>'
        body_html = (
            "<p style='margin:0 0 10px 0;'>Your request for the <b>Manager</b> role "
            "has been <b style='color:#10b981'>approved</b>. You can now access "
            "manager-level features in SEAR Lab Inventory.</p>"
        )
        text = "Your Manager role request has been approved."
    else:
        subject = "[SEAR Lab] Manager role request declined"
        status_html = '<span style="color:#ef4444;font-weight:bold;">✗ Declined</span>'
        body_html = (
            "<p style='margin:0 0 10px 0;'>Your request for the <b>Manager</b> role "
            "has been <b style='color:#ef4444'>declined</b>.</p>"
        )
        text = "Your Manager role request has been declined."

    note_block = (
        f'<p style="margin:10px 0 0 0; color:#6b7280; font-size:13px;">Reviewer note: <i>"{review_note}"</i></p>'
        if review_note
        else ""
    )
    html = _build_resend_html(
        f"""
        <h3 style="margin:0 0 10px 0;">Role Request Update — {status_html}</h3>
        <p style="margin:0 0 8px 0;">Hi <b>{full_name}</b>,</p>
        {body_html}
        {note_block}
        """
    )
    ok, detail = await _send_email_with_detail(
        to_emails=[to_email],
        subject=subject,
        html=html,
        text=text,
        prefer_resend=True,
    )
    return (True, "Decision email sent.") if ok else (False, f"Decision email failed. {detail}")


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

    ok, detail = await _send_email_with_detail(
        to_emails=[to_email],
        subject=subject,
        html=html,
        text=text,
        prefer_resend=True,
    )
    return (True, "Login email sent.") if ok else (False, f"Login email could not be sent. {detail}")


async def _fetch_brevo_credits_remaining() -> int | None:
    """Best-effort remaining credits from Brevo /v3/account (shape varies by plan)."""
    if not _brevo_configured():
        return None
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                "https://api.brevo.com/v3/account",
                headers={
                    "accept": "application/json",
                    "api-key": str(settings.BREVO_API_KEY).strip(),
                    "User-Agent": "sear-lab-inventory/1.0",
                },
            )
            r.raise_for_status()
            data = r.json()
    except Exception:
        return None

    if not isinstance(data, dict):
        return None
    plan = data.get("plan")
    if isinstance(plan, list):
        for entry in plan:
            if not isinstance(entry, dict):
                continue
            for key in ("credits", "creditsRemain", "creditsRemaining"):
                if entry.get(key) is not None:
                    try:
                        return int(entry[key])
                    except (TypeError, ValueError):
                        continue
    return None


async def get_email_service_status_for_ui() -> "EmailServiceStatusRead":
    from app.schemas.transaction import EmailServiceStatusRead

    brevo = _brevo_configured()
    resend = bool(settings.RESEND_API_KEY and settings.RESEND_FROM_EMAIL)
    smtp = _smtp_configured()

    if brevo:
        active = "brevo"
        limit_hint = settings.BREVO_FREE_TIER_DAILY_LIMIT
    elif resend:
        active = "resend"
        limit_hint = None
    elif smtp:
        active = "smtp"
        limit_hint = None
    else:
        active = None
        limit_hint = None

    credits: int | None = None
    if brevo:
        credits = await _fetch_brevo_credits_remaining()

    notes: list[str] = []
    if brevo and limit_hint:
        notes.append(
            f"Brevo free tier is typically up to {limit_hint} emails/day; confirm usage in your Brevo dashboard."
        )
    if credits is not None:
        notes.append(f"Brevo reports approximately {credits} credits remaining (if applicable to your plan).")
    if not (brevo or resend or smtp):
        notes.append("Configure BREVO_API_KEY + BREVO_SENDER_EMAIL, or Resend, or SMTP to send mail.")

    return EmailServiceStatusRead(
        active_provider=active,
        brevo_configured=brevo,
        resend_configured=resend,
        smtp_configured=smtp,
        daily_limit_hint=limit_hint if brevo else None,
        brevo_credits_remaining=credits,
        note=" ".join(notes),
    )


async def send_otp_email(*, to_email: str, full_name: str, otp: str) -> tuple[bool, str]:
    """Send OTP verification email with premium styling."""
    if not to_email or not otp:
        return False, "Email or OTP not provided."

    subject = "[SEAR Lab Inventory] Verify Your Email - One-Time Code"
    
    # Premium HTML with better styling
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 500px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #0891b2 0%, #06b6d4 100%); border-radius: 12px 12px 0 0; padding: 40px 20px; text-align: center;">
            <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 700;">SEAR Lab Inventory</h1>
            <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Email Verification</p>
        </div>
        <div style="background: #f8f9fa; border-radius: 0 0 12px 12px; padding: 40px 20px; text-align: center;">
            <p style="margin: 0 0 20px 0; color: #1f2937; font-size: 16px;">
                Hi <b>{full_name}</b>,
            </p>
            <p style="margin: 0 0 30px 0; color: #4b5563; font-size: 14px;">
                Your one-time verification code is:
            </p>
            <div style="background: white; border: 2px solid #e5e7eb; border-radius: 8px; padding: 24px; margin: 0 0 20px 0;">
                <p style="margin: 0; font-size: 48px; font-weight: 700; color: #0891b2; letter-spacing: 8px; font-family: 'Monaco', 'Courier New', monospace;">
                    {otp}
                </p>
            </div>
            <p style="margin: 0 0 20px 0; color: #9ca3af; font-size: 12px;">
                This code expires in 10 minutes
            </p>
            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 20px;">
                <p style="margin: 0; color: #6b7280; font-size: 12px;">
                    If you didn't request this code, please ignore this email.
                </p>
            </div>
        </div>
    </div>
    """
    
    text = f"Your verification code is: {otp}. This code expires in 10 minutes."

    ok, detail = await _send_email_with_detail(
        to_emails=[to_email],
        subject=subject,
        html=html,
        text=text,
        prefer_resend=True,
    )
    return (True, "OTP email sent.") if ok else (False, f"OTP email could not be sent. {detail}")
