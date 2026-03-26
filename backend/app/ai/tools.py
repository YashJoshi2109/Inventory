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
            func.lower(Location.code) == location_code.upper()
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
        "location_type": loc.location_type,
        "item_count": len(items),
        "items": items,
    }


async def list_low_stock_items(
    db: AsyncSession,
    limit: int = 20,
) -> dict:
    """Return items whose total stock is at or below their reorder level."""
    result = await db.execute(
        select(Item).where(Item.is_active == True, Item.reorder_level > 0)  # noqa: E712
    )
    items = result.scalars().all()
    stock_repo = StockLevelRepository(db)

    low: list[dict] = []
    for item in items:
        total = float(await stock_repo.get_total_for_item(item.id))
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

    stock_repo = StockLevelRepository(db)
    items_r = await db.execute(select(Item).where(Item.is_active == True, Item.reorder_level > 0))  # noqa: E712
    items_list = items_r.scalars().all()
    low = 0
    for item in items_list:
        total = float(await stock_repo.get_total_for_item(item.id))
        if total <= float(item.reorder_level):
            low += 1

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


async def rag_search_docs(
    db: AsyncSession,
    query: str,
    doc_type: str | None = None,
    limit: int = 6,
) -> dict:
    """
    Retrieve relevant knowledge-base chunks from uploaded documents.

    This is a lightweight "RAG retrieval" implementation that ranks chunks by
    keyword overlap. It is database-grounded (reads from doc_chunks).

    Later you can upgrade this tool to true embedding similarity with pgvector.
    """
    q = (query or "").strip().lower()
    if not q:
        return {"query": query, "total": 0, "chunks": []}

    tokens = [t for t in re.findall(r"[a-z0-9]+", q) if len(t) >= 3]
    if not tokens:
        tokens = [q]

    # Fetch candidate chunks (bounded) using SQL ILIKE to keep it fast.
    conditions = [func.lower(DocChunk.content).like(f"%{t}%") for t in tokens[:12]]

    q_stmt = (
        select(DocChunk, KnowledgeDocument)
        .join(KnowledgeDocument, KnowledgeDocument.id == DocChunk.doc_id)
        .where(KnowledgeDocument.is_active == True)  # noqa: E712
        .where(or_(*conditions))
        .order_by(DocChunk.created_at.desc())
        .limit(60)
    )
    if doc_type:
        q_stmt = q_stmt.where(KnowledgeDocument.doc_type == doc_type)

    result = await db.execute(q_stmt)
    rows = result.all()

    ranked: list[tuple[float, DocChunk, KnowledgeDocument]] = []
    for chunk, doc in rows:
        c = (chunk.content or "").lower()
        score = 0.0
        for t in tokens:
            if t in c:
                score += 1.0
        # Boost newer docs slightly
        if doc.created_at:
            age_seconds = max(0.0, (datetime.utcnow() - doc.created_at.replace(tzinfo=None)).total_seconds())
            score += 1.0 / (1.0 + age_seconds / 86400.0)
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
]


# ── dispatcher: call any tool by name ────────────────────────────────────────

WRITE_TOOLS = {
    "perform_stock_in",
    "perform_stock_out",
    "perform_transfer",
}


async def dispatch_tool(
    name: str,
    args: dict[str, Any],
    db: AsyncSession,
    actor_id: int,
    actor_roles: list[str],
    role_names: list[str],
) -> dict[str, Any]:
    """Route a tool call to its implementation. Raises ValueError on missing tool."""
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
    if name == "rag_search_docs":
        return await rag_search_docs(db, **args)
    raise ValueError(f"Unknown tool: {name}")
