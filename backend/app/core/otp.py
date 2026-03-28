"""
OTP (One-Time Password) for email verification.

- 6-digit cryptographically secure codes
- 10-minute default expiration
- Session-scoped persistence (same request transaction as the API route)
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.user import User, UserRole

log = logging.getLogger(__name__)


def _normalize_expiry(expires: datetime | None) -> datetime | None:
    if expires is None:
        return None
    if expires.tzinfo is None:
        return expires.replace(tzinfo=timezone.utc)
    return expires


async def issue_otp_for_email(
    session: AsyncSession,
    *,
    email: str,
    expiration_minutes: int = 10,
) -> tuple[str, User] | None:
    """
    Create and store a new OTP for an active user. Returns None if no matching active user.
    Caller must commit via request session lifecycle.
    """
    normalized = email.strip().lower()
    result = await session.execute(
        select(User)
        .where(User.email == normalized)
        .options(selectinload(User.roles).selectinload(UserRole.role))
    )
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        return None

    otp = str(secrets.randbelow(1_000_000)).zfill(6)
    user.otp_code = otp
    user.otp_expires_at = datetime.now(timezone.utc) + timedelta(minutes=expiration_minutes)
    await session.flush()
    log.debug("OTP issued for user_id=%s", user.id)
    return otp, user


async def consume_otp(
    session: AsyncSession,
    *,
    email: str,
    otp: str,
) -> tuple[bool, User | None]:
    """
    Validate OTP: clears code/state on success and sets email_verified.
    Returns (True, user) on success, (False, None) on any failure.
    """
    normalized = email.strip().lower()
    code = otp.strip()
    if len(code) != 6 or not code.isdigit():
        return False, None

    result = await session.execute(
        select(User)
        .where(User.email == normalized)
        .options(selectinload(User.roles).selectinload(UserRole.role))
    )
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        return False, None
    if not user.otp_code or not user.otp_expires_at:
        return False, None

    now = datetime.now(timezone.utc)
    expires = _normalize_expiry(user.otp_expires_at)
    if expires is None or now > expires:
        user.otp_code = None
        user.otp_expires_at = None
        await session.flush()
        return False, None
    if user.otp_code != code:
        return False, None

    user.otp_code = None
    user.otp_expires_at = None
    user.email_verified = True
    await session.flush()
    log.info("OTP consumed user_id=%s", user.id)
    return True, user


async def clear_otp_for_email(session: AsyncSession, *, email: str) -> bool:
    """Remove any pending OTP for this email."""
    normalized = email.strip().lower()
    result = await session.execute(select(User).where(User.email == normalized))
    user = result.scalar_one_or_none()
    if not user:
        return False
    user.otp_code = None
    user.otp_expires_at = None
    await session.flush()
    return True
