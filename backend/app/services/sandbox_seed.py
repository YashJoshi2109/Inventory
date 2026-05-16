"""
Seed service for sandbox environment.
Creates realistic SEAR Lab inventory data scoped to a single user (owner_id).
Idempotent: checks user.sandbox_seeded before inserting.
"""
from __future__ import annotations

import logging
import math
import random
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import Category, Item, ItemType
from app.models.location import Area, Location
from app.models.transaction import Alert, AlertSeverity, EventKind, InventoryEvent, StockLevel
from app.models.user import User

logger = logging.getLogger(__name__)

_CATEGORIES = [
    {"name": "Consumables", "item_type": ItemType.CONSUMABLE, "color": "#3b82f6", "icon": "package"},
    {"name": "Chemicals", "item_type": ItemType.CHEMICAL, "color": "#ef4444", "icon": "flask-conical"},
    {"name": "Equipment", "item_type": ItemType.EQUIPMENT, "color": "#8b5cf6", "icon": "wrench"},
    {"name": "Supplies", "item_type": ItemType.SUPPLY, "color": "#10b981", "icon": "clipboard"},
    {"name": "Assets", "item_type": ItemType.ASSET, "color": "#f59e0b", "icon": "shield"},
]

# (name, sku_suffix, cat_idx, unit, unit_cost, reorder_level, reorder_qty, initial_qty, supplier, description)
_ITEMS_TEMPLATE = [
    ("Nitrile Gloves S", "GLOVE-S", 0, "box", 12.99, 5, 10, 8, "VWR International", "100 gloves per box"),
    ("Nitrile Gloves M", "GLOVE-M", 0, "box", 12.99, 5, 10, 12, "VWR International", "100 gloves per box"),
    ("Nitrile Gloves L", "GLOVE-L", 0, "box", 12.99, 5, 10, 3, "VWR International", "100 gloves per box"),
    ("Pipette Tips 200uL", "TIP-200", 0, "bag", 8.50, 3, 5, 6, "Eppendorf", "1000 tips per bag"),
    ("Centrifuge Tubes 50mL", "TUBE-50", 0, "pack", 15.00, 4, 8, 2, "Falcon", "25 tubes per pack"),
    ("Filter Paper Grade 1", "FP-GR1", 0, "box", 22.00, 2, 4, 4, "Whatman", "100 circles per box"),
    ("Ethanol 95% 500mL", "ETH-95", 1, "bottle", 28.50, 3, 5, 5, "Sigma-Aldrich", "CAS 64-17-5"),
    ("HCl 37% 1L", "HCL-37", 1, "bottle", 45.00, 2, 3, 3, "Sigma-Aldrich", "CAS 7647-01-0"),
    ("NaOH Pellets 500g", "NAOH-P", 1, "jar", 19.00, 2, 4, 4, "Fisher Scientific", "CAS 1310-73-2"),
    ("PBS Buffer 1x 500mL", "PBS-1X", 1, "bottle", 12.00, 4, 6, 1, "Thermo Fisher", "pH 7.4"),
    ("DI Water 1L", "DIW-1L", 1, "bottle", 3.00, 5, 10, 14, "In-house", "18.2 MΩ·cm"),
    ("Vortex Mixer", "VORTEX-01", 2, "unit", 299.00, 1, 1, 2, "Scientific Industries", "Model G-560E"),
    ("Hot Plate Stirrer", "HPLATE-01", 2, "unit", 450.00, 1, 1, 1, "Corning", "PC-420D"),
    ("pH Meter", "PHMTR-01", 2, "unit", 380.00, 1, 1, 2, "Mettler Toledo", "Seven2Go S2"),
    ("Micropipette P200", "PIPETTE-P200", 2, "unit", 220.00, 1, 2, 3, "Eppendorf", "20-200µL range"),
    ("Lab Notebook A4", "LNBOOK-A4", 3, "each", 8.50, 5, 10, 9, "Lab Supply Co", "96 pages, lined"),
    ("Sharpie Markers Black", "SHARPIE-BK", 3, "pack", 6.00, 3, 5, 7, "Staples", "12 per pack"),
    ("Parafilm M 4in", "PARAFILM-4", 3, "roll", 24.00, 2, 3, 3, "Bemis", "125ft per roll"),
    ("Microscope Slides 3x1", "SLIDES-3X1", 3, "box", 11.00, 4, 6, 5, "Fisher Scientific", "72 slides/box"),
    ("Lab Tape 1in", "LABTAPE-1", 3, "roll", 4.50, 3, 5, 6, "Fisher Brand", "White, autoclave-safe"),
    ("Centrifuge Rotor FA-45", "ROTOR-FA45", 4, "unit", 1250.00, 1, 1, 1, "Eppendorf", "Fixed angle 45°"),
    ("UV Lamp 254nm", "UVLAMP-254", 4, "unit", 320.00, 1, 1, 2, "Spectroline", "Model ENF-240C"),
    ("Safety Goggles", "GOGGLES-01", 4, "each", 9.99, 3, 5, 8, "3M", "Anti-fog, indirect vent"),
    ("Lab Coat Size M", "LABCOAT-M", 4, "each", 35.00, 2, 3, 4, "Fisherbrand", "100% cotton"),
    ("Lab Coat Size L", "LABCOAT-L", 4, "each", 35.00, 2, 3, 3, "Fisherbrand", "100% cotton"),
    ("Beaker 250mL", "BEAKER-250", 2, "each", 6.50, 4, 6, 7, "Pyrex", "Borosilicate glass"),
    ("Erlenmeyer Flask 500mL", "FLASK-500", 2, "each", 9.00, 3, 5, 5, "Kimax", "With stopper"),
    ("Magnetic Stir Bars", "STIRBAR-MIX", 3, "pack", 14.00, 2, 3, 4, "Sigma-Aldrich", "Assorted sizes 5-pack"),
    ("Cryogenic Gloves", "CRYO-GLOVE", 0, "pair", 28.00, 2, 3, 2, "Tempshield", "Size M"),
    ("Disposable Pipettes 3mL", "DPIP-3ML", 0, "pack", 7.00, 4, 8, 9, "Samco", "500 per pack"),
]

_AREAS = [
    {"code": "LAB-A", "name": "Lab A", "building": "SEIR Building", "floor": "2", "room": "210"},
    {"code": "COLD-ROOM", "name": "Cold Room", "building": "SEIR Building", "floor": "1", "room": "105"},
    {"code": "STORAGE", "name": "Storage Room", "building": "SEIR Building", "floor": "1", "room": "102"},
]

_LOCATIONS = [
    (0, "LAB-A-S01-B01", "Lab A Shelf 1 Bin 1", "Chemicals shelf — flammables"),
    (0, "LAB-A-S01-B02", "Lab A Shelf 1 Bin 2", "Consumables — gloves and tips"),
    (1, "CR-B01", "Cold Room Bin 1", "Reagents — 4°C storage"),
    (1, "CR-B02", "Cold Room Bin 2", "Buffers — 4°C storage"),
    (2, "ST-B01", "Storage Bin 1", "Equipment storage"),
    (2, "ST-B02", "Storage Bin 2", "Assets — large equipment"),
    (2, "ST-B03", "Storage Bin 3", "Supplies — paper goods"),
    (2, "ST-B04", "Storage Bin 4", "Overflow — mixed items"),
]

# item index → location index
_ITEM_LOCATION_MAP = {
    0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 7,
    6: 0, 7: 0, 8: 0, 9: 2, 10: 2,
    11: 4, 12: 4, 13: 4, 14: 4,
    15: 6, 16: 6, 17: 6, 18: 6, 19: 6,
    20: 5, 21: 5, 22: 5, 23: 5, 24: 5,
    25: 1, 26: 1, 27: 7, 28: 1, 29: 1,
}


async def seed_user_sandbox(session: AsyncSession, user: User) -> None:
    """Insert sandbox inventory data for user. Caller must commit session afterwards."""
    if user.sandbox_seeded:
        logger.info("Sandbox already seeded for user %d — skipping", user.id)
        return

    owner_id = user.id
    now = datetime.now(timezone.utc)

    # 1. Categories
    categories: list[Category] = []
    for cat_data in _CATEGORIES:
        cat = Category(
            name=f"{cat_data['name']} (U{owner_id})",
            item_type=cat_data["item_type"],
            color=cat_data["color"],
            icon=cat_data["icon"],
            owner_id=owner_id,
        )
        session.add(cat)
        categories.append(cat)
    await session.flush()

    # 2. Areas + Locations
    areas: list[Area] = []
    for area_data in _AREAS:
        area = Area(
            code=f"{area_data['code']}-U{owner_id}",
            name=area_data["name"],
            building=area_data["building"],
            floor=area_data["floor"],
            room=area_data["room"],
            owner_id=owner_id,
        )
        session.add(area)
        areas.append(area)
    await session.flush()

    locations: list[Location] = []
    for loc_data in _LOCATIONS:
        loc = Location(
            area_id=areas[loc_data[0]].id,
            code=f"{loc_data[1]}-U{owner_id}",
            name=loc_data[2],
            description=loc_data[3],
            owner_id=owner_id,
        )
        session.add(loc)
        locations.append(loc)
    await session.flush()

    # 3. Items + StockLevels
    items: list[Item] = []
    for i, item_data in enumerate(_ITEMS_TEMPLATE):
        name, sku_suffix, cat_idx, unit, unit_cost, reorder_level, reorder_qty, initial_qty, supplier, description = item_data
        item = Item(
            sku=f"SBX-{sku_suffix}-{owner_id}",
            name=name,
            description=description,
            category_id=categories[cat_idx].id,
            unit=unit,
            unit_cost=Decimal(str(unit_cost)),
            reorder_level=Decimal(str(reorder_level)),
            reorder_qty=Decimal(str(reorder_qty)),
            supplier=supplier,
            owner_id=owner_id,
        )
        if sku_suffix == "PBS-1X":
            item.expiry_date = now - timedelta(days=15)
        session.add(item)
        items.append(item)
    await session.flush()

    # 4. Stock levels + seed inventory events
    rng = random.Random(owner_id)
    for i, item in enumerate(items):
        loc_idx = _ITEM_LOCATION_MAP.get(i, 7)
        location = locations[loc_idx]
        initial_qty = Decimal(str(_ITEMS_TEMPLATE[i][7]))

        stock_level = StockLevel(
            item_id=item.id,
            location_id=location.id,
            quantity=initial_qty,
        )
        session.add(stock_level)

        seed_event = InventoryEvent(
            event_kind=EventKind.STOCK_IN,
            item_id=item.id,
            to_location_id=location.id,
            quantity=initial_qty,
            actor_id=owner_id,
            occurred_at=now - timedelta(days=30),
            notes="Initial sandbox stock",
        )
        session.add(seed_event)
    await session.flush()

    # 5. Additional realistic events (last 30 days)
    event_kinds_weighted = (
        [EventKind.STOCK_OUT] * 5 +
        [EventKind.STOCK_IN] * 2 +
        [EventKind.TRANSFER] * 2 +
        [EventKind.ADJUSTMENT] * 1
    )
    for day_offset in range(29, 0, -1):
        events_today = rng.randint(1, 3)
        base_time = now - timedelta(days=day_offset)
        for _ in range(events_today):
            item = rng.choice(items)
            kind = rng.choice(event_kinds_weighted)
            hour = rng.randint(8, 18)
            minute = rng.randint(0, 59)
            occurred = base_time.replace(hour=hour, minute=minute, second=0, microsecond=0)

            if kind == EventKind.TRANSFER:
                from_loc = rng.choice(locations)
                to_loc = rng.choice([l for l in locations if l.id != from_loc.id])
                event = InventoryEvent(
                    event_kind=kind,
                    item_id=item.id,
                    from_location_id=from_loc.id,
                    to_location_id=to_loc.id,
                    quantity=Decimal(str(rng.randint(1, 3))),
                    actor_id=owner_id,
                    occurred_at=occurred,
                )
            else:
                loc = rng.choice(locations)
                event = InventoryEvent(
                    event_kind=kind,
                    item_id=item.id,
                    to_location_id=loc.id if kind == EventKind.STOCK_IN else None,
                    from_location_id=loc.id if kind == EventKind.STOCK_OUT else None,
                    quantity=Decimal(str(rng.randint(1, 4))),
                    actor_id=owner_id,
                    occurred_at=occurred,
                )
            session.add(event)
    await session.flush()

    # 6. Alerts for low-stock and expired items
    low_stock_items = [items[2], items[4], items[9]]  # GLOVE-L, TUBE-50, PBS-1X
    for item in low_stock_items:
        alert = Alert(
            item_id=item.id,
            severity=AlertSeverity.WARNING,
            message=f"{item.name} is below reorder level",
            is_resolved=False,
        )
        session.add(alert)
    expired_alert = Alert(
        item_id=items[9].id,
        severity=AlertSeverity.CRITICAL,
        message=f"{items[9].name} expired 15 days ago",
        is_resolved=False,
    )
    session.add(expired_alert)
    await session.flush()

    # 7. Mark user as seeded
    user.sandbox_seeded = True
    session.add(user)
    await session.flush()

    logger.info("Sandbox seeded for user %d: %d items, %d locations", owner_id, len(items), len(locations))


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
            # Solar: peaks midday, zero at night
            if 6 <= hour <= 19:
                solar_w = max(0.0, 4500 * math.sin(math.pi * (hour - 6) / 13) + rng.gauss(0, 150))
            else:
                solar_w = 0.0

            # AC: higher during lab hours
            ac_w = max(0.0, (1800 + rng.gauss(0, 200)) if 8 <= hour <= 20 else (400 + rng.gauss(0, 50)))
            # HWH: consistent baseline
            hwh_w = max(0.0, (500 + rng.gauss(0, 80)) if 6 <= hour <= 22 else 100.0)

            total_w = ac_w + hwh_w
            net_w = solar_w - total_w

            rows.append({
                "ts": ts,
                "ac_w": round(ac_w, 1),
                "hwh_w": round(hwh_w, 1),
                "solar_w": round(solar_w, 1),
                "total_w": round(total_w, 1),
                "net_w": round(net_w, 1),
                "owner_id": owner_id,
            })

    await session.execute(
        text("""
            INSERT INTO energy_readings (
                timestamp,
                ac_consumption_w,
                hwh_consumption_w,
                solar_current_power_w,
                total_consumption_w,
                net_balance_w,
                ac_device_name,
                ac_power_mode,
                ac_run_state,
                hwh_connected,
                solar_system_status,
                owner_id
            )
            SELECT
                r.ts,
                r.ac_w,
                r.hwh_w,
                r.solar_w,
                r.total_w,
                r.net_w,
                'Sandbox AC Unit',
                CASE WHEN r.ac_w > 1000 THEN 'COOLING' ELSE 'STANDBY' END,
                CASE WHEN r.ac_w > 400 THEN 'ON' ELSE 'OFF' END,
                true,
                CASE WHEN r.solar_w > 0 THEN 'Normal' ELSE 'Idle' END,
                r.owner_id
            FROM unnest(
                :ts_arr::timestamptz[],
                :ac_arr::float[],
                :hwh_arr::float[],
                :solar_arr::float[],
                :total_arr::float[],
                :net_arr::float[],
                :owner_arr::int[]
            ) AS r(ts, ac_w, hwh_w, solar_w, total_w, net_w, owner_id)
        """),
        {
            "ts_arr": [r["ts"] for r in rows],
            "ac_arr": [r["ac_w"] for r in rows],
            "hwh_arr": [r["hwh_w"] for r in rows],
            "solar_arr": [r["solar_w"] for r in rows],
            "total_arr": [r["total_w"] for r in rows],
            "net_arr": [r["net_w"] for r in rows],
            "owner_arr": [r["owner_id"] for r in rows],
        },
    )
    logger.info("Energy seed complete for user %d: %d hourly readings", owner_id, len(rows))
