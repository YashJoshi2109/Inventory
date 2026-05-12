from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, joinedload

from app.models.transaction import InventoryEvent, StockLevel, Alert, AuditLog
from app.models.item import Item
from app.models.location import Location
from app.models.user import User
from app.repositories.base import BaseRepository


class InventoryEventRepository(BaseRepository[InventoryEvent]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(InventoryEvent, session)

    async def get_events_paginated(
        self,
        item_id: int | None = None,
        location_id: int | None = None,
        event_kind: str | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[InventoryEvent], int]:
        q = (
            select(InventoryEvent)
            .options(
                joinedload(InventoryEvent.item),
                joinedload(InventoryEvent.from_location),
                joinedload(InventoryEvent.to_location),
                joinedload(InventoryEvent.actor),
            )
        )

        filters = []
        if item_id:
            filters.append(InventoryEvent.item_id == item_id)
        if location_id:
            filters.append(
                (InventoryEvent.to_location_id == location_id)
                | (InventoryEvent.from_location_id == location_id)
            )
        if event_kind:
            filters.append(InventoryEvent.event_kind == event_kind)
        if start_date:
            filters.append(InventoryEvent.occurred_at >= start_date)
        if end_date:
            filters.append(InventoryEvent.occurred_at <= end_date)

        if filters:
            q = q.where(and_(*filters))

        count_q = select(func.count()).select_from(q.subquery())
        total = (await self.session.execute(count_q)).scalar_one()

        events_result = await self.session.execute(
            q.order_by(InventoryEvent.occurred_at.desc()).offset(skip).limit(limit)
        )
        return list(events_result.scalars().unique().all()), total

    async def get_consumption_time_series(
        self, item_id: int, days: int = 90
    ) -> list[dict]:
        """Daily OUT quantity for the past N days — used for forecasting."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        result = await self.session.execute(
            select(
                func.date_trunc("day", InventoryEvent.occurred_at).label("day"),
                func.sum(InventoryEvent.quantity).label("qty"),
            )
            .where(
                InventoryEvent.item_id == item_id,
                InventoryEvent.event_kind == "STOCK_OUT",
                InventoryEvent.occurred_at >= cutoff,
            )
            .group_by("day")
            .order_by("day")
        )
        return [{"day": row.day.isoformat(), "qty": float(row.qty)} for row in result.all()]

    async def get_recent_activity(self, limit: int = 20) -> list[InventoryEvent]:
        result = await self.session.execute(
            select(InventoryEvent)
            .options(
                joinedload(InventoryEvent.item),
                joinedload(InventoryEvent.from_location),
                joinedload(InventoryEvent.to_location),
                joinedload(InventoryEvent.actor),
            )
            .order_by(InventoryEvent.occurred_at.desc())
            .limit(limit)
        )
        return list(result.scalars().unique().all())

    async def get_transactions_count_since(self, since: datetime) -> int:
        result = await self.session.execute(
            select(func.count()).select_from(InventoryEvent).where(
                InventoryEvent.occurred_at >= since
            )
        )
        return result.scalar_one()

    async def get_top_consumed(self, days: int = 30, limit: int = 10) -> list[dict]:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        result = await self.session.execute(
            select(
                Item.id,
                Item.sku,
                Item.name,
                func.sum(InventoryEvent.quantity).label("total_consumed"),
            )
            .join(Item, InventoryEvent.item_id == Item.id)
            .where(
                InventoryEvent.event_kind == "STOCK_OUT",
                InventoryEvent.occurred_at >= cutoff,
            )
            .group_by(Item.id, Item.sku, Item.name)
            .order_by(func.sum(InventoryEvent.quantity).desc())
            .limit(limit)
        )
        return [
            {"id": r.id, "sku": r.sku, "name": r.name, "total_consumed": float(r.total_consumed)}
            for r in result.all()
        ]


class StockLevelRepository(BaseRepository[StockLevel]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(StockLevel, session)

    async def get_by_item_location(self, item_id: int, location_id: int) -> StockLevel | None:
        result = await self.session.execute(
            select(StockLevel).where(
                StockLevel.item_id == item_id,
                StockLevel.location_id == location_id,
            )
        )
        return result.scalar_one_or_none()

    async def upsert(self, item_id: int, location_id: int, delta: Decimal) -> StockLevel:
        sl = await self.get_by_item_location(item_id, location_id)
        if sl is None:
            sl = StockLevel(item_id=item_id, location_id=location_id, quantity=delta)
            self.session.add(sl)
        else:
            sl.quantity += delta
            sl.last_event_at = datetime.now(timezone.utc)
        await self.session.flush()
        return sl

    async def list_by_item(self, item_id: int) -> list[StockLevel]:
        """All StockLevel rows for an item, with location eagerly loaded."""
        result = await self.session.execute(
            select(StockLevel)
            .where(StockLevel.item_id == item_id)
            .options(selectinload(StockLevel.location))
        )
        return list(result.scalars().all())

    async def get_total_for_item(self, item_id: int) -> Decimal:
        result = await self.session.execute(
            select(func.coalesce(func.sum(StockLevel.quantity), 0))
            .where(StockLevel.item_id == item_id)
        )
        return Decimal(str(result.scalar_one()))

    async def get_totals_for_items(self, item_ids: list[int]) -> dict[int, Decimal]:
        """Batch fetch stock totals for multiple items — single SQL query, no N+1."""
        if not item_ids:
            return {}
        result = await self.session.execute(
            select(StockLevel.item_id, func.sum(StockLevel.quantity).label("total"))
            .where(StockLevel.item_id.in_(item_ids))
            .group_by(StockLevel.item_id)
        )
        rows = result.all()
        totals: dict[int, Decimal] = {row.item_id: Decimal(str(row.total)) for row in rows}
        # items with no stock rows → 0
        for iid in item_ids:
            totals.setdefault(iid, Decimal("0"))
        return totals

    async def get_item_counts_for_locations(self, location_ids: list[int]) -> dict[int, int]:
        """Batch fetch total item quantities per location — single SQL query, no N+1."""
        if not location_ids:
            return {}
        result = await self.session.execute(
            select(StockLevel.location_id, func.sum(StockLevel.quantity).label("total"))
            .where(StockLevel.location_id.in_(location_ids))
            .group_by(StockLevel.location_id)
        )
        rows = result.all()
        counts: dict[int, int] = {row.location_id: int(row.total) for row in rows}
        for lid in location_ids:
            counts.setdefault(lid, 0)
        return counts

    async def get_by_location(self, location_id: int) -> list[StockLevel]:
        result = await self.session.execute(
            select(StockLevel)
            .where(StockLevel.location_id == location_id)
            .options(joinedload(StockLevel.item))
        )
        return list(result.scalars().unique().all())


class AlertRepository(BaseRepository[Alert]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Alert, session)

    async def get_active_alerts(self, skip: int = 0, limit: int = 50) -> list[Alert]:
        result = await self.session.execute(
            select(Alert)
            .where(Alert.is_resolved == False)  # noqa: E712
            .order_by(Alert.created_at.desc())
            .offset(skip)
            .limit(limit)
        )
        return list(result.scalars().all())

    async def count_active(self) -> int:
        result = await self.session.execute(
            select(func.count()).select_from(Alert).where(Alert.is_resolved == False)  # noqa: E712
        )
        return result.scalar_one()

    async def get_for_item(self, item_id: int) -> list[Alert]:
        result = await self.session.execute(
            select(Alert)
            .where(Alert.item_id == item_id, Alert.is_resolved == False)  # noqa: E712
            .order_by(Alert.created_at.desc())
        )
        return list(result.scalars().all())
