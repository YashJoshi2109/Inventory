from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.user import User, Role, UserRole
from app.repositories.base import BaseRepository


class UserRepository(BaseRepository[User]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(User, session)

    async def get_by_email(self, email: str) -> User | None:
        result = await self.session.execute(
            select(User)
            .where(User.email == email.lower())
            .options(selectinload(User.roles).selectinload(UserRole.role))
        )
        return result.scalar_one_or_none()

    async def get_by_username(self, username: str) -> User | None:
        result = await self.session.execute(
            select(User)
            .where(User.username == username)
            .options(selectinload(User.roles).selectinload(UserRole.role))
        )
        return result.scalar_one_or_none()

    async def get_with_roles(self, user_id: int) -> User | None:
        result = await self.session.execute(
            select(User)
            .where(User.id == user_id)
            .options(selectinload(User.roles).selectinload(UserRole.role))
        )
        return result.scalar_one_or_none()

    async def list_users(self, skip: int = 0, limit: int = 50) -> list[User]:
        result = await self.session.execute(
            select(User)
            .options(selectinload(User.roles).selectinload(UserRole.role))
            .offset(skip)
            .limit(limit)
            .order_by(User.full_name)
        )
        return list(result.scalars().all())


class RoleRepository(BaseRepository[Role]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Role, session)

    async def get_by_name(self, name: str) -> Role | None:
        result = await self.session.execute(
            select(Role).where(Role.name == name)
        )
        return result.scalar_one_or_none()

    async def get_by_ids(self, ids: list[int]) -> list[Role]:
        result = await self.session.execute(
            select(Role).where(Role.id.in_(ids))
        )
        return list(result.scalars().all())
