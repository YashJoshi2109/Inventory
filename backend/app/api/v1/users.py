from fastapi import APIRouter, Depends, HTTPException, status

from app.api.v1.auth import CurrentUser, require_roles
from app.core.database import DbSession
from app.core.security import hash_password
from app.models.user import RoleName, User, UserRole
from app.repositories.user_repo import RoleRepository, UserRepository
from app.schemas.common import MessageResponse
from app.schemas.user import AdminPasswordResetRequest, PasswordChangeRequest, UserCreate, UserRead, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


def _is_admin_or_manager(user) -> bool:
    if user.is_superuser:
        return True
    return any(
        ur.role and ur.role.name in (RoleName.ADMIN, RoleName.MANAGER)
        for ur in (user.roles or [])
    )


def _is_admin(user) -> bool:
    if user.is_superuser:
        return True
    return any(
        ur.role and ur.role.name == RoleName.ADMIN
        for ur in (user.roles or [])
    )


@router.get("", response_model=list[UserRead])
async def list_users(session: DbSession, current_user: CurrentUser) -> list[UserRead]:
    if not _is_admin_or_manager(current_user):
        raise HTTPException(status_code=403, detail="Admin or manager role required")
    repo = UserRepository(session)
    users = await repo.list_users()
    return [UserRead.model_validate(u) for u in users]


@router.get("/roles", response_model=list[dict])
async def list_roles(session: DbSession, current_user: CurrentUser) -> list[dict]:
    """Return all available roles for assignment."""
    if not _is_admin_or_manager(current_user):
        raise HTTPException(status_code=403, detail="Admin or manager role required")
    repo = RoleRepository(session)
    roles = await repo.get_all()
    return [{"id": r.id, "name": r.name, "description": r.description} for r in roles]


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserCreate, session: DbSession, current_user: CurrentUser) -> UserRead:
    if not _is_admin_or_manager(current_user):
        raise HTTPException(status_code=403, detail="Admin or manager role required")

    repo = UserRepository(session)
    role_repo = RoleRepository(session)

    if await repo.get_by_username(body.username):
        raise HTTPException(status_code=409, detail=f"Username '{body.username}' already taken")
    if await repo.get_by_email(body.email):
        raise HTTPException(status_code=409, detail=f"Email '{body.email}' already registered")

    user = User(
        email=body.email.lower(),
        username=body.username,
        full_name=body.full_name,
        hashed_password=hash_password(body.password),
        email_verified=True,  # Admin-created users are pre-verified
    )
    session.add(user)
    await session.flush()

    # Managers cannot assign admin role
    allowed_role_ids = body.role_ids
    if not _is_admin(current_user) and allowed_role_ids:
        admin_role = await role_repo.get_by_name(RoleName.ADMIN)
        if admin_role:
            allowed_role_ids = [rid for rid in allowed_role_ids if rid != admin_role.id]

    roles = await role_repo.get_by_ids(allowed_role_ids)
    for role in roles:
        session.add(UserRole(user_id=user.id, role_id=role.id))
    await session.flush()
    await session.refresh(user)
    return UserRead.model_validate(user)


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: int, body: UserUpdate, session: DbSession, current_user: CurrentUser
) -> UserRead:
    repo = UserRepository(session)
    role_repo = RoleRepository(session)

    is_admin = _is_admin(current_user)
    is_admin_or_manager = _is_admin_or_manager(current_user)

    if not is_admin_or_manager and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Cannot modify other users")

    user = await repo.get_with_roles(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Managers cannot activate/deactivate admins
    if not is_admin and user.is_superuser:
        raise HTTPException(status_code=403, detail="Cannot modify a superuser account")

    updates = body.model_dump(exclude_unset=True, exclude={"role_ids"})
    for field, value in updates.items():
        setattr(user, field, value)

    if body.role_ids is not None and is_admin_or_manager:
        for ur in list(user.roles):
            await session.delete(ur)
        await session.flush()

        allowed_role_ids = body.role_ids
        if not is_admin:
            admin_role = await role_repo.get_by_name(RoleName.ADMIN)
            if admin_role:
                allowed_role_ids = [rid for rid in allowed_role_ids if rid != admin_role.id]

        roles = await role_repo.get_by_ids(allowed_role_ids)
        for role in roles:
            session.add(UserRole(user_id=user.id, role_id=role.id))

    await session.flush()
    await session.refresh(user)
    return UserRead.model_validate(user)


@router.delete("/{user_id}", response_model=MessageResponse)
async def deactivate_user(
    user_id: int, session: DbSession, current_user: CurrentUser
) -> MessageResponse:
    if not _is_admin_or_manager(current_user):
        raise HTTPException(status_code=403, detail="Admin or manager role required")
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")

    repo = UserRepository(session)
    user = await repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.is_superuser and not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Cannot deactivate a superuser account")

    user.is_active = False
    await session.flush()
    return MessageResponse(message=f"User '{user.username}' deactivated successfully")


@router.post("/{user_id}/change-password", response_model=MessageResponse)
async def change_password(
    user_id: int, body: PasswordChangeRequest, session: DbSession, current_user: CurrentUser
) -> MessageResponse:
    from app.core.security import verify_password

    if current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Can only change your own password")

    repo = UserRepository(session)
    user = await repo.get_by_id(user_id)
    if not user or not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Current password incorrect")

    user.hashed_password = hash_password(body.new_password)
    await session.flush()
    return MessageResponse(message="Password updated successfully")


@router.post(
    "/{user_id}/reset-password",
    response_model=MessageResponse,
)
async def admin_reset_password(
    user_id: int, body: AdminPasswordResetRequest, session: DbSession, current_user: CurrentUser
) -> MessageResponse:
    if not _is_admin_or_manager(current_user):
        raise HTTPException(status_code=403, detail="Admin or manager role required")

    repo = UserRepository(session)
    user = await repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.is_superuser and not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Cannot reset a superuser's password")

    user.hashed_password = hash_password(body.new_password)
    await session.flush()
    return MessageResponse(message="Password reset successfully")
