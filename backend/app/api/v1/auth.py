from datetime import datetime, timezone
import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.database import DbSession
from app.core.events import DomainEvent, EventType, event_bus
from app.core.notifications import (
    send_login_email,
    send_otp_email,
    send_welcome_email,
    send_role_request_to_managers,
    send_role_request_decision,
)
from app.core.otp import consume_otp, issue_otp_for_email
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from app.models.user import User, UserRole, RoleRequest, RoleRequestStatus
from app.repositories.user_repo import UserRepository
from app.schemas.common import MessageResponse
from app.schemas.user import (
    LoginRequest,
    OTPSendRequest,
    OTPVerifyRequest,
    PasswordResetRequest,
    PasswordResetConfirm,
    ProfileUpdateRequest,
    RefreshRequest,
    TokenResponse,
    UserRead,
)
from app.core.config import settings
from app.core.security import hash_password
from app.repositories.user_repo import RoleRepository
from pydantic import BaseModel, EmailStr, Field
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
    """
    Public self-registration.
    - viewer  → assigned immediately
    - manager → registered as viewer, pending RoleRequest created, managers notified
    """
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
        raise HTTPException(status_code=409, detail="Email or username already registered")

    requested_role = body.role.lower().strip()
    manager_requested = requested_role == "manager"

    # Always assign viewer first; manager access requires approval
    assigned_role_name = "viewer"
    viewer_role = await role_repo.get_by_name("viewer")
    if not viewer_role:
        raise HTTPException(status_code=500, detail="viewer role not found in database")

    session.add(UserRole(user_id=user.id, role_id=viewer_role.id))

    # If manager was requested, create a pending RoleRequest
    if manager_requested:
        role_req = RoleRequest(
            user_id=user.id,
            requested_role="manager",
            status=RoleRequestStatus.PENDING,
        )
        session.add(role_req)

    await session.flush()
    await session.refresh(user)

    # Copy primitives for fire-and-forget tasks
    to_email = user.email
    full_nm = user.full_name
    uname = user.username
    uid = user.id

    if to_email:
        async def _send_welcome_and_log() -> None:
            ok, detail = await send_welcome_email(
                to_email=to_email, full_name=full_nm, username=uname
            )
            if not ok:
                _log.warning("Welcome email failed user_id=%s email=%s detail=%s", uid, to_email, detail)

        asyncio.create_task(_send_welcome_and_log())

    if manager_requested and to_email:
        # Email all managers about the new role request
        req_id = role_req.id if manager_requested else 0

        async def _notify_managers() -> None:
            from sqlalchemy import select as _sel
            from app.core.database import AsyncSessionLocal
            from app.models.user import Role as _Role
            try:
                async with AsyncSessionLocal() as s:
                    mgr_role = (await s.execute(
                        _sel(_Role).where(_Role.name == "manager")
                    )).scalar_one_or_none()
                    if not mgr_role:
                        return
                    mgr_users = (await s.execute(
                        _sel(User).join(UserRole, User.id == UserRole.user_id)
                        .where(UserRole.role_id == mgr_role.id)
                        .where(User.is_active == True)  # noqa: E712
                    )).scalars().all()
                    admin_users = (await s.execute(
                        _sel(User).where(User.is_superuser == True)  # noqa: E712
                    )).scalars().all()
                    all_mgrs = {u.id: u for u in [*mgr_users, *admin_users]}
                    emails = [u.email for u in all_mgrs.values() if u.email]
                    if emails:
                        await send_role_request_to_managers(
                            requester_name=full_nm,
                            requester_username=uname,
                            requester_email=to_email,
                            request_id=req_id,
                            message=None,
                            manager_emails=emails,
                        )
            except Exception as exc:
                _log.warning("Manager notification email failed: %s", exc)

        asyncio.create_task(_notify_managers())

    access = create_access_token(user.id, extra={"roles": [assigned_role_name], "username": user.username})
    refresh = create_refresh_token(user.id)
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


# ── Role Request schemas ───────────────────────────────────────────────────────

class RoleRequestCreate(BaseModel):
    message: str | None = None


class RoleRequestRead(BaseModel):
    id: int
    user_id: int
    username: str | None = None
    full_name: str | None = None
    user_email: str | None = None
    requested_role: str
    status: str
    message: str | None
    review_note: str | None
    reviewed_at: str | None
    created_at: str

    model_config = {"from_attributes": True}


class RoleRequestReview(BaseModel):
    review_note: str | None = None


# ── Role Request endpoints ─────────────────────────────────────────────────────

@router.get("/role-requests", response_model=list[RoleRequestRead])
async def list_role_requests(
    session: DbSession,
    current_user: CurrentUser,
    status: str | None = None,
) -> list[RoleRequestRead]:
    """List all role requests — managers and admins only."""
    if not current_user.is_superuser:
        user_roles = {ur.role.name for ur in current_user.roles if ur.role}
        if not user_roles.intersection({"admin", "manager"}):
            raise HTTPException(status_code=403, detail="Requires manager or admin role")

    from sqlalchemy import select
    stmt = select(RoleRequest).join(User, RoleRequest.user_id == User.id)
    if status:
        stmt = stmt.where(RoleRequest.status == status)
    else:
        stmt = stmt.where(RoleRequest.status == RoleRequestStatus.PENDING)
    stmt = stmt.order_by(RoleRequest.created_at.desc())
    results = (await session.execute(stmt)).scalars().all()

    out = []
    for r in results:
        user_obj = await session.get(User, r.user_id)
        out.append(RoleRequestRead(
            id=r.id,
            user_id=r.user_id,
            username=user_obj.username if user_obj else None,
            full_name=user_obj.full_name if user_obj else None,
            user_email=user_obj.email if user_obj else None,
            requested_role=r.requested_role,
            status=r.status,
            message=r.message,
            review_note=r.review_note,
            reviewed_at=r.reviewed_at.isoformat() if r.reviewed_at else None,
            created_at=r.created_at.isoformat(),
        ))
    return out


@router.get("/role-requests/my", response_model=RoleRequestRead | None)
async def get_my_role_request(
    session: DbSession,
    current_user: CurrentUser,
) -> RoleRequestRead | None:
    """Get the current user's latest pending role request."""
    from sqlalchemy import select
    stmt = (
        select(RoleRequest)
        .where(RoleRequest.user_id == current_user.id)
        .order_by(RoleRequest.created_at.desc())
        .limit(1)
    )
    r = (await session.execute(stmt)).scalar_one_or_none()
    if not r:
        return None
    return RoleRequestRead(
        id=r.id,
        user_id=r.user_id,
        username=current_user.username,
        full_name=current_user.full_name,
        user_email=current_user.email,
        requested_role=r.requested_role,
        status=r.status,
        message=r.message,
        review_note=r.review_note,
        reviewed_at=r.reviewed_at.isoformat() if r.reviewed_at else None,
        created_at=r.created_at.isoformat(),
    )


@router.post("/role-requests", response_model=RoleRequestRead, status_code=201)
async def create_role_request(
    body: RoleRequestCreate,
    session: DbSession,
    current_user: CurrentUser,
) -> RoleRequestRead:
    """Request manager role upgrade (for existing users already registered as viewer)."""
    from sqlalchemy import select

    # Prevent duplicate pending requests
    existing = (await session.execute(
        select(RoleRequest)
        .where(RoleRequest.user_id == current_user.id)
        .where(RoleRequest.status == RoleRequestStatus.PENDING)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="You already have a pending role request.")

    # Don't allow managers to request manager role again
    user_roles = {ur.role.name for ur in current_user.roles if ur.role}
    if "manager" in user_roles or "admin" in user_roles or current_user.is_superuser:
        raise HTTPException(status_code=400, detail="You already have manager or higher access.")

    r = RoleRequest(
        user_id=current_user.id,
        requested_role="manager",
        status=RoleRequestStatus.PENDING,
        message=body.message,
    )
    session.add(r)
    await session.flush()

    # Email managers
    to_email = current_user.email
    full_nm = current_user.full_name
    uname = current_user.username
    req_id = r.id

    async def _notify() -> None:
        from app.core.database import AsyncSessionLocal
        from app.models.user import Role as _Role
        try:
            async with AsyncSessionLocal() as s:
                mgr_role = (await s.execute(
                    select(_Role).where(_Role.name == "manager")
                )).scalar_one_or_none()
                if not mgr_role:
                    return
                mgr_users = (await s.execute(
                    select(User).join(UserRole, User.id == UserRole.user_id)
                    .where(UserRole.role_id == mgr_role.id)
                    .where(User.is_active == True)  # noqa: E712
                )).scalars().all()
                admin_users = (await s.execute(
                    select(User).where(User.is_superuser == True)  # noqa: E712
                )).scalars().all()
                all_users = {u.id: u for u in [*mgr_users, *admin_users]}
                emails = [u.email for u in all_users.values() if u.email]
                if emails:
                    await send_role_request_to_managers(
                        requester_name=full_nm,
                        requester_username=uname,
                        requester_email=to_email or "",
                        request_id=req_id,
                        message=body.message,
                        manager_emails=emails,
                    )
        except Exception as exc:
            _log.warning("Manager notification email failed: %s", exc)

    asyncio.create_task(_notify())

    return RoleRequestRead(
        id=r.id,
        user_id=r.user_id,
        username=current_user.username,
        full_name=current_user.full_name,
        user_email=current_user.email,
        requested_role=r.requested_role,
        status=r.status,
        message=r.message,
        review_note=r.review_note,
        reviewed_at=None,
        created_at=r.created_at.isoformat(),
    )


@router.post("/role-requests/{request_id}/approve", response_model=RoleRequestRead)
async def approve_role_request(
    request_id: int,
    body: RoleRequestReview,
    session: DbSession,
    current_user: CurrentUser,
) -> RoleRequestRead:
    """Approve a manager role request — managers and admins only."""
    if not current_user.is_superuser:
        user_roles = {ur.role.name for ur in current_user.roles if ur.role}
        if not user_roles.intersection({"admin", "manager"}):
            raise HTTPException(status_code=403, detail="Requires manager or admin role")

    from sqlalchemy import select
    r = await session.get(RoleRequest, request_id)
    if not r:
        raise HTTPException(status_code=404, detail="Role request not found")
    if r.status != RoleRequestStatus.PENDING:
        raise HTTPException(status_code=400, detail=f"Request is already {r.status}")

    # Grant the requested role
    role_repo = RoleRepository(session)
    target_role = await role_repo.get_by_name(r.requested_role)
    if not target_role:
        raise HTTPException(status_code=500, detail=f"Role '{r.requested_role}' not found in database")

    # Check they don't already have it
    existing_ur = (await session.execute(
        select(UserRole)
        .where(UserRole.user_id == r.user_id)
        .where(UserRole.role_id == target_role.id)
    )).scalar_one_or_none()
    if not existing_ur:
        session.add(UserRole(user_id=r.user_id, role_id=target_role.id))

    now = datetime.now(timezone.utc)
    r.status = RoleRequestStatus.APPROVED
    r.reviewed_by = current_user.id
    r.reviewed_at = now
    r.review_note = body.review_note
    await session.flush()

    # Email the requester
    target_user = await session.get(User, r.user_id)
    if target_user and target_user.email:
        email_to = target_user.email
        email_name = target_user.full_name
        note = body.review_note

        async def _send_approved() -> None:
            await send_role_request_decision(
                to_email=email_to, full_name=email_name, approved=True, review_note=note
            )
        asyncio.create_task(_send_approved())

    return RoleRequestRead(
        id=r.id, user_id=r.user_id,
        username=target_user.username if target_user else None,
        full_name=target_user.full_name if target_user else None,
        user_email=target_user.email if target_user else None,
        requested_role=r.requested_role, status=r.status,
        message=r.message, review_note=r.review_note,
        reviewed_at=r.reviewed_at.isoformat() if r.reviewed_at else None,
        created_at=r.created_at.isoformat(),
    )


@router.post("/role-requests/{request_id}/reject", response_model=RoleRequestRead)
async def reject_role_request(
    request_id: int,
    body: RoleRequestReview,
    session: DbSession,
    current_user: CurrentUser,
) -> RoleRequestRead:
    """Reject a manager role request — managers and admins only."""
    if not current_user.is_superuser:
        user_roles = {ur.role.name for ur in current_user.roles if ur.role}
        if not user_roles.intersection({"admin", "manager"}):
            raise HTTPException(status_code=403, detail="Requires manager or admin role")

    r = await session.get(RoleRequest, request_id)
    if not r:
        raise HTTPException(status_code=404, detail="Role request not found")
    if r.status != RoleRequestStatus.PENDING:
        raise HTTPException(status_code=400, detail=f"Request is already {r.status}")

    now = datetime.now(timezone.utc)
    r.status = RoleRequestStatus.REJECTED
    r.reviewed_by = current_user.id
    r.reviewed_at = now
    r.review_note = body.review_note
    await session.flush()

    target_user = await session.get(User, r.user_id)
    if target_user and target_user.email:
        email_to = target_user.email
        email_name = target_user.full_name
        note = body.review_note

        async def _send_rejected() -> None:
            await send_role_request_decision(
                to_email=email_to, full_name=email_name, approved=False, review_note=note
            )
        asyncio.create_task(_send_rejected())

    return RoleRequestRead(
        id=r.id, user_id=r.user_id,
        username=target_user.username if target_user else None,
        full_name=target_user.full_name if target_user else None,
        user_email=target_user.email if target_user else None,
        requested_role=r.requested_role, status=r.status,
        message=r.message, review_note=r.review_note,
        reviewed_at=r.reviewed_at.isoformat() if r.reviewed_at else None,
        created_at=r.created_at.isoformat(),
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


@router.patch("/me", response_model=UserRead)
async def update_me(body: ProfileUpdateRequest, current_user: CurrentUser, session: DbSession) -> UserRead:
    repo = UserRepository(session)
    if body.username and body.username != current_user.username:
        existing = await repo.get_by_username(body.username)
        if existing:
            raise HTTPException(status_code=409, detail=f"Username '{body.username}' is already taken")
        current_user.username = body.username
    if body.full_name is not None:
        current_user.full_name = body.full_name
    if body.email is not None:
        if not current_user.is_superuser:
            raise HTTPException(status_code=403, detail="Only superusers can change their email")
        existing = await repo.get_by_email(str(body.email))
        if existing and existing.id != current_user.id:
            raise HTTPException(status_code=409, detail="Email is already in use")
        current_user.email = str(body.email)
    await session.flush()
    await session.refresh(current_user)
    user = await repo.get_with_roles(current_user.id)
    return UserRead.model_validate(user)
