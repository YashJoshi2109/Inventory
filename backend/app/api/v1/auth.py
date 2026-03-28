from datetime import datetime, timezone
import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.database import DbSession
from app.core.events import DomainEvent, EventType, event_bus
from app.core.notifications import send_login_email, send_welcome_email
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from app.models.user import User
from app.repositories.user_repo import UserRepository
from app.schemas.user import LoginRequest, RefreshRequest, TokenResponse, UserRead
from app.core.config import settings
from app.models.user import User, UserRole
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

    role = await role_repo.get_by_name(body.role)
    if role:
        session.add(UserRole(user_id=user.id, role_id=role.id))
    await session.flush()
    await session.refresh(user)

    # Fire-and-forget welcome email (do not block registration).
    if user.email:
        async def _send_welcome_and_log() -> None:
            ok, detail = await send_welcome_email(
                to_email=user.email, full_name=user.full_name, username=user.username
            )
            if not ok:
                import logging
                logging.getLogger(__name__).warning(
                    "Welcome email failed user_id=%s email=%s detail=%s", user.id, user.email, detail
                )
        asyncio.create_task(_send_welcome_and_log())

    role_names = [body.role]
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
        async def _send_login_and_log() -> None:
            ok, detail = await send_login_email(
                to_email=user.email,
                full_name=user.full_name,
                ip=request.client.host if request.client else None,
            )
            if not ok:
                import logging
                logging.getLogger(__name__).warning(
                    "Login email failed user_id=%s email=%s detail=%s", user.id, user.email, detail
                )
        asyncio.create_task(_send_login_and_log())

    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


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
