"""
Seed service for sandbox environment.
Clones real inventory data (owner_id=NULL) scoped to a single user (owner_id=user.id).
Idempotent: skips if user already has sandbox items.
"""
from __future__ import annotations

import logging
import math
import random
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.item import Category, Item, ItemBarcode
from app.models.location import Area, Location
from app.models.transaction import InventoryEvent, StockLevel, EventKind
from app.models.user import User
from app.services.barcode_service import gtin14_for_item, generate_epc_serial, sgtin96_epc_hex

logger = logging.getLogger(__name__)


async def seed_user_sandbox(session: AsyncSession, user: User) -> None:
    """Clone real inventory data for user. Caller must commit session afterwards."""
    if user.sandbox_seeded:
        logger.info("Sandbox already seeded for user %d — skipping", user.id)
        return

    owner_id = user.id
    now = datetime.now(timezone.utc)

    # 1. Clone categories (owner_id=NULL → owner_id=user.id)
    real_cats = (await session.execute(
        select(Category).where(Category.owner_id == None)
    )).scalars().all()

    cat_id_map: dict[int, int] = {}  # real_id → sandbox_id
    for rc in real_cats:
        new_cat = Category(
            name=f"{rc.name}",
            item_type=rc.item_type,
            color=rc.color,
            icon=rc.icon,
            description=rc.description,
            owner_id=owner_id,
        )
        session.add(new_cat)
        await session.flush()
        cat_id_map[rc.id] = new_cat.id

    # 2. Clone areas
    real_areas = (await session.execute(
        select(Area).where(Area.owner_id == None)
    )).scalars().all()

    area_id_map: dict[int, int] = {}
    for ra in real_areas:
        new_area = Area(
            code=f"{ra.code}-SBX{owner_id}",
            name=ra.name,
            description=ra.description,
            building=ra.building,
            floor=ra.floor,
            room=ra.room,
            owner_id=owner_id,
        )
        session.add(new_area)
        await session.flush()
        area_id_map[ra.id] = new_area.id

    # 3. Clone locations
    real_locs = (await session.execute(
        select(Location).where(Location.owner_id == None)
    )).scalars().all()

    loc_id_map: dict[int, int] = {}
    for rl in real_locs:
        mapped_area_id = area_id_map.get(rl.area_id)
        if mapped_area_id is None:
            continue
        new_loc = Location(
            area_id=mapped_area_id,
            code=f"{rl.code}-SBX{owner_id}",
            name=rl.name,
            description=rl.description,
            shelf=rl.shelf,
            bin_label=rl.bin_label,
            capacity=rl.capacity,
            owner_id=owner_id,
        )
        session.add(new_loc)
        await session.flush()
        loc_id_map[rl.id] = new_loc.id

    # 4. Clone items + stock levels
    real_items = (await session.execute(
        select(Item)
        .options(selectinload(Item.stock_levels))
        .where(Item.owner_id == None, Item.is_active == True)
    )).scalars().all()

    for ri in real_items:
        mapped_cat_id = cat_id_map.get(ri.category_id) if ri.category_id else None
        new_item = Item(
            sku=f"SBX-{ri.sku}-{owner_id}",
            name=ri.name,
            description=ri.description,
            category_id=mapped_cat_id,
            unit=ri.unit,
            unit_cost=ri.unit_cost,
            sale_price=ri.sale_price,
            reorder_level=ri.reorder_level,
            reorder_qty=ri.reorder_qty,
            lead_days=ri.lead_days,
            supplier=ri.supplier,
            part_number=ri.part_number,
            cas_number=ri.cas_number,
            lot_number=ri.lot_number,
            expiry_date=ri.expiry_date,
            hazard_class=ri.hazard_class,
            storage_conditions=ri.storage_conditions,
            notes=ri.notes,
            is_active=True,
            is_serialized=ri.is_serialized,
            owner_id=owner_id,
        )
        session.add(new_item)
        await session.flush()

        # Register SEAR Lab barcodes so scan_service can find sandbox items
        session.add(ItemBarcode(
            item_id=new_item.id,
            barcode_type="qr+code128",
            barcode_value=gtin14_for_item(new_item.id),
            is_primary=True,
        ))
        session.add(ItemBarcode(
            item_id=new_item.id,
            barcode_type="rfid_epc",
            barcode_value=sgtin96_epc_hex(new_item.id),
            is_primary=False,
        ))
        session.add(ItemBarcode(
            item_id=new_item.id,
            barcode_type="rfid_epc_legacy",
            barcode_value=generate_epc_serial(new_item.id),
            is_primary=False,
        ))

        # Clone stock levels, remapping location ids
        for sl in ri.stock_levels:
            mapped_loc_id = loc_id_map.get(sl.location_id)
            if mapped_loc_id is None:
                # If no sandbox location map, use first available sandbox location
                if loc_id_map:
                    mapped_loc_id = next(iter(loc_id_map.values()))
                else:
                    continue
            new_sl = StockLevel(
                item_id=new_item.id,
                location_id=mapped_loc_id,
                quantity=sl.quantity,
            )
            session.add(new_sl)

            # Seed event for audit trail
            seed_event = InventoryEvent(
                event_kind=EventKind.STOCK_IN,
                item_id=new_item.id,
                to_location_id=mapped_loc_id,
                quantity=sl.quantity,
                actor_id=owner_id,
                occurred_at=now - timedelta(days=1),
                notes="Sandbox clone",
            )
            session.add(seed_event)

    await session.flush()

    # 5. Mark seeded
    user.sandbox_seeded = True
    session.add(user)
    await session.flush()

    logger.info(
        "Sandbox cloned for user %d: %d cats, %d areas, %d locs, %d items",
        owner_id, len(real_cats), len(real_areas), len(real_locs), len(real_items),
    )


async def seed_user_energy(session: AsyncSession, user: User) -> None:
    """Insert 30 days of synthetic energy_readings rows for sandbox user."""
    owner_id = user.id
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    rng = random.Random(owner_id + 1000)

    rows = []
    for day in range(30, 0, -1):
        base = now - timedelta(days=day)
        for hour in range(24):
            ts = base.replace(hour=hour)
            if 6 <= hour <= 19:
                solar_w = max(0.0, 4500 * math.sin(math.pi * (hour - 6) / 13) + rng.gauss(0, 150))
            else:
                solar_w = 0.0
            ac_w = max(0.0, (1800 + rng.gauss(0, 200)) if 8 <= hour <= 20 else (400 + rng.gauss(0, 50)))
            hwh_w = max(0.0, (500 + rng.gauss(0, 80)) if 6 <= hour <= 22 else 100.0)
            total_w = ac_w + hwh_w
            rows.append({
                "timestamp": ts,
                "ac_consumption_w": round(ac_w, 1),
                "hwh_consumption_w": round(hwh_w, 1),
                "solar_current_power_w": round(solar_w, 1),
                "total_consumption_w": round(total_w, 1),
                "net_balance_w": round(solar_w - total_w, 1),
                "ac_device_name": "Sandbox AC Unit",
                "ac_power_mode": "COOLING" if ac_w > 1000 else "STANDBY",
                "ac_run_state": "ON" if ac_w > 400 else "OFF",
                "hwh_connected": True,
                "solar_system_status": "Normal" if solar_w > 0 else "Idle",
                "owner_id": owner_id,
            })

    # Bulk insert via raw SQL with individual value rows (avoids asyncpg :: cast conflicts)
    if rows:
        placeholders = ", ".join(
            f"(:ts{i}, :ac{i}, :hwh{i}, :solar{i}, :total{i}, :net{i}, :dev{i}, :mode{i}, :run{i}, :hwconn{i}, :solar_st{i}, :oid{i})"
            for i in range(len(rows))
        )
        params: dict = {}
        for i, r in enumerate(rows):
            params[f"ts{i}"] = r["timestamp"]
            params[f"ac{i}"] = r["ac_consumption_w"]
            params[f"hwh{i}"] = r["hwh_consumption_w"]
            params[f"solar{i}"] = r["solar_current_power_w"]
            params[f"total{i}"] = r["total_consumption_w"]
            params[f"net{i}"] = r["net_balance_w"]
            params[f"dev{i}"] = r["ac_device_name"]
            params[f"mode{i}"] = r["ac_power_mode"]
            params[f"run{i}"] = r["ac_run_state"]
            params[f"hwconn{i}"] = r["hwh_connected"]
            params[f"solar_st{i}"] = r["solar_system_status"]
            params[f"oid{i}"] = r["owner_id"]

        await session.execute(
            text(
                "INSERT INTO energy_readings "
                "(timestamp, ac_consumption_w, hwh_consumption_w, solar_current_power_w, "
                "total_consumption_w, net_balance_w, ac_device_name, ac_power_mode, "
                "ac_run_state, hwh_connected, solar_system_status, owner_id) "
                f"VALUES {placeholders}"
            ),
            params,
        )

    logger.info("Energy seed complete for user %d: %d hourly readings", owner_id, len(rows))
