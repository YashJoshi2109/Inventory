from fastapi import APIRouter, Depends, HTTPException, status

from app.api.v1.auth import CurrentUser, require_roles
from app.core.database import DbSession
from app.core.security import hash_password
from app.models.user import RoleName, User, UserRole
from app.repositories.user_repo import RoleRepository, UserRepository
from app.schemas.common import MessageResponse
from app.schemas.user import AdminPasswordResetRequest, PasswordChangeRequest, UserCreate, UserRead, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get(
    "",
    response_model=list[UserRead],
    dependencies=[Depends(require_roles(RoleName.ADMIN))],
)
async def list_users(session: DbSession, current_user: CurrentUser) -> list[UserRead]:
    repo = UserRepository(session)
    users = await repo.list_users()
    return [UserRead.model_validate(u) for u in users]


@router.post(
    "",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(RoleName.ADMIN))],
)
async def create_user(body: UserCreate, session: DbSession, current_user: CurrentUser) -> UserRead:
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
    )
    session.add(user)
    await session.flush()

    roles = await role_repo.get_by_ids(body.role_ids)
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

    # Operators can only update themselves
    is_admin = current_user.is_superuser or any(
        ur.role.name == RoleName.ADMIN for ur in current_user.roles if ur.role
    )
    if not is_admin and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Cannot modify other users")

    user = await repo.get_with_roles(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    updates = body.model_dump(exclude_unset=True, exclude={"role_ids"})
    for field, value in updates.items():
        setattr(user, field, value)

    if body.role_ids is not None and is_admin:
        # Replace roles
        for ur in user.roles:
            await session.delete(ur)
        await session.flush()
        roles = await role_repo.get_by_ids(body.role_ids)
        for role in roles:
            session.add(UserRole(user_id=user.id, role_id=role.id))

    await session.flush()
    await session.refresh(user)
    return UserRead.model_validate(user)


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
    dependencies=[Depends(require_roles(RoleName.ADMIN))],
)
async def admin_reset_password(
    user_id: int, body: AdminPasswordResetRequest, session: DbSession, current_user: CurrentUser
) -> MessageResponse:
    repo = UserRepository(session)
    user = await repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.hashed_password = hash_password(body.new_password)
    await session.flush()
    return MessageResponse(message="Password reset successfully")
