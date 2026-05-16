from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, joinedload

from app.models.location import Area, Location, LocationBarcode
from app.repositories.base import BaseRepository


class AreaRepository(BaseRepository[Area]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Area, session)

    async def get_by_code(self, code: str) -> Area | None:
        result = await self.session.execute(
            select(Area).where(Area.code == code.upper())
        )
        return result.scalar_one_or_none()

    async def get_all_with_locations(self, owner_id: int | None = None) -> list[Area]:
        q = (
            select(Area)
            .options(selectinload(Area.locations).selectinload(Location.barcodes))
            .order_by(Area.name)
        )
        if owner_id is not None:
            q = q.where(Area.owner_id == owner_id)
        result = await self.session.execute(q)
        return list(result.scalars().unique().all())


class LocationRepository(BaseRepository[Location]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Location, session)

    async def get_by_code(self, code: str) -> Location | None:
        result = await self.session.execute(
            select(Location)
            .where(Location.code == code.upper())
            .options(selectinload(Location.barcodes), joinedload(Location.area))
        )
        return result.scalar_one_or_none()

    async def get_by_barcode(self, barcode_value: str) -> Location | None:
        result = await self.session.execute(
            select(Location)
            .join(LocationBarcode)
            .where(LocationBarcode.barcode_value == barcode_value)
            .options(joinedload(Location.area), selectinload(Location.barcodes))
        )
        return result.scalar_one_or_none()

    async def get_with_area(self, location_id: int) -> Location | None:
        result = await self.session.execute(
            select(Location)
            .where(Location.id == location_id)
            .options(joinedload(Location.area), selectinload(Location.barcodes))
        )
        return result.scalar_one_or_none()

    async def get_all_with_area(self, area_id: int | None = None) -> list[Location]:
        """Fetch all locations (or filtered by area) with area eager-loaded — single query."""
        q = (
            select(Location)
            .options(joinedload(Location.area), selectinload(Location.barcodes))
            .order_by(Location.code)
        )
        if area_id is not None:
            q = q.where(Location.area_id == area_id)
        result = await self.session.execute(q)
        return list(result.scalars().unique().all())

    async def get_by_area(self, area_id: int) -> list[Location]:
        result = await self.session.execute(
            select(Location)
            .where(Location.area_id == area_id)
            .options(selectinload(Location.barcodes))
            .order_by(Location.code)
        )
        return list(result.scalars().all())
