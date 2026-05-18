from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Request

from app.api.v1.auth import CurrentUser
from app.core.database import DbSession
from app.core.sandbox import sandbox_owner_id as _sandbox_oid
from app.core.notifications import get_email_service_status_for_ui
from app.repositories.item_repo import ItemRepository, CategoryRepository
from app.repositories.transaction_repo import (
    AlertRepository,
    InventoryEventRepository,
    StockLevelRepository,
)
from app.schemas.transaction import DashboardStats, EmailServiceStatusRead, InventoryEventRead

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/email-service-status", response_model=EmailServiceStatusRead)
async def email_service_status(_current_user: CurrentUser) -> EmailServiceStatusRead:
    """Email provider + free-tier hint for the portal (authenticated)."""
    return await get_email_service_status_for_ui()


def _to_event_read(event) -> InventoryEventRead:
    return InventoryEventRead(
        id=event.id,
        occurred_at=event.occurred_at,
        event_kind=event.event_kind,
        item_id=event.item_id,
        item_sku=event.item.sku if event.item else "",
        item_name=event.item.name if event.item else "",
        from_location_id=event.from_location_id,
        from_location_code=event.from_location.code if event.from_location else None,
        to_location_id=event.to_location_id,
        to_location_code=event.to_location.code if event.to_location else None,
        quantity=event.quantity,
        reference=event.reference,
        borrower=event.borrower,
        notes=event.notes,
        reason=event.reason,
        actor_username=event.actor.username if event.actor else None,
        source=event.source,
    )


@router.get("/stats", response_model=DashboardStats)
async def get_dashboard_stats(request: Request, session: DbSession, current_user: CurrentUser) -> DashboardStats:
    item_repo = ItemRepository(session)
    cat_repo = CategoryRepository(session)
    event_repo = InventoryEventRepository(session)
    stock_repo = StockLevelRepository(session)
    alert_repo = AlertRepository(session)
    owner_id = _sandbox_oid(request, current_user)

    # Total items & SKUs
    total_skus = await item_repo.count(owner_id=owner_id)

    # Low stock / out of stock
    low_stock_items = await item_repo.get_low_stock_items(owner_id=owner_id)
    items_low = sum(1 for _, qty in low_stock_items if qty > 0)
    items_out = sum(1 for _, qty in low_stock_items if qty <= 0)

    # Total inventory value: sum over all stock_levels * unit_cost
    from sqlalchemy import select, func
    from app.models.transaction import StockLevel
    from app.models.item import Item

    value_q = (
        select(func.sum(StockLevel.quantity * Item.unit_cost))
        .join(Item, StockLevel.item_id == Item.id)
        .where(Item.is_active == True)  # noqa: E712
    )
    if owner_id is not None:
        value_q = value_q.where(Item.owner_id == owner_id)
    value_result = await session.execute(value_q)
    total_value = Decimal(str(value_result.scalar_one() or 0))

    # Transaction counts
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=7)

    txn_today = await event_repo.get_transactions_count_since(today_start, actor_id=owner_id)
    txn_week = await event_repo.get_transactions_count_since(week_start, actor_id=owner_id)

    # Active alerts
    active_alerts = await alert_repo.count_active(owner_id=owner_id)

    # Category breakdown
    cats_with_counts = await cat_repo.get_all_with_counts(owner_id=owner_id)
    category_breakdown = [
        {
            "id": cat.id,
            "name": cat.name,
            "color": cat.color,
            "icon": cat.icon,
            "count": count,
        }
        for cat, count in cats_with_counts
    ]

    # Recent activity (last 15 events)
    recent_events = await event_repo.get_recent_activity(limit=15, actor_id=owner_id)
    recent_activity = [_to_event_read(e) for e in recent_events]

    # Top consumed (last 30 days)
    top_consumed = await event_repo.get_top_consumed(days=30, limit=8, actor_id=owner_id)

    return DashboardStats(
        total_items=total_skus,
        total_skus=total_skus,
        items_low_stock=items_low,
        items_out_of_stock=items_out,
        total_inventory_value=total_value,
        transactions_today=txn_today,
        transactions_this_week=txn_week,
        active_alerts=active_alerts,
        category_breakdown=category_breakdown,
        recent_activity=recent_activity,
        top_consumed=top_consumed,
    )
