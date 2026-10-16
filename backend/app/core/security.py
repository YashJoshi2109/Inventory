"""Password hashing and JWT token primitives.

Security-critical helpers shared across the auth layer:

* ``hash_password`` / ``verify_password`` — bcrypt via passlib; ``verify_password``
  tolerates legacy/unknown hash formats by returning ``False`` instead of raising.
* ``create_access_token`` / ``create_refresh_token`` — sign JWTs with
  ``settings.SECRET_KEY``; access tokens are short-lived, refresh tokens long-lived.
* ``decode_token`` — verify signature + expiry and return the claims payload.

All token lifetimes and the signing secret come from ``app.core.config.settings``.
"""
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext
from passlib.exc import UnknownHashError

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Return a bcrypt hash of ``password`` for storage."""
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    """Return False on mismatch or malformed stored hash (never raise to callers)."""
    if not hashed:
        return False
    try:
        return pwd_context.verify(plain or "", hashed)
    except (UnknownHashError, ValueError):
        return False


def create_access_token(subject: str | Any, extra: dict | None = None) -> str:
    """Sign a short-lived access JWT with ``type="access"``.

    ``sub`` is the stringified ``subject``; ``exp`` is ``ACCESS_TOKEN_EXPIRE_MINUTES``
    from now. ``extra`` (e.g. roles, username) is merged into the claims payload.
    """
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(subject),
        "iat": now,
        "exp": expire,
        "type": "access",
        **(extra or {}),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(subject: str | Any) -> str:
    """Sign a long-lived refresh JWT with ``type="refresh"``.

    ``sub`` is the stringified ``subject``; ``exp`` is ``REFRESH_TOKEN_EXPIRE_DAYS``
    from now. Carries no ``extra`` claims.
    """
    now = datetime.now(timezone.utc)
    expire = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {
        "sub": str(subject),
        "iat": now,
        "exp": expire,
        "type": "refresh",
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict:
    """Verify signature + ``exp`` and return the claims dict.

    Raises ``ValueError`` if the token is expired or otherwise invalid. Callers that
    need to enforce a specific ``type`` claim must check it on the returned payload.
    """
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError as exc:
        raise ValueError(f"Invalid token: {exc}") from exc
