import base64
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import inspect as sa_inspect

from app.api.v1.auth import CurrentUser, require_roles
from app.core.database import DbSession
from app.core.events import DomainEvent, EventType, event_bus
from app.models.item import Item, ItemBarcode, Category
from app.models.user import RoleName
from app.repositories.item_repo import CategoryRepository, ItemRepository
from app.repositories.transaction_repo import StockLevelRepository
from app.schemas.common import MessageResponse, PaginatedResponse
from app.schemas.item import (
    CategoryCreate,
    CategoryRead,
    ItemBarcodeRead,
    ItemCreate,
    ItemRead,
    ItemSummary,
    ItemUpdate,
    StockLevelRead,
)

router = APIRouter(prefix="/items", tags=["items"])


def _to_item_read(item: Item, total_qty: Decimal) -> ItemRead:
    status = "OUT" if total_qty <= 0 else ("LOW" if total_qty <= item.reorder_level else "OK")
    # In async SQLAlchemy, lazy-loading relationships can raise MissingGreenlet.
    # We only access relationships when they are already loaded.
    insp = sa_inspect(item)
    category = item.category if insp.attrs.category.loaded else None
    barcodes = item.barcodes if insp.attrs.barcodes.loaded else []
    return ItemRead.model_validate({
        **item.__dict__,
        "total_quantity": total_qty,
        "status": status,
        "category": category,
        "barcodes": barcodes,
    })


# ─── Categories ─────────────────────────────────────────────────────────────

@router.get("/categories", response_model=list[CategoryRead])
async def list_categories(session: DbSession, current_user: CurrentUser) -> list[CategoryRead]:
    repo = CategoryRepository(session)
    cats = await repo.get_all()
    return [CategoryRead.model_validate(c) for c in cats]


@router.post(
    "/categories",
    response_model=CategoryRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
)
async def create_category(body: CategoryCreate, session: DbSession, current_user: CurrentUser) -> CategoryRead:
    repo = CategoryRepository(session)
    existing = await repo.get_by_name(body.name)
    if existing:
        raise HTTPException(status_code=409, detail=f"Category '{body.name}' already exists")
    cat = Category(**body.model_dump())
    session.add(cat)
    await session.flush()
    return CategoryRead.model_validate(cat)


# ─── Items ───────────────────────────────────────────────────────────────────

@router.get("", response_model=PaginatedResponse[ItemSummary])
async def list_items(
    session: DbSession,
    current_user: CurrentUser,
    q: str | None = Query(default=None, description="Search query"),
    category_id: int | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> PaginatedResponse[ItemSummary]:
    repo = ItemRepository(session)
    stock_repo = StockLevelRepository(session)
    skip = (page - 1) * page_size

    items, total = await repo.search(
        query=q,
        category_id=category_id,
        skip=skip,
        limit=page_size,
    )

    summaries = []
    for item in items:
        total_qty = await stock_repo.get_total_for_item(item.id)
        item_status = "OUT" if total_qty <= 0 else ("LOW" if total_qty <= item.reorder_level else "OK")
        if status_filter and item_status != status_filter.upper():
            continue
        summaries.append(ItemSummary(
            id=item.id,
            sku=item.sku,
            name=item.name,
            unit=item.unit,
            category_name=item.category.name if item.category else None,
            total_quantity=total_qty,
            reorder_level=item.reorder_level,
            status=item_status,
            unit_cost=item.unit_cost,
        ))

    return PaginatedResponse(
        items=summaries,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size,
    )


@router.post(
    "",
    response_model=ItemRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER, RoleName.OPERATOR))],
)
async def create_item(body: ItemCreate, session: DbSession, current_user: CurrentUser) -> ItemRead:
    repo = ItemRepository(session)
    if await repo.get_by_sku(body.sku):
        raise HTTPException(status_code=409, detail=f"SKU '{body.sku}' already exists")

    from app.services.barcode_service import render_qr_png
    item = Item(**body.model_dump())
    session.add(item)
    await session.flush()

    qr_bytes = render_qr_png(item.sku)
    bc = ItemBarcode(
        item_id=item.id,
        barcode_type="qr",
        barcode_value=item.sku,
        qr_image=qr_bytes,
        is_primary=True,
    )
    session.add(bc)
    await session.flush()
    await session.refresh(item)

    await event_bus.publish(DomainEvent(
        event_type=EventType.ITEM_CREATED,
        payload={"item_id": item.id, "sku": item.sku, "name": item.name},
        actor_id=current_user.id,
    ))

    read = _to_item_read(item, Decimal("0"))
    return read.model_copy(
        update={"qr_png_base64": base64.standard_b64encode(qr_bytes).decode("ascii")},
    )


@router.get("/{item_id}", response_model=ItemRead)
async def get_item(item_id: int, session: DbSession, current_user: CurrentUser) -> ItemRead:
    repo = ItemRepository(session)
    item = await repo.get_with_details(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    total_qty = await StockLevelRepository(session).get_total_for_item(item_id)
    return _to_item_read(item, total_qty)


@router.patch(
    "/{item_id}",
    response_model=ItemRead,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER, RoleName.OPERATOR))],
)
async def update_item(item_id: int, body: ItemUpdate, session: DbSession, current_user: CurrentUser) -> ItemRead:
    repo = ItemRepository(session)
    item = await repo.get_with_details(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    await session.flush()

    await event_bus.publish(DomainEvent(
        event_type=EventType.ITEM_UPDATED,
        payload={"item_id": item.id, "sku": item.sku, "fields": list(body.model_dump(exclude_unset=True).keys())},
        actor_id=current_user.id,
    ))

    total_qty = await StockLevelRepository(session).get_total_for_item(item_id)
    return _to_item_read(item, total_qty)


@router.delete(
    "/{item_id}",
    response_model=MessageResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN))],
)
async def deactivate_item(item_id: int, session: DbSession, current_user: CurrentUser) -> MessageResponse:
    repo = ItemRepository(session)
    item = await repo.get_by_id(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    item.is_active = False
    await session.flush()
    return MessageResponse(message=f"Item {item.sku} deactivated")


@router.get("/{item_id}/stock-levels", response_model=list[StockLevelRead])
async def get_stock_levels(item_id: int, session: DbSession, current_user: CurrentUser) -> list[StockLevelRead]:
    from sqlalchemy import select
    from sqlalchemy.orm import joinedload
    from app.models.transaction import StockLevel

    result = await session.execute(
        select(StockLevel)
        .where(StockLevel.item_id == item_id)
        .options(joinedload(StockLevel.location))
    )
    levels = result.scalars().unique().all()
    return [
        StockLevelRead(
            id=sl.id,
            item_id=sl.item_id,
            location_id=sl.location_id,
            location_code=sl.location.code if sl.location else "",
            location_name=sl.location.name if sl.location else "",
            quantity=sl.quantity,
            last_event_at=sl.last_event_at,
        )
        for sl in levels
    ]
