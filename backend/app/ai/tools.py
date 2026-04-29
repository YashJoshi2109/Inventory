"""
Inventory agent tool-function implementations.

Each function is callable by the LLM agent via OpenAI function-calling.
All writes go through the existing InventoryService so business rules,
RBAC guards, and audit events are always enforced.

Functions returned as plain dicts so they can be JSON-serialized and
streamed back to the frontend as tool-result events.
"""
from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal
from typing import Any

import re

from sqlalchemy import select, func, text, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import Item, Category
from app.models.location import Area, Location
from app.models.transaction import StockLevel, InventoryEvent
from app.models.user import User
from app.models.chat import KnowledgeDocument, DocChunk
from app.repositories.item_repo import ItemRepository
from app.repositories.location_repo import LocationRepository
from app.repositories.transaction_repo import (
    InventoryEventRepository,
    StockLevelRepository,
)
from app.schemas.item import ItemCreate, ItemUpdate
from app.schemas.transaction import StockInRequest, StockOutRequest, TransferRequest
from app.services.inventory_service import InventoryService


# ── helpers ──────────────────────────────────────────────────────────────────

def _fmt_qty(v) -> str:
    try:
        f = float(v)
        return str(int(f)) if f == int(f) else f"{f:.2f}"
    except Exception:
        return str(v)


# ── tool implementations ──────────────────────────────────────────────────────

async def search_inventory(
    db: AsyncSession,
    query: str,
    limit: int = 10,
) -> dict:
    """Search inventory items by name, SKU, description, or supplier."""
    q = f"%{query.lower()}%"
    result = await db.execute(
        select(Item)
        .where(
            Item.is_active == True,  # noqa: E712
            (
                func.lower(Item.name).like(q)
                | func.lower(Item.sku).like(q)
                | func.lower(Item.description).like(q)
                | func.lower(Item.supplier).like(q)
            ),
        )
        .limit(limit)
    )
    items = result.scalars().all()

    stock_repo = StockLevelRepository(db)
    out = []
    for item in items:
        total = float(await stock_repo.get_total_for_item(item.id))
        out.append({
            "id": item.id,
            "sku": item.sku,
            "name": item.name,
            "description": item.description,
            "unit": item.unit,
            "total_quantity": total,
            "reorder_level": float(item.reorder_level),
            "supplier": item.supplier,
            "category_id": item.category_id,
        })

    return {"query": query, "total": len(out), "items": out}


async def get_item_details(
    db: AsyncSession,
    item_id_or_sku: str,
) -> dict:
    """Get full details for one item including all stock levels and last 5 transactions."""
    repo = ItemRepository(db)
    stock_repo = StockLevelRepository(db)
    event_repo = InventoryEventRepository(db)

    item: Item | None = None
    if item_id_or_sku.isdigit():
        item = await repo.get_by_id(int(item_id_or_sku))
    if item is None:
        item = await repo.get_by_sku(item_id_or_sku)
    if item is None:
        # try name search
        result = await db.execute(
            select(Item)
            .where(
                Item.is_active == True,  # noqa: E712
                func.lower(Item.name).like(f"%{item_id_or_sku.lower()}%"),
            )
            .limit(1)
        )
        item = result.scalar_one_or_none()

    if item is None:
        return {"error": f"Item '{item_id_or_sku}' not found"}

    # stock levels per location
    sl_result = await db.execute(
        select(StockLevel)
        .where(StockLevel.item_id == item.id, StockLevel.quantity > 0)
    )
    stock_levels = sl_result.scalars().all()
    stocks = []
    for sl in stock_levels:
        loc_result = await db.execute(select(Location).where(Location.id == sl.location_id))
        loc = loc_result.scalar_one_or_none()
        stocks.append({
            "location_id": sl.location_id,
            "location_code": loc.code if loc else "?",
            "location_name": loc.name if loc else "?",
            "quantity": float(sl.quantity),
        })

    # last 5 events
    events_raw = await event_repo.get_recent_for_item(item.id, limit=5)
    events = [
        {
            "event_kind": e.event_kind,
            "quantity": float(e.quantity),
            "occurred_at": e.occurred_at.isoformat(),
            "actor": e.actor.username if e.actor else "system",
            "notes": e.notes,
        }
        for e in events_raw
    ]

    cat_name = None
    if item.category_id:
        cat_result = await db.execute(select(Category).where(Category.id == item.category_id))
        cat = cat_result.scalar_one_or_none()
        cat_name = cat.name if cat else None

    return {
        "id": item.id,
        "sku": item.sku,
        "name": item.name,
        "description": item.description,
        "category": cat_name,
        "unit": item.unit,
        "unit_cost": float(item.unit_cost),
        "reorder_level": float(item.reorder_level),
        "supplier": item.supplier,
        "expiry_date": item.expiry_date.isoformat() if item.expiry_date else None,
        "hazard_class": item.hazard_class,
        "storage_conditions": item.storage_conditions,
        "notes": item.notes,
        "stock_levels": stocks,
        "total_quantity": sum(s["quantity"] for s in stocks),
        "recent_transactions": events,
    }


async def get_location_contents(
    db: AsyncSession,
    location_code: str,
) -> dict:
    """List all items currently stocked at a given location."""
    loc_result = await db.execute(
        select(Location).where(
            func.lower(Location.code) == location_code.lower()
        )
    )
    loc = loc_result.scalar_one_or_none()
    if loc is None:
        loc_result = await db.execute(
            select(Location).where(
                func.lower(Location.name).like(f"%{location_code.lower()}%")
            ).limit(1)
        )
        loc = loc_result.scalar_one_or_none()

    if loc is None:
        return {"error": f"Location '{location_code}' not found"}

    sl_result = await db.execute(
        select(StockLevel, Item)
        .join(Item, StockLevel.item_id == Item.id)
        .where(StockLevel.location_id == loc.id, StockLevel.quantity > 0)
    )
    rows = sl_result.all()
    items = [
        {
            "item_id": item.id,
            "sku": item.sku,
            "name": item.name,
            "quantity": float(sl.quantity),
            "unit": item.unit,
        }
        for sl, item in rows
    ]

    return {
        "location_id": loc.id,
        "location_code": loc.code,
        "location_name": loc.name,
        "area_id": loc.area_id,
        "item_count": len(items),
        "items": items,
    }


async def list_low_stock_items(
    db: AsyncSession,
    limit: int = 20,
) -> dict:
    """Return items whose total stock is at or below their reorder level."""
    # Single query: JOIN items with aggregated stock totals
    stock_totals_subq = (
        select(StockLevel.item_id, func.sum(StockLevel.quantity).label("total_qty"))
        .group_by(StockLevel.item_id)
        .subquery()
    )
    result = await db.execute(
        select(Item, stock_totals_subq.c.total_qty)
        .outerjoin(stock_totals_subq, Item.id == stock_totals_subq.c.item_id)
        .where(Item.is_active == True, Item.reorder_level > 0)  # noqa: E712
    )
    rows = result.all()

    low: list[dict] = []
    for item, total_qty in rows:
        total = float(total_qty or 0)
        if total <= float(item.reorder_level):
            low.append({
                "id": item.id,
                "sku": item.sku,
                "name": item.name,
                "current_stock": total,
                "reorder_level": float(item.reorder_level),
                "unit": item.unit,
                "supplier": item.supplier,
                "deficit": float(item.reorder_level) - total,
            })

    low.sort(key=lambda x: x["deficit"], reverse=True)
    return {"total": len(low), "items": low[:limit]}


async def list_overdue_items(
    db: AsyncSession,
    days_unused: int = 90,
    limit: int = 20,
) -> dict:
    """Items that have had no stock-out or transfer event in the last N days."""
    cutoff_sql = f"NOW() - INTERVAL '{days_unused} days'"
    subq = (
        select(InventoryEvent.item_id)
        .where(
            InventoryEvent.event_kind.in_(["STOCK_OUT", "TRANSFER"]),
            text(f"inventory_events.occurred_at >= {cutoff_sql}"),
        )
        .distinct()
        .scalar_subquery()
    )
    result = await db.execute(
        select(Item)
        .where(Item.is_active == True, ~Item.id.in_(subq))  # noqa: E712
        .limit(limit)
    )
    items = result.scalars().all()

    stock_repo = StockLevelRepository(db)
    out = []
    for item in items:
        total = float(await stock_repo.get_total_for_item(item.id))
        if total > 0:
            out.append({
                "id": item.id,
                "sku": item.sku,
                "name": item.name,
                "total_quantity": total,
                "unit": item.unit,
                "days_unused": days_unused,
            })

    return {
        "days_unused_threshold": days_unused,
        "total": len(out),
        "items": out,
    }


async def get_dashboard_summary(db: AsyncSession) -> dict:
    """High-level inventory KPI summary."""
    total_skus_r = await db.execute(select(func.count()).where(Item.is_active == True))  # noqa: E712
    total_skus = total_skus_r.scalar() or 0

    # Count low-stock items with a single aggregated query
    stock_totals_subq = (
        select(StockLevel.item_id, func.sum(StockLevel.quantity).label("total_qty"))
        .group_by(StockLevel.item_id)
        .subquery()
    )
    low_r = await db.execute(
        select(func.count())
        .select_from(Item)
        .outerjoin(stock_totals_subq, Item.id == stock_totals_subq.c.item_id)
        .where(
            Item.is_active == True,  # noqa: E712
            Item.reorder_level > 0,
            func.coalesce(stock_totals_subq.c.total_qty, 0) <= Item.reorder_level,
        )
    )
    low = low_r.scalar() or 0

    txn_today_r = await db.execute(
        select(func.count()).where(
            text("occurred_at::date = CURRENT_DATE")
        ).select_from(InventoryEvent)
    )
    txn_today = txn_today_r.scalar() or 0

    locs_r = await db.execute(select(func.count()).select_from(Location))
    locations = locs_r.scalar() or 0

    return {
        "total_skus": total_skus,
        "low_stock_items": low,
        "transactions_today": txn_today,
        "total_locations": locations,
        "summary": (
            f"Lab has {total_skus} active SKUs across {locations} locations. "
            f"{low} items are at or below reorder level. "
            f"{txn_today} transactions recorded today."
        ),
    }


async def perform_stock_in(
    db: AsyncSession,
    actor_id: int,
    item_id: int,
    location_id: int,
    quantity: float,
    notes: str | None = None,
    reference: str | None = None,
) -> dict:
    """Add stock to an item at a location (AI-initiated stock-in)."""
    svc = InventoryService(db)
    req = StockInRequest(
        item_id=item_id,
        location_id=location_id,
        quantity=quantity,
        notes=notes,
        reference=reference or "AI Copilot",
    )
    event = await svc.stock_in(req, actor_id)
    await db.refresh(event, ["item", "to_location"])
    return {
        "success": True,
        "event_id": event.id,
        "item_name": event.item.name if event.item else str(item_id),
        "location": event.to_location.code if event.to_location else str(location_id),
        "quantity_added": float(quantity),
        "message": f"Added {_fmt_qty(quantity)} units to {event.to_location.code if event.to_location else location_id}.",
    }


async def perform_stock_out(
    db: AsyncSession,
    actor_id: int,
    actor_roles: list[str],
    item_id: int,
    location_id: int,
    quantity: float,
    reason: str | None = None,
    notes: str | None = None,
) -> dict:
    """Remove stock from an item at a location."""
    svc = InventoryService(db)
    req = StockOutRequest(
        item_id=item_id,
        location_id=location_id,
        quantity=quantity,
        reason=reason,
        notes=notes,
        reference="AI Copilot",
    )
    event = await svc.stock_out(req, actor_id, actor_roles)
    await db.refresh(event, ["item", "from_location"])
    return {
        "success": True,
        "event_id": event.id,
        "item_name": event.item.name if event.item else str(item_id),
        "quantity_removed": float(quantity),
        "message": f"Removed {_fmt_qty(quantity)} units from {event.from_location.code if event.from_location else location_id}.",
    }


async def perform_transfer(
    db: AsyncSession,
    actor_id: int,
    item_id: int,
    from_location_id: int,
    to_location_id: int,
    quantity: float,
    notes: str | None = None,
) -> dict:
    """Transfer stock between locations."""
    svc = InventoryService(db)
    req = TransferRequest(
        item_id=item_id,
        from_location_id=from_location_id,
        to_location_id=to_location_id,
        quantity=quantity,
        notes=notes,
        reference="AI Copilot",
    )
    event = await svc.transfer(req, actor_id)
    await db.refresh(event, ["item", "from_location", "to_location"])
    return {
        "success": True,
        "event_id": event.id,
        "item_name": event.item.name if event.item else str(item_id),
        "from": event.from_location.code if event.from_location else str(from_location_id),
        "to": event.to_location.code if event.to_location else str(to_location_id),
        "quantity": float(quantity),
        "message": (
            f"Transferred {_fmt_qty(quantity)} units from "
            f"{event.from_location.code if event.from_location else from_location_id} "
            f"to {event.to_location.code if event.to_location else to_location_id}."
        ),
    }


async def list_locations(db: AsyncSession, location_type: str | None = None) -> dict:
    """List all lab locations (areas and racks)."""
    out: list[dict[str, Any]] = []

    # Areas
    if location_type in (None, "area"):
        area_res = await db.execute(select(Area).where(Area.is_active == True))  # noqa: E712
        for a in area_res.scalars().all():
            out.append({
                "id": a.id,
                "code": a.code,
                "name": a.name,
                "type": "area",
                "parent_id": None,
            })

    # Racks / bins (Location)
    if location_type in (None, "rack"):
        loc_res = await db.execute(select(Location).where(Location.is_active == True))  # noqa: E712
        for l in loc_res.scalars().all():
            out.append({
                "id": l.id,
                "code": l.code,
                "name": l.name,
                "type": "rack",
                "parent_id": l.area_id,
            })

    return {"total": len(out), "locations": out}


async def get_transaction_history(
    db: AsyncSession,
    item_id: int | None = None,
    limit: int = 20,
) -> dict:
    """Get recent transaction history, optionally filtered by item."""
    q = (
        select(InventoryEvent)
        .order_by(InventoryEvent.occurred_at.desc())
        .limit(limit)
    )
    if item_id:
        q = q.where(InventoryEvent.item_id == item_id)
    result = await db.execute(q)
    events = result.scalars().all()

    out = []
    for e in events:
        await db.refresh(e, ["item", "actor", "from_location", "to_location"])
        out.append({
            "id": e.id,
            "event_kind": e.event_kind,
            "item_sku": e.item.sku if e.item else None,
            "item_name": e.item.name if e.item else None,
            "quantity": float(e.quantity),
            "from_location": e.from_location.code if e.from_location else None,
            "to_location": e.to_location.code if e.to_location else None,
            "actor": e.actor.username if e.actor else "system",
            "occurred_at": e.occurred_at.isoformat(),
            "notes": e.notes,
        })

    return {"total": len(out), "transactions": out}


async def create_item(
    db: AsyncSession,
    sku: str,
    name: str,
    unit: str = "pcs",
    description: str | None = None,
    unit_cost: float = 0.0,
    reorder_level: float = 0.0,
    supplier: str | None = None,
    category_id: int | None = None,
    notes: str | None = None,
) -> dict:
    """Create a new inventory item."""
    repo = ItemRepository(db)
    # Check if SKU already exists
    existing = await repo.get_by_sku(sku)
    if existing:
        return {"error": f"Item with SKU '{sku.upper()}' already exists (id={existing.id}, name={existing.name})."}
    data = ItemCreate(
        sku=sku,
        name=name,
        unit=unit,
        description=description,
        unit_cost=Decimal(str(unit_cost)),
        reorder_level=Decimal(str(reorder_level)),
        supplier=supplier,
        category_id=category_id,
        notes=notes,
    )
    item = Item(**data.model_dump())
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return {
        "success": True,
        "id": item.id,
        "sku": item.sku,
        "name": item.name,
        "unit": item.unit,
        "message": f"Created item '{item.name}' (SKU: {item.sku}, ID: {item.id}).",
    }


async def update_item(
    db: AsyncSession,
    item_id_or_sku: str,
    name: str | None = None,
    description: str | None = None,
    unit: str | None = None,
    unit_cost: float | None = None,
    reorder_level: float | None = None,
    supplier: str | None = None,
    category_id: int | None = None,
    notes: str | None = None,
    is_active: bool | None = None,
) -> dict:
    """Update fields on an existing inventory item."""
    repo = ItemRepository(db)
    item: Item | None = None
    if item_id_or_sku.isdigit():
        item = await repo.get_by_id(int(item_id_or_sku))
    if item is None:
        item = await repo.get_by_sku(item_id_or_sku)
    if item is None:
        result = await db.execute(
            select(Item)
            .where(Item.is_active == True, func.lower(Item.name).like(f"%{item_id_or_sku.lower()}%"))  # noqa: E712
            .limit(1)
        )
        item = result.scalar_one_or_none()
    if item is None:
        return {"error": f"Item '{item_id_or_sku}' not found"}

    changes: list[str] = []
    if name is not None:
        item.name = name; changes.append(f"name→{name}")
    if description is not None:
        item.description = description; changes.append("description updated")
    if unit is not None:
        item.unit = unit; changes.append(f"unit→{unit}")
    if unit_cost is not None:
        item.unit_cost = Decimal(str(unit_cost)); changes.append(f"unit_cost→{unit_cost}")
    if reorder_level is not None:
        item.reorder_level = Decimal(str(reorder_level)); changes.append(f"reorder_level→{reorder_level}")
    if supplier is not None:
        item.supplier = supplier; changes.append(f"supplier→{supplier}")
    if category_id is not None:
        item.category_id = category_id; changes.append(f"category_id→{category_id}")
    if notes is not None:
        item.notes = notes; changes.append("notes updated")
    if is_active is not None:
        item.is_active = is_active; changes.append(f"is_active→{is_active}")

    await db.flush()
    return {
        "success": True,
        "id": item.id,
        "sku": item.sku,
        "name": item.name,
        "changes": changes,
        "message": f"Updated item '{item.name}' (SKU: {item.sku}): {', '.join(changes) or 'no changes'}.",
    }


async def delete_item(
    db: AsyncSession,
    item_id_or_sku: str,
    hard_delete: bool = False,
) -> dict:
    """
    Deactivate (soft-delete) or permanently remove an inventory item.
    Default is soft-delete (sets is_active=False). Use hard_delete=true only when explicitly requested.
    """
    repo = ItemRepository(db)
    item: Item | None = None
    if item_id_or_sku.isdigit():
        item = await repo.get_by_id(int(item_id_or_sku))
    if item is None:
        item = await repo.get_by_sku(item_id_or_sku)
    if item is None:
        result = await db.execute(
            select(Item)
            .where(func.lower(Item.name).like(f"%{item_id_or_sku.lower()}%"))
            .limit(1)
        )
        item = result.scalar_one_or_none()
    if item is None:
        return {"error": f"Item '{item_id_or_sku}' not found"}

    if hard_delete:
        name, sku = item.name, item.sku
        await db.delete(item)
        await db.flush()
        return {"success": True, "message": f"Permanently deleted item '{name}' (SKU: {sku})."}
    else:
        item.is_active = False
        await db.flush()
        return {
            "success": True,
            "id": item.id,
            "sku": item.sku,
            "message": f"Deactivated item '{item.name}' (SKU: {item.sku}). It is no longer active but its history is preserved.",
        }


async def list_categories(db: AsyncSession) -> dict:
    """List all available item categories with their IDs, names, and types."""
    result = await db.execute(select(Category).order_by(Category.name))
    cats = result.scalars().all()
    return {
        "total": len(cats),
        "categories": [
            {"id": c.id, "name": c.name, "item_type": c.item_type}
            for c in cats
        ],
    }


# ── Category CRUD ────────────────────────────────────────────────────────────

async def create_category(
    db: AsyncSession,
    name: str,
    item_type: str = "CONSUMABLE",
    description: str | None = None,
    color: str | None = None,
    icon: str | None = None,
) -> dict:
    """Create a new item category. Name must be unique (case-insensitive)."""
    from app.repositories.item_repo import CategoryRepository
    repo = CategoryRepository(db)
    existing = await repo.get_by_name(name)
    if existing:
        return {"error": f"Category '{name}' already exists (id={existing.id})"}
    cat = Category(
        name=name.strip(),
        item_type=item_type,
        description=description,
        color=color,
        icon=icon,
    )
    db.add(cat)
    await db.flush()
    return {
        "success": True,
        "id": cat.id,
        "name": cat.name,
        "item_type": cat.item_type,
        "message": f"Created category '{cat.name}' (id={cat.id}).",
    }


async def update_category(
    db: AsyncSession,
    category_id_or_name: str,
    name: str | None = None,
    item_type: str | None = None,
    description: str | None = None,
    color: str | None = None,
    icon: str | None = None,
) -> dict:
    """Update fields on an existing category by ID or name."""
    from app.repositories.item_repo import CategoryRepository
    repo = CategoryRepository(db)
    cat: Category | None = None
    if category_id_or_name.isdigit():
        cat = await repo.get_by_id(int(category_id_or_name))
    if cat is None:
        cat = await repo.get_by_name(category_id_or_name)
    if cat is None:
        return {"error": f"Category '{category_id_or_name}' not found"}

    changes: list[str] = []
    if name is not None:
        cat.name = name.strip(); changes.append(f"name→{cat.name}")
    if item_type is not None:
        cat.item_type = item_type; changes.append(f"item_type→{item_type}")
    if description is not None:
        cat.description = description; changes.append("description updated")
    if color is not None:
        cat.color = color; changes.append(f"color→{color}")
    if icon is not None:
        cat.icon = icon; changes.append(f"icon→{icon}")

    await db.flush()
    return {
        "success": True,
        "id": cat.id,
        "name": cat.name,
        "changes": changes,
        "message": f"Updated category '{cat.name}': {', '.join(changes) or 'no changes'}.",
    }


async def delete_category(
    db: AsyncSession,
    category_id_or_name: str,
) -> dict:
    """Permanently delete a category. Items in this category will have their category_id set to NULL."""
    from app.repositories.item_repo import CategoryRepository
    repo = CategoryRepository(db)
    cat: Category | None = None
    if category_id_or_name.isdigit():
        cat = await repo.get_by_id(int(category_id_or_name))
    if cat is None:
        cat = await repo.get_by_name(category_id_or_name)
    if cat is None:
        return {"error": f"Category '{category_id_or_name}' not found"}

    # Count items that will be orphaned so caller can warn the user.
    item_count = await db.scalar(
        select(func.count(Item.id)).where(Item.category_id == cat.id)
    )
    name, cat_id = cat.name, cat.id
    await db.delete(cat)
    await db.flush()
    return {
        "success": True,
        "id": cat_id,
        "name": name,
        "orphaned_items": int(item_count or 0),
        "message": (
            f"Deleted category '{name}' (id={cat_id}). "
            f"{item_count or 0} item(s) had their category cleared (FK was ON DELETE SET NULL)."
        ),
    }


# ── Location CRUD ────────────────────────────────────────────────────────────

async def create_location(
    db: AsyncSession,
    code: str,
    name: str,
    area_id: int | None = None,
    area_code: str | None = None,
    description: str | None = None,
    shelf: str | None = None,
    bin_label: str | None = None,
    capacity: int | None = None,
) -> dict:
    """
    Create a new physical location (shelf/bin/rack). Must belong to an existing area —
    pass either area_id or area_code. A QR label is auto-generated.
    """
    from app.models.location import LocationBarcode
    from app.repositories.location_repo import AreaRepository, LocationRepository
    from app.services.barcode_service import render_qr_png

    loc_repo = LocationRepository(db)
    if await loc_repo.get_by_code(code):
        return {"error": f"Location code '{code}' already exists"}

    area_repo = AreaRepository(db)
    area = None
    if area_id is not None:
        area = await area_repo.get_by_id(area_id)
    elif area_code:
        area = await area_repo.get_by_code(area_code)
    if area is None:
        return {"error": "Area not found — pass a valid area_id or area_code"}

    loc = Location(
        area_id=area.id,
        code=code.strip(),
        name=name.strip(),
        description=description,
        shelf=shelf,
        bin_label=bin_label,
        capacity=capacity,
    )
    db.add(loc)
    await db.flush()

    # Mirror the REST endpoint — create the matching QR barcode row.
    barcode_val = f"LOC:{loc.code.upper()}"
    qr_bytes = render_qr_png(barcode_val)
    db.add(LocationBarcode(
        location_id=loc.id,
        barcode_value=barcode_val,
        barcode_type="qr",
        qr_image=qr_bytes,
    ))
    await db.flush()

    return {
        "success": True,
        "id": loc.id,
        "code": loc.code,
        "name": loc.name,
        "area_id": area.id,
        "area_code": area.code,
        "message": f"Created location '{loc.name}' (code={loc.code}, id={loc.id}) in area {area.code}.",
    }


async def update_location(
    db: AsyncSession,
    location_id_or_code: str,
    name: str | None = None,
    description: str | None = None,
    shelf: str | None = None,
    bin_label: str | None = None,
    capacity: int | None = None,
    is_active: bool | None = None,
) -> dict:
    """Update fields on an existing location by ID or code."""
    from app.repositories.location_repo import LocationRepository
    repo = LocationRepository(db)
    loc: Location | None = None
    if location_id_or_code.isdigit():
        loc = await repo.get_by_id(int(location_id_or_code))
    if loc is None:
        loc = await repo.get_by_code(location_id_or_code)
    if loc is None:
        return {"error": f"Location '{location_id_or_code}' not found"}

    changes: list[str] = []
    if name is not None:
        loc.name = name.strip(); changes.append(f"name→{loc.name}")
    if description is not None:
        loc.description = description; changes.append("description updated")
    if shelf is not None:
        loc.shelf = shelf; changes.append(f"shelf→{shelf}")
    if bin_label is not None:
        loc.bin_label = bin_label; changes.append(f"bin_label→{bin_label}")
    if capacity is not None:
        loc.capacity = capacity; changes.append(f"capacity→{capacity}")
    if is_active is not None:
        loc.is_active = is_active; changes.append(f"is_active→{is_active}")

    await db.flush()
    return {
        "success": True,
        "id": loc.id,
        "code": loc.code,
        "changes": changes,
        "message": f"Updated location '{loc.code}': {', '.join(changes) or 'no changes'}.",
    }


async def delete_location(
    db: AsyncSession,
    location_id_or_code: str,
    hard_delete: bool = False,
) -> dict:
    """
    Deactivate (soft, default) or permanently delete a location. Hard-delete is
    blocked if any stock is currently stored at this location — move it first.
    """
    from app.repositories.location_repo import LocationRepository
    repo = LocationRepository(db)
    loc: Location | None = None
    if location_id_or_code.isdigit():
        loc = await repo.get_by_id(int(location_id_or_code))
    if loc is None:
        loc = await repo.get_by_code(location_id_or_code)
    if loc is None:
        return {"error": f"Location '{location_id_or_code}' not found"}

    if hard_delete:
        stock_total = await db.scalar(
            select(func.coalesce(func.sum(StockLevel.quantity), 0))
            .where(StockLevel.location_id == loc.id)
        )
        if stock_total and stock_total > 0:
            return {
                "error": (
                    f"Cannot hard-delete location '{loc.code}' — {stock_total} unit(s) are stored here. "
                    "Transfer or remove the stock first, or use soft-delete (hard_delete=false)."
                ),
            }
        code, name = loc.code, loc.name
        await db.delete(loc)
        await db.flush()
        return {"success": True, "message": f"Permanently deleted location '{name}' (code={code})."}

    loc.is_active = False
    await db.flush()
    return {
        "success": True,
        "id": loc.id,
        "code": loc.code,
        "message": f"Deactivated location '{loc.name}' (code={loc.code}). History preserved.",
    }


async def rag_search_docs(
    db: AsyncSession,
    query: str,
    doc_type: str | None = None,
    limit: int = 6,
) -> dict:
    """
    Retrieve relevant knowledge-base chunks from uploaded documents.

    Uses Google text-embedding-004 cosine similarity when GEMINI_API_KEY is
    set and chunks have stored embeddings.  Falls back to keyword ILIKE ranking.
    """
    from app.ai.embeddings import embed_text, cosine_similarity, vec_from_json

    q = (query or "").strip().lower()
    if not q:
        return {"query": query, "total": 0, "chunks": []}

    # Fetch all active chunks (bounded to 200 for performance)
    q_stmt = (
        select(DocChunk, KnowledgeDocument)
        .join(KnowledgeDocument, KnowledgeDocument.id == DocChunk.doc_id)
        .where(KnowledgeDocument.is_active == True)  # noqa: E712
        .order_by(DocChunk.created_at.desc())
        .limit(200)
    )
    if doc_type:
        q_stmt = q_stmt.where(KnowledgeDocument.doc_type == doc_type)

    result = await db.execute(q_stmt)
    rows = result.all()

    # Try semantic ranking with embeddings
    query_vec = await embed_text(query)

    ranked: list[tuple[float, DocChunk, KnowledgeDocument]] = []
    for chunk, doc in rows:
        score = 0.0
        if query_vec and chunk.embedding_json:
            try:
                chunk_vec = vec_from_json(chunk.embedding_json)
                score = cosine_similarity(query_vec, chunk_vec)
            except Exception:
                score = 0.0
        else:
            # Fallback: keyword overlap scoring
            c = (chunk.content or "").lower()
            tokens = [t for t in re.findall(r"[a-z0-9]+", q) if len(t) >= 3] or [q]
            for t in tokens:
                if t in c:
                    score += 1.0 / max(1, len(tokens))

        # Recency boost (very small)
        if doc.created_at:
            age_days = max(0.0, (datetime.utcnow() - doc.created_at.replace(tzinfo=None)).total_seconds() / 86400.0)
            score += 0.01 / (1.0 + age_days)
        ranked.append((score, chunk, doc))

    ranked.sort(key=lambda x: x[0], reverse=True)
    top = ranked[:limit]

    chunks = [
        {
            "doc_id": doc.id,
            "doc_title": doc.title,
            "doc_type": doc.doc_type,
            "doc_filename": doc.filename,
            "chunk_index": chunk.chunk_index,
            "chunk_excerpt": (chunk.content or "")[:600],
            "score": round(float(score), 4),
        }
        for score, chunk, doc in top
        if (chunk.content or "").strip()
    ]

    return {"query": query, "doc_type": doc_type, "total": len(chunks), "chunks": chunks}


async def ask_user(
    component: str,
    question: str,
    options: list[dict[str, str]],
    context: str = "general",
) -> dict:
    """
    Emit an interactive widget to the user so they can select from a list of options.
    Use this when the user's intent is ambiguous and you need them to pick from
    a set of known values (e.g., location code, item name, category).
    - component: "checkbox" for multiple-select, "radio" for single-select.
    - question: The question to display to the user.
    - options: List of {value, label} dicts (up to 20).
    - context: A short identifier (e.g., "location_select", "item_select").
    Returns a special marker dict that the orchestrator intercepts as an SSE event.
    """
    return {
        "__interactive__": True,
        "component": component,
        "question": question,
        "options": options[:20],
        "context": context,
    }


# ── OpenAI tool schema definitions (JSON Schema) ──────────────────────────────

TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "search_inventory",
            "description": "Search inventory items by name, SKU, description, or supplier. Use this to look up items before performing operations.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search term (item name, SKU, or keyword)"},
                    "limit": {"type": "integer", "description": "Max results to return (1-50)", "default": 10},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_item_details",
            "description": "Get full details for a specific item including stock levels by location and last 5 transactions. Use item ID (number), SKU, or item name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "item_id_or_sku": {"type": "string", "description": "Item ID number, SKU code, or item name"},
                },
                "required": ["item_id_or_sku"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_location_contents",
            "description": "List all items currently stocked at a specific lab location/rack.",
            "parameters": {
                "type": "object",
                "properties": {
                    "location_code": {"type": "string", "description": "Location code (e.g. 'A-01') or location name"},
                },
                "required": ["location_code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_low_stock_items",
            "description": "Return items that are at or below their reorder level (running low or out of stock).",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "description": "Max results", "default": 20},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_overdue_items",
            "description": "Find items that haven't been used (no stock-out or transfer) in the last N days — helps identify unused or idle equipment.",
            "parameters": {
                "type": "object",
                "properties": {
                    "days_unused": {"type": "integer", "description": "Threshold in days (default 90)", "default": 90},
                    "limit": {"type": "integer", "description": "Max results", "default": 20},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_dashboard_summary",
            "description": "Get a high-level KPI summary of the entire inventory: total SKUs, low-stock count, today's transactions, etc.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "perform_stock_in",
            "description": "Add stock to an item at a specific location. Use search_inventory first to confirm item_id, and list_locations to confirm location_id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "item_id": {"type": "integer", "description": "ID of the item"},
                    "location_id": {"type": "integer", "description": "ID of the location to add stock to"},
                    "quantity": {"type": "number", "description": "Quantity to add (must be positive)"},
                    "notes": {"type": "string", "description": "Optional notes"},
                    "reference": {"type": "string", "description": "Optional reference number"},
                },
                "required": ["item_id", "location_id", "quantity"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "perform_stock_out",
            "description": "Remove stock from an item at a location. Use this for check-outs or consumption recording.",
            "parameters": {
                "type": "object",
                "properties": {
                    "item_id": {"type": "integer", "description": "ID of the item"},
                    "location_id": {"type": "integer", "description": "ID of the location to remove stock from"},
                    "quantity": {"type": "number", "description": "Quantity to remove"},
                    "reason": {"type": "string", "description": "Reason for removal (e.g. 'experiment use', 'checkout')"},
                    "notes": {"type": "string", "description": "Additional notes"},
                },
                "required": ["item_id", "location_id", "quantity"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "perform_transfer",
            "description": "Transfer stock from one location to another within the lab.",
            "parameters": {
                "type": "object",
                "properties": {
                    "item_id": {"type": "integer", "description": "ID of the item to transfer"},
                    "from_location_id": {"type": "integer", "description": "Source location ID"},
                    "to_location_id": {"type": "integer", "description": "Destination location ID"},
                    "quantity": {"type": "number", "description": "Quantity to transfer"},
                    "notes": {"type": "string", "description": "Transfer notes"},
                },
                "required": ["item_id", "from_location_id", "to_location_id", "quantity"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_locations",
            "description": "List all lab locations (areas and racks) with their codes and names.",
            "parameters": {
                "type": "object",
                "properties": {
                    "location_type": {
                        "type": "string",
                        "enum": ["area", "rack"],
                        "description": "Filter by type (optional)",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_transaction_history",
            "description": "Get recent inventory transaction history. Can be filtered by item ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "item_id": {"type": "integer", "description": "Filter by item ID (optional)"},
                    "limit": {"type": "integer", "description": "Number of records to return", "default": 20},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "rag_search_docs",
            "description": "Retrieve relevant knowledge-base chunks from uploaded documents (SOPs, manuals, warranties, calibration records, policies). Use this to answer SOP/policy/device questions grounded in docs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "What to look for in documents (keywords or question)."},
                    "doc_type": {"type": "string", "description": "Optional filter by document type (sop, manual, calibration, invoice, policy, maintenance, general)."},
                    "limit": {"type": "integer", "description": "How many chunks to return (1-10).", "default": 6},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_categories",
            "description": "List all available item categories with their IDs, names, and types. Call this before create_item or update_item when you need to set a category.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_item",
            "description": "Create a brand-new inventory item. Always confirm with the user before calling. Call list_categories first if you need to set category_id. Returns the new item's ID and SKU.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sku": {"type": "string", "description": "Unique SKU code (alphanumeric, hyphens, underscores). Will be uppercased."},
                    "name": {"type": "string", "description": "Full item name"},
                    "unit": {"type": "string", "description": "Unit of measure (e.g. pcs, ml, g, box)", "default": "pcs"},
                    "description": {"type": "string", "description": "Optional item description"},
                    "unit_cost": {"type": "number", "description": "Unit cost in dollars", "default": 0},
                    "reorder_level": {"type": "number", "description": "Trigger reorder when stock falls to this level", "default": 0},
                    "supplier": {"type": "string", "description": "Supplier name (optional)"},
                    "category_id": {"type": "integer", "description": "Category ID (optional)"},
                    "notes": {"type": "string", "description": "Additional notes"},
                },
                "required": ["sku", "name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_item",
            "description": "Update fields on an existing inventory item by ID, SKU, or name. Only provided fields are changed. Call list_categories first if changing category.",
            "parameters": {
                "type": "object",
                "properties": {
                    "item_id_or_sku": {"type": "string", "description": "Item ID number, SKU code, or item name"},
                    "name": {"type": "string", "description": "New name"},
                    "description": {"type": "string", "description": "New description"},
                    "unit": {"type": "string", "description": "New unit of measure"},
                    "unit_cost": {"type": "number", "description": "New unit cost"},
                    "reorder_level": {"type": "number", "description": "New reorder level"},
                    "supplier": {"type": "string", "description": "New supplier"},
                    "category_id": {"type": "integer", "description": "New category ID (get from list_categories)"},
                    "notes": {"type": "string", "description": "New notes"},
                    "is_active": {"type": "boolean", "description": "Set false to deactivate, true to reactivate"},
                },
                "required": ["item_id_or_sku"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_item",
            "description": "Deactivate (default) or permanently delete an inventory item. Always confirm with the user before calling. Soft-delete is reversible; hard_delete is not.",
            "parameters": {
                "type": "object",
                "properties": {
                    "item_id_or_sku": {"type": "string", "description": "Item ID, SKU, or name"},
                    "hard_delete": {"type": "boolean", "description": "true = permanently remove, false = deactivate (default)", "default": False},
                },
                "required": ["item_id_or_sku"],
            },
        },
    },
    # ── Category CRUD ──
    {
        "type": "function",
        "function": {
            "name": "create_category",
            "description": "Create a new item category. Always confirm the name with the user first. Name must be unique.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Category name (e.g. 'Chemicals', 'PPE')"},
                    "item_type": {"type": "string", "description": "CONSUMABLE / EQUIPMENT / etc.", "default": "CONSUMABLE"},
                    "description": {"type": "string", "description": "Optional description"},
                    "color": {"type": "string", "description": "Hex color for UI badges (e.g. #22d3ee)"},
                    "icon": {"type": "string", "description": "lucide-react icon name"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_category",
            "description": "Rename or edit metadata on an existing category.",
            "parameters": {
                "type": "object",
                "properties": {
                    "category_id_or_name": {"type": "string", "description": "Category ID or current name"},
                    "name": {"type": "string"},
                    "item_type": {"type": "string"},
                    "description": {"type": "string"},
                    "color": {"type": "string"},
                    "icon": {"type": "string"},
                },
                "required": ["category_id_or_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_category",
            "description": "Permanently delete a category. Items using it will have their category cleared (set to NULL). Confirm with the user before calling.",
            "parameters": {
                "type": "object",
                "properties": {
                    "category_id_or_name": {"type": "string", "description": "Category ID or name"},
                },
                "required": ["category_id_or_name"],
            },
        },
    },
    # ── Location CRUD ──
    {
        "type": "function",
        "function": {
            "name": "create_location",
            "description": "Create a new physical location (shelf/bin/rack). Must belong to an existing area — pass area_id or area_code. A QR label is auto-generated. Confirm with the user before calling.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "Unique location code (e.g. 'LAB-A-S01-B03')"},
                    "name": {"type": "string", "description": "Human-readable name"},
                    "area_id": {"type": "integer", "description": "Parent area ID"},
                    "area_code": {"type": "string", "description": "Parent area code (use instead of area_id)"},
                    "description": {"type": "string"},
                    "shelf": {"type": "string", "description": "Shelf label (e.g. 'S01')"},
                    "bin_label": {"type": "string", "description": "Bin label (e.g. 'B03')"},
                    "capacity": {"type": "integer", "description": "Max units this location holds"},
                },
                "required": ["code", "name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_location",
            "description": "Update fields on an existing location by ID or code.",
            "parameters": {
                "type": "object",
                "properties": {
                    "location_id_or_code": {"type": "string", "description": "Location ID or code"},
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "shelf": {"type": "string"},
                    "bin_label": {"type": "string"},
                    "capacity": {"type": "integer"},
                    "is_active": {"type": "boolean", "description": "false = deactivate, true = reactivate"},
                },
                "required": ["location_id_or_code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_location",
            "description": "Deactivate (soft, default) or permanently delete a location. Hard-delete refuses if stock is still stored there. Confirm with the user before calling.",
            "parameters": {
                "type": "object",
                "properties": {
                    "location_id_or_code": {"type": "string", "description": "Location ID or code"},
                    "hard_delete": {"type": "boolean", "default": False},
                },
                "required": ["location_id_or_code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ask_user",
            "description": (
                "Show the user an interactive selection widget (checkboxes or radio buttons) "
                "when their request is ambiguous and you need them to pick from a known list. "
                "Use 'checkbox' for multi-select (e.g., multiple locations for a transfer), "
                "'radio' for single-select (e.g., which specific item they mean). "
                "Call this INSTEAD of guessing. After the user selects, they will reply and you "
                "will receive a follow-up message with their selection."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "component": {
                        "type": "string",
                        "enum": ["checkbox", "radio"],
                        "description": "'checkbox' for multi-select, 'radio' for single-select",
                    },
                    "question": {
                        "type": "string",
                        "description": "The question to show the user, e.g. 'Which location did you mean?'",
                    },
                    "options": {
                        "type": "array",
                        "description": "List of choices (max 20). Each item has 'value' (the code/id) and 'label' (human-readable).",
                        "items": {
                            "type": "object",
                            "properties": {
                                "value": {"type": "string"},
                                "label": {"type": "string"},
                            },
                            "required": ["value", "label"],
                        },
                        "maxItems": 20,
                    },
                    "context": {
                        "type": "string",
                        "description": "Short identifier for what is being selected (e.g. 'location_select', 'item_select', 'category_select')",
                    },
                },
                "required": ["component", "question", "options"],
            },
        },
    },
]


# ── dispatcher: call any tool by name ────────────────────────────────────────

WRITE_TOOLS = {
    "perform_stock_in",
    "perform_stock_out",
    "perform_transfer",
    "create_item",
    "update_item",
    "delete_item",
    "create_category",
    "update_category",
    "delete_category",
    "create_location",
    "update_location",
    "delete_location",
}


async def dispatch_tool(
    name: str,
    args: dict[str, Any],
    db: AsyncSession,
    actor_id: int,
    actor_roles: list[str],
    role_names: list[str],
) -> dict[str, Any]:
    """Route a tool call to its implementation. Raises ValueError on missing tool.

    Enforces a per-user sliding-window rate limit on WRITE_TOOLS so a runaway
    LLM loop can't spam the DB. Read-only tools are unrestricted (the chat
    endpoint itself is already IP-rate-limited).
    """
    if name in WRITE_TOOLS:
        from app.core.rate_limit import check_copilot_write_quota
        allowed, retry_after, msg = check_copilot_write_quota(actor_id)
        if not allowed:
            return {
                "error": msg,
                "retry_after_seconds": retry_after,
                "rate_limited": True,
            }

    if name == "search_inventory":
        return await search_inventory(db, **args)
    if name == "get_item_details":
        return await get_item_details(db, **args)
    if name == "get_location_contents":
        return await get_location_contents(db, **args)
    if name == "list_low_stock_items":
        return await list_low_stock_items(db, **args)
    if name == "list_overdue_items":
        return await list_overdue_items(db, **args)
    if name == "get_dashboard_summary":
        return await get_dashboard_summary(db)
    if name == "perform_stock_in":
        return await perform_stock_in(db, actor_id, **args)
    if name == "perform_stock_out":
        return await perform_stock_out(db, actor_id, actor_roles, **args)
    if name == "perform_transfer":
        return await perform_transfer(db, actor_id, **args)
    if name == "list_locations":
        return await list_locations(db, **args)
    if name == "get_transaction_history":
        return await get_transaction_history(db, **args)
    if name == "list_categories":
        return await list_categories(db)
    if name == "rag_search_docs":
        return await rag_search_docs(db, **args)
    if name == "create_item":
        return await create_item(db, **args)
    if name == "update_item":
        return await update_item(db, **args)
    if name == "delete_item":
        return await delete_item(db, **args)
    if name == "create_category":
        return await create_category(db, **args)
    if name == "update_category":
        return await update_category(db, **args)
    if name == "delete_category":
        return await delete_category(db, **args)
    if name == "create_location":
        return await create_location(db, **args)
    if name == "update_location":
        return await update_location(db, **args)
    if name == "delete_location":
        return await delete_location(db, **args)
    if name == "ask_user":
        return await ask_user(**args)
    raise ValueError(f"Unknown tool: {name}")
