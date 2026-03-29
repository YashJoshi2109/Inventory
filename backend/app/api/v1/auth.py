from datetime import datetime, timezone
import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.database import DbSession
from app.core.events import DomainEvent, EventType, event_bus
from app.core.notifications import send_login_email, send_otp_email, send_welcome_email
from app.core.otp import consume_otp, issue_otp_for_email
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from app.models.user import User, UserRole
from app.repositories.user_repo import UserRepository
from app.schemas.common import MessageResponse
from app.schemas.user import (
    LoginRequest,
    OTPSendRequest,
    OTPVerifyRequest,
    PasswordResetRequest,
    PasswordResetConfirm,
    RefreshRequest,
    TokenResponse,
    UserRead,
)
from app.core.config import settings
from app.core.security import hash_password
from app.repositories.user_repo import RoleRepository
from pydantic import EmailStr, Field
from sqlalchemy.exc import IntegrityError


class RegisterRequest(LoginRequest):
    """Public self-registration — only viewer/manager roles are allowed."""

    username: str = Field(min_length=3, max_length=100, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=128)
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=255)
    role: str = Field(default="viewer", pattern=r"^(viewer|manager)$")

router = APIRouter(prefix="/auth", tags=["auth"])
bearer = HTTPBearer(auto_error=False)
_log = logging.getLogger(__name__)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    session: DbSession,
) -> User:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = decode_token(credentials.credentials)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")

    user_repo = UserRepository(session)
    user = await user_repo.get_with_roles(int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: str):
    """Role-based access control dependency factory."""
    async def check(user: CurrentUser) -> User:
        if user.is_superuser:
            return user
        user_roles = {ur.role.name for ur in user.roles if ur.role}
        if not user_roles.intersection(roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires one of: {', '.join(roles)}",
            )
        return user
    return check


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(body: RegisterRequest, session: DbSession) -> TokenResponse:
    """Public self-registration — assigns viewer or manager role only."""
    user_repo = UserRepository(session)
    role_repo = RoleRepository(session)

    if await user_repo.get_by_username(body.username):
        raise HTTPException(status_code=409, detail=f"Username '{body.username}' is already taken")
    if await user_repo.get_by_email(body.email):
        raise HTTPException(status_code=409, detail="Email address already registered")

    user = User(
        email=body.email.lower(),
        username=body.username,
        full_name=body.full_name,
        hashed_password=hash_password(body.password),
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError:
        # Race condition protection: unique constraint on users.email / users.username
        raise HTTPException(status_code=409, detail="Email or username already registered")

    # Ensure role name is lowercase for database lookup
    role_name = body.role.lower().strip()
    role = await role_repo.get_by_name(role_name)
    if not role:
        raise HTTPException(status_code=400, detail=f"Role '{body.role}' not found. Available roles: viewer, manager")
    
    session.add(UserRole(user_id=user.id, role_id=role.id))
    await session.flush()
    await session.refresh(user)

    # Fire-and-forget welcome email (do not block registration).
    # Copy primitives before create_task: the task may run while the request session
    # is committing/closing; touching ORM instances afterward can break the commit.
    if user.email:
        to_email = user.email
        full_nm = user.full_name
        uname = user.username
        uid = user.id

        async def _send_welcome_and_log() -> None:
            ok, detail = await send_welcome_email(
                to_email=to_email, full_name=full_nm, username=uname
            )
            if not ok:
                _log.warning("Welcome email failed user_id=%s email=%s detail=%s", uid, to_email, detail)

        asyncio.create_task(_send_welcome_and_log())

    # Use the already-resolved role_name directly — avoids async lazy-load of user.roles
    role_names = [role_name]
    access = create_access_token(user.id, extra={"roles": role_names, "username": user.username})
    refresh = create_refresh_token(user.id)
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request, session: DbSession) -> TokenResponse:
    repo = UserRepository(session)
    user = await repo.get_by_username(body.username)
    if not user and "@" in body.username:
        user = await repo.get_by_email(body.username)
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    user.last_login_at = datetime.now(timezone.utc)
    await session.flush()

    role_names = [ur.role.name for ur in user.roles if ur.role]
    access = create_access_token(user.id, extra={"roles": role_names, "username": user.username})
    refresh = create_refresh_token(user.id)

    await event_bus.publish(DomainEvent(
        event_type=EventType.USER_LOGIN,
        payload={"user_id": user.id, "username": user.username, "ip": request.client.host if request.client else None},
        actor_id=user.id,
    ))

    # Fire-and-forget login notification email (do not block login).
    if user.email:
        to_email = user.email
        full_nm = user.full_name
        uid = user.id
        client_ip = request.client.host if request.client else None

        async def _send_login_and_log() -> None:
            ok, detail = await send_login_email(
                to_email=to_email,
                full_name=full_nm,
                ip=client_ip,
            )
            if not ok:
                _log.warning("Login email failed user_id=%s email=%s detail=%s", uid, to_email, detail)

        asyncio.create_task(_send_login_and_log())

    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


OTP_SEND_OK = MessageResponse(
    message="If an account exists for this email, a verification code was sent.",
    success=True,
)


@router.post("/otp/send", response_model=MessageResponse)
async def otp_send(body: OTPSendRequest, session: DbSession) -> MessageResponse:
    """Request a 6-digit email OTP for verification. Response text is fixed to avoid account enumeration."""
    issued = await issue_otp_for_email(session, email=body.email)
    if issued is None:
        return OTP_SEND_OK
    otp, user = issued
    ok, detail = await send_otp_email(to_email=user.email, full_name=user.full_name, otp=otp)
    if not ok:
        user.otp_code = None
        user.otp_expires_at = None
        await session.flush()
        _log.warning("OTP email send failed email=%s detail=%s", user.email, detail)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not send verification email. Try again later or contact support.",
        )
    return OTP_SEND_OK


@router.post("/otp/verify", response_model=TokenResponse)
async def otp_verify(body: OTPVerifyRequest, request: Request, session: DbSession) -> TokenResponse:
    """Verify OTP, mark email verified, and return access/refresh tokens."""
    ok, user = await consume_otp(session, email=body.email, otp=body.otp)
    if not ok or not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification code.",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    user.last_login_at = datetime.now(timezone.utc)
    await session.flush()

    role_names = [ur.role.name for ur in user.roles if ur.role]
    access = create_access_token(user.id, extra={"roles": role_names, "username": user.username})
    refresh = create_refresh_token(user.id)

    await event_bus.publish(
        DomainEvent(
            event_type=EventType.USER_LOGIN,
            payload={
                "user_id": user.id,
                "username": user.username,
                "ip": request.client.host if request.client else None,
                "via": "otp_verify",
            },
            actor_id=user.id,
        )
    )

    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


RESET_SEND_OK = MessageResponse(
    message="If an account exists for this email, a password reset code was sent.",
    success=True,
)


@router.post("/password-reset/request", response_model=MessageResponse)
async def password_reset_request(body: PasswordResetRequest, session: DbSession) -> MessageResponse:
    """Send a 6-digit OTP to the email for password reset. Enumeration-safe response."""
    issued = await issue_otp_for_email(session, email=body.email)
    if issued is None:
        return RESET_SEND_OK
    otp, user = issued
    ok, detail = await send_otp_email(to_email=user.email, full_name=user.full_name, otp=otp)
    if not ok:
        user.otp_code = None
        user.otp_expires_at = None
        await session.flush()
        _log.warning("Password reset OTP email failed email=%s detail=%s", user.email, detail)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not send reset email. Try again later or contact support.",
        )
    return RESET_SEND_OK


@router.post("/password-reset/confirm", response_model=MessageResponse)
async def password_reset_confirm(body: PasswordResetConfirm, session: DbSession) -> MessageResponse:
    """Verify OTP and set new password."""
    ok, user = await consume_otp(session, email=body.email, otp=body.otp)
    if not ok or not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset code.",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")
    user.hashed_password = hash_password(body.new_password)
    await session.flush()
    return MessageResponse(message="Password updated successfully.", success=True)


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(body: RefreshRequest, session: DbSession) -> TokenResponse:
    try:
        payload = decode_token(body.refresh_token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")

    repo = UserRepository(session)
    user = await repo.get_with_roles(int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    role_names = [ur.role.name for ur in user.roles if ur.role]
    access = create_access_token(user.id, extra={"roles": role_names, "username": user.username})
    refresh = create_refresh_token(user.id)
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.get("/me", response_model=UserRead)
async def get_me(current_user: CurrentUser, session: DbSession) -> UserRead:
    repo = UserRepository(session)
    user = await repo.get_with_roles(current_user.id)
    return UserRead.model_validate(user)
