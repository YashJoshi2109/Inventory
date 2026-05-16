from decimal import Decimal

from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.item import Item, ItemBarcode, Category
from app.models.transaction import StockLevel
from app.repositories.base import BaseRepository


class ItemRepository(BaseRepository[Item]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Item, session)

    async def get_by_sku(self, sku: str) -> Item | None:
        result = await self.session.execute(
            select(Item)
            .where(Item.sku == sku.upper())
            .options(selectinload(Item.barcodes), selectinload(Item.category))
        )
        return result.scalar_one_or_none()

    async def get_with_details(self, item_id: int) -> Item | None:
        result = await self.session.execute(
            select(Item)
            .where(Item.id == item_id)
            .options(
                selectinload(Item.barcodes),
                selectinload(Item.category),
                selectinload(Item.stock_levels),
            )
        )
        return result.scalar_one_or_none()

    async def search(
        self,
        query: str | None = None,
        category_id: int | None = None,
        is_active: bool | None = True,
        status: str | None = None,
        owner_id: int | None = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[Item], int]:
        base_q = (
            select(Item)
            .options(selectinload(Item.category), selectinload(Item.barcodes))
        )

        if is_active is not None:
            base_q = base_q.where(Item.is_active == is_active)
        if category_id:
            base_q = base_q.where(Item.category_id == category_id)
        if owner_id is not None:
            base_q = base_q.where(Item.owner_id == owner_id)
        if query:
            pattern = f"%{query}%"
            base_q = base_q.where(
                or_(
                    Item.sku.ilike(pattern),
                    Item.name.ilike(pattern),
                    Item.description.ilike(pattern),
                    Item.supplier.ilike(pattern),
                    Item.part_number.ilike(pattern),
                )
            )

        count_q = select(func.count()).select_from(base_q.subquery())
        total_result = await self.session.execute(count_q)
        total = total_result.scalar_one()

        items_result = await self.session.execute(
            base_q.order_by(Item.name).offset(skip).limit(limit)
        )
        return list(items_result.scalars().all()), total

    async def get_by_barcode(self, barcode_value: str) -> Item | None:
        result = await self.session.execute(
            select(Item)
            .join(ItemBarcode)
            .where(ItemBarcode.barcode_value == barcode_value)
            .options(selectinload(Item.category), selectinload(Item.barcodes))
        )
        return result.scalar_one_or_none()

    async def get_low_stock_items(self) -> list[tuple[Item, Decimal]]:
        """Returns items where total stock <= reorder_level."""
        stock_sum = (
            select(StockLevel.item_id, func.sum(StockLevel.quantity).label("total_qty"))
            .group_by(StockLevel.item_id)
            .subquery()
        )
        result = await self.session.execute(
            select(Item, stock_sum.c.total_qty)
            .outerjoin(stock_sum, Item.id == stock_sum.c.item_id)
            .where(
                Item.is_active == True,
                func.coalesce(stock_sum.c.total_qty, 0) <= Item.reorder_level,
            )
            .options(selectinload(Item.category))
            .order_by(Item.name)
        )
        return [(row[0], row[1] or Decimal("0")) for row in result.all()]

    async def get_total_quantity(self, item_id: int) -> Decimal:
        result = await self.session.execute(
            select(func.coalesce(func.sum(StockLevel.quantity), 0))
            .where(StockLevel.item_id == item_id)
        )
        return result.scalar_one()


class CategoryRepository(BaseRepository[Category]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Category, session)

    async def get_by_name(self, name: str) -> Category | None:
        result = await self.session.execute(
            select(Category).where(func.lower(Category.name) == name.lower())
        )
        return result.scalar_one_or_none()

    async def get_all_with_counts(self) -> list[tuple[Category, int]]:
        result = await self.session.execute(
            select(Category, func.count(Item.id).label("item_count"))
            .outerjoin(Item, Item.category_id == Category.id)
            .group_by(Category.id)
            .order_by(Category.name)
        )
        return list(result.all())

    async def get_all_filtered(self, owner_id: int | None = None) -> list[Category]:
        q = select(Category)
        if owner_id is not None:
            q = q.where(Category.owner_id == owner_id)
        result = await self.session.execute(q.order_by(Category.name))
        return list(result.scalars().all())
