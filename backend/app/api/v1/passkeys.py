"""
WebAuthn / Passkey endpoints — biometric authentication (Face ID, Touch ID, FIDO2 hardware keys).

Flow:
  Registration:
    POST /passkeys/register/begin   → returns PublicKeyCredentialCreationOptions (challenge + params)
    POST /passkeys/register/complete → verifies + stores the new credential

  Authentication:
    POST /passkeys/login/begin      → returns PublicKeyCredentialRequestOptions
    POST /passkeys/login/complete   → verifies credential, returns JWT tokens
"""
from __future__ import annotations

import base64
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from app.api.v1.auth import CurrentUser, get_current_user
from app.core.config import settings
from app.core.database import DbSession
from app.core.events import DomainEvent, EventType, event_bus
from app.core.security import create_access_token, create_refresh_token
from app.models.user import PasskeyCredential, User
from app.repositories.user_repo import UserRepository
from app.schemas.common import MessageResponse
from app.schemas.user import TokenResponse

try:
    import webauthn
    from webauthn import (
        generate_registration_options,
        verify_registration_response,
        generate_authentication_options,
        verify_authentication_response,
    )
    from webauthn.helpers import bytes_to_base64url, base64url_to_bytes
    from webauthn.helpers.structs import (
        AuthenticatorSelectionCriteria,
        ResidentKeyRequirement,
        UserVerificationRequirement,
        PublicKeyCredentialDescriptor,
        AuthenticatorTransport,
    )
    WEBAUTHN_AVAILABLE = True
except ImportError:
    WEBAUTHN_AVAILABLE = False

_log = logging.getLogger(__name__)
router = APIRouter(prefix="/passkeys", tags=["passkeys"])

# In-memory challenge store (production: use Redis with TTL ~5 min)
# Stores (challenge_bytes, rp_id) tuples so register/complete uses the same RP ID as begin
_reg_challenges: dict[int, tuple[bytes, str]] = {}
_auth_challenges: dict[str, tuple[bytes, str]] = {}  # keyed by username or "__discoverable__"


def _require_webauthn():
    if not WEBAUTHN_AVAILABLE:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="WebAuthn is not available. Install the 'webauthn' package on the server.",
        )


def _rp_id_for_request(request: Request) -> str:
    """
    Pick the WebAuthn RP_ID that matches the browser's Origin header.
    Falls back to the configured default so dev still works without an Origin header.
    """
    origin = request.headers.get("origin", "").strip()
    if origin:
        parsed = urlparse(origin)
        host = parsed.hostname
        allowed = settings.WEBAUTHN_ORIGINS or [settings.WEBAUTHN_ORIGIN]
        if origin in allowed and host:
            return host
        if settings.CORS_ORIGIN_REGEX and re.match(settings.CORS_ORIGIN_REGEX, origin) and host:
            return host
        # Deployment safety: if still on default localhost RP ID, trust current origin host.
        if host and settings.WEBAUTHN_RP_ID in {"localhost", "127.0.0.1"} and host not in {"localhost", "127.0.0.1"}:
            return host
    return settings.WEBAUTHN_RP_ID


def _expected_origins_for_request(request: Request, rp_id: str) -> list[str]:
    """
    Build origin candidates for verification.
    Includes configured origins and request origin when host matches RP ID/domain.
    """
    configured = settings.WEBAUTHN_ORIGINS or [settings.WEBAUTHN_ORIGIN]
    origins: list[str] = [o for o in configured if o]

    req_origin = request.headers.get("origin", "").strip()
    if req_origin:
        parsed = urlparse(req_origin)
        host = parsed.hostname or ""
        if host == rp_id or host.endswith(f".{rp_id}"):
            origins.append(req_origin)
        elif settings.CORS_ORIGIN_REGEX and re.match(settings.CORS_ORIGIN_REGEX, req_origin):
            origins.append(req_origin)

    # Deduplicate, preserve order
    seen: set[str] = set()
    unique: list[str] = []
    for origin in origins:
        if origin in seen:
            continue
        seen.add(origin)
        unique.append(origin)
    return unique


# ──────────────────────────────────────────────────────────────
# Registration
# ──────────────────────────────────────────────────────────────

class RegisterBeginResponse(BaseModel):
    options: dict[str, Any]


@router.post("/register/begin", response_model=RegisterBeginResponse)
async def passkey_register_begin(
    request: Request,
    current_user: CurrentUser,
    session: DbSession,
) -> RegisterBeginResponse:
    """Generate WebAuthn registration options (requires authenticated session)."""
    _require_webauthn()
    rp_id = _rp_id_for_request(request)

    # Fetch existing credentials to exclude from re-registration (direct query — table may not exist yet)
    from sqlalchemy import select as _select
    try:
        existing = (await session.execute(
            _select(PasskeyCredential).where(PasskeyCredential.user_id == current_user.id)
        )).scalars().all()
        exclude_credentials = [
            PublicKeyCredentialDescriptor(id=base64url_to_bytes(pc.credential_id))
            for pc in existing
        ]
    except Exception:
        exclude_credentials = []

    options = generate_registration_options(
        rp_id=rp_id,
        rp_name=settings.WEBAUTHN_RP_NAME,
        user_id=str(current_user.id).encode(),
        user_name=current_user.username,
        user_display_name=current_user.full_name,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
        exclude_credentials=exclude_credentials,
    )

    # Store (challenge, rp_id) for verification
    _reg_challenges[current_user.id] = (options.challenge, rp_id)

    # Serialize to JSON-safe dict
    options_dict = json.loads(webauthn.options_to_json(options))
    return RegisterBeginResponse(options=options_dict)


class RegisterCompleteRequest(BaseModel):
    credential: dict[str, Any]
    device_name: str | None = None


@router.post("/register/complete", response_model=MessageResponse)
async def passkey_register_complete(
    request: Request,
    body: RegisterCompleteRequest,
    current_user: CurrentUser,
    session: DbSession,
) -> MessageResponse:
    """Verify the authenticator response and store the new passkey credential."""
    _require_webauthn()

    stored_reg = _reg_challenges.pop(current_user.id, None)
    if not stored_reg:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No pending registration challenge. Please start again.",
        )
    challenge, rp_id = stored_reg

    verification = None
    last_exc: Exception | None = None
    for origin in _expected_origins_for_request(request, rp_id):
        try:
            verification = verify_registration_response(
                credential=body.credential,
                expected_challenge=challenge,
                expected_rp_id=rp_id,
                expected_origin=origin,
            )
            break
        except Exception as exc:
            last_exc = exc
    if verification is None:
        _log.warning("Passkey registration failed user_id=%s: %s", current_user.id, last_exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Passkey registration failed: {last_exc}",
        )

    cred_id = bytes_to_base64url(verification.credential_id)
    public_key_hex = verification.credential_public_key.hex()

    # Extract transports reported by the authenticator (e.g. ["internal"], ["usb"], ["hybrid"])
    raw_transports: list[str] = []
    try:
        resp = body.credential.get("response", {})
        raw_transports = resp.get("transports") or []
        if not isinstance(raw_transports, list):
            raw_transports = []
    except Exception:
        pass
    transports_str = ",".join(str(t) for t in raw_transports) if raw_transports else None

    passkey = PasskeyCredential(
        user_id=current_user.id,
        credential_id=cred_id,
        public_key=public_key_hex,
        sign_count=verification.sign_count,
        transports=transports_str,
        device_name=body.device_name,
        aaguid=str(verification.aaguid) if verification.aaguid else None,
    )
    session.add(passkey)
    await session.flush()

    device_label = body.device_name or "passkey"
    return MessageResponse(message=f"Passkey registered: {device_label}", success=True)


# ──────────────────────────────────────────────────────────────
# Authentication
# ──────────────────────────────────────────────────────────────

class AuthBeginRequest(BaseModel):
    username: str | None = None  # optional — allows discoverable credentials
    # "platform"        → Touch ID / Face ID / Windows Hello (transport: "internal")
    # "cross-platform"  → Another device via QR/NFC/BLE (transport: "hybrid"/"ble"/"nfc")
    # "security-key"    → USB/NFC hardware key (transport: "usb"/"nfc")
    # None / omitted    → no filter, browser picks
    authenticator_type: str | None = None


class AuthBeginResponse(BaseModel):
    options: dict[str, Any]


@router.post("/login/begin", response_model=AuthBeginResponse)
async def passkey_login_begin(
    request: Request,
    body: AuthBeginRequest,
    session: DbSession,
) -> AuthBeginResponse:
    """Generate WebAuthn authentication options."""
    _require_webauthn()
    rp_id = _rp_id_for_request(request)

    allow_credentials: list[PublicKeyCredentialDescriptor] = []
    user_key: str = body.username or "__discoverable__"

    if body.username:
        repo = UserRepository(session)
        user = await repo.get_by_username(body.username)
        if not user and "@" in body.username:
            user = await repo.get_by_email(body.username)
        # Silently allow empty list — don't leak whether user has passkeys
        if user:
            from sqlalchemy import select as _select2
            try:
                passkeys = (await session.execute(
                    _select2(PasskeyCredential).where(PasskeyCredential.user_id == user.id)
                )).scalars().all()

                # Filter by authenticator type so the browser goes straight to the right prompt
                def _matches_type(pc: PasskeyCredential) -> bool:
                    if not body.authenticator_type:
                        return True
                    stored = set((pc.transports or "").split(","))
                    if body.authenticator_type == "platform":
                        return "internal" in stored
                    if body.authenticator_type == "cross-platform":
                        return bool(stored & {"hybrid", "ble", "nfc"})
                    if body.authenticator_type == "security-key":
                        return bool(stored & {"usb", "nfc", "ble"})
                    return True

                for pc in passkeys:
                    if _matches_type(pc):
                        transports_list = [
                            t for t in (pc.transports or "").split(",") if t
                        ]
                        allow_credentials.append(
                            PublicKeyCredentialDescriptor(
                                id=base64url_to_bytes(pc.credential_id),
                                transports=transports_list or None,  # type: ignore[arg-type]
                            )
                        )
            except Exception:
                pass

    options = generate_authentication_options(
        rp_id=rp_id,
        allow_credentials=allow_credentials,
        user_verification=UserVerificationRequirement.PREFERRED,
    )

    _auth_challenges[user_key] = (options.challenge, rp_id)
    options_dict = json.loads(webauthn.options_to_json(options))
    # Embed the user_key so the complete step can look up the challenge
    options_dict["_user_key"] = user_key
    return AuthBeginResponse(options=options_dict)


class AuthCompleteRequest(BaseModel):
    credential: dict[str, Any]
    username: str | None = None


@router.post("/login/complete", response_model=TokenResponse)
async def passkey_login_complete(
    request: Request,
    body: AuthCompleteRequest,
    session: DbSession,
) -> TokenResponse:
    """Verify authenticator assertion and return JWT tokens."""
    _require_webauthn()

    user_key = body.username or "__discoverable__"
    stored_auth = _auth_challenges.pop(user_key, None)
    if not stored_auth:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No pending authentication challenge. Please start again.",
        )
    challenge, rp_id = stored_auth

    # Look up credential by ID
    raw_id = body.credential.get("rawId") or body.credential.get("id")
    if not raw_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing credential id")

    # rawId may be base64url string or array; normalise
    if isinstance(raw_id, list):
        cred_id_bytes = bytes(raw_id)
        cred_id_str = bytes_to_base64url(cred_id_bytes)
    else:
        cred_id_str = raw_id
        cred_id_bytes = base64url_to_bytes(cred_id_str)

    # Find the stored credential
    from sqlalchemy import select
    from app.models.user import PasskeyCredential
    stmt = select(PasskeyCredential).where(PasskeyCredential.credential_id == cred_id_str)
    result = await session.execute(stmt)
    stored = result.scalar_one_or_none()

    if not stored:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Passkey not recognised. Please register your device first.",
        )

    repo = UserRepository(session)
    user = await repo.get_with_roles(stored.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found or disabled")

    auth_verification = None
    last_auth_exc: Exception | None = None
    for origin in _expected_origins_for_request(request, rp_id):
        try:
            auth_verification = verify_authentication_response(
                credential=body.credential,
                expected_challenge=challenge,
                expected_rp_id=rp_id,
                expected_origin=origin,
                credential_public_key=bytes.fromhex(stored.public_key),
                credential_current_sign_count=stored.sign_count,
            )
            break
        except Exception as exc:
            last_auth_exc = exc
    if auth_verification is None:
        _log.warning("Passkey auth failed user_id=%s: %s", stored.user_id, last_auth_exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Passkey verification failed: {last_auth_exc}",
        )
    verification = auth_verification

    # Update sign count and last used
    stored.sign_count = verification.new_sign_count
    stored.last_used_at = datetime.now(timezone.utc)
    user.last_login_at = datetime.now(timezone.utc)
    await session.flush()

    role_names = [ur.role.name for ur in user.roles if ur.role]
    access = create_access_token(user.id, extra={"roles": role_names, "username": user.username})
    refresh = create_refresh_token(user.id)

    await event_bus.publish(DomainEvent(
        event_type=EventType.USER_LOGIN,
        payload={"user_id": user.id, "username": user.username, "via": "passkey"},
        actor_id=user.id,
    ))

    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


# ──────────────────────────────────────────────────────────────
# List & delete registered passkeys
# ──────────────────────────────────────────────────────────────

class PasskeyInfo(BaseModel):
    id: int
    credential_id: str
    device_name: str | None
    aaguid: str | None
    created_at: datetime
    last_used_at: datetime | None


@router.get("/", response_model=list[PasskeyInfo])
async def list_passkeys(current_user: CurrentUser, session: DbSession) -> list[PasskeyInfo]:
    """List passkeys registered for the current user."""
    from sqlalchemy import select as _sel
    passkeys = (await session.execute(
        _sel(PasskeyCredential).where(PasskeyCredential.user_id == current_user.id)
    )).scalars().all()
    return [
        PasskeyInfo(
            id=p.id,
            credential_id=p.credential_id,
            device_name=p.device_name,
            aaguid=p.aaguid,
            created_at=p.created_at,
            last_used_at=p.last_used_at,
        )
        for p in passkeys
    ]


@router.delete("/{passkey_id}", response_model=MessageResponse)
async def delete_passkey(
    passkey_id: int,
    current_user: CurrentUser,
    session: DbSession,
) -> MessageResponse:
    """Remove a registered passkey."""
    from sqlalchemy import select, delete as sql_delete
    stmt = select(PasskeyCredential).where(
        PasskeyCredential.id == passkey_id,
        PasskeyCredential.user_id == current_user.id,
    )
    result = await session.execute(stmt)
    stored = result.scalar_one_or_none()
    if not stored:
        raise HTTPException(status_code=404, detail="Passkey not found")
    await session.delete(stored)
    await session.flush()
    return MessageResponse(message="Passkey removed", success=True)
