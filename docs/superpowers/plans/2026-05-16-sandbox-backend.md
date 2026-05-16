# Sandbox Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a fully isolated sandbox Cloud Run + Cloud SQL environment that mirrors prod — same Docker image, per-user seed data on OTP verify, zero prod impact.

**Architecture:** `SANDBOX_MODE=true` env var activates per-user `owner_id` filtering and the seed router. A dedicated Cloud SQL instance holds all sandbox data including its own users table. Prod Cloud Run and Cloud SQL are never touched. Energy seed data goes into `energy_readings` (PostgreSQL) using synthetic 30-day time series.

**Tech Stack:** FastAPI · SQLAlchemy async · Alembic · PostgreSQL · Cloud Run · Cloud SQL · Cloud Build

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `backend/app/core/config.py` | Add `SANDBOX_MODE: bool` setting |
| Create | `backend/app/core/sandbox.py` | `sandbox_owner_id()` dependency |
| Create | `backend/migrations/versions/008_sandbox_owner.py` | owner_id + sandbox_seeded columns |
| Modify | `backend/app/models/user.py` | Add `sandbox_seeded` field |
| Modify | `backend/app/models/item.py` | Add `owner_id` to `items`, `categories` |
| Modify | `backend/app/models/location.py` | Add `owner_id` to `areas`, `locations` |
| Modify | `backend/app/repositories/item_repo.py` | Accept optional `owner_id` in search/get_all |
| Modify | `backend/app/repositories/location_repo.py` | Accept optional `owner_id` in get_all_with_locations |
| Modify | `backend/app/api/v1/items.py` | Pass `owner_id` when SANDBOX_MODE |
| Modify | `backend/app/api/v1/locations.py` | Pass `owner_id` when SANDBOX_MODE |
| Create | `backend/app/services/sandbox_seed.py` | Seed data definitions + DB writer |
| Create | `backend/app/api/v1/sandbox.py` | POST /seed, POST /reset, GET /status |
| Modify | `backend/app/api/router.py` | Mount sandbox router conditionally |
| Create | `backend/cloudbuild-sandbox.yaml` | Cloud Build trigger for sandbox deploy |

---

## Task 1: Add SANDBOX_MODE to settings

**Files:**
- Modify: `backend/app/core/config.py`

- [ ] **Step 1: Add SANDBOX_MODE field**

Open `backend/app/core/config.py`. After the `MQTT_ENABLED` line, add:

```python
    # Sandbox mode — set to true on sandbox Cloud Run only
    SANDBOX_MODE: bool = False
```

- [ ] **Step 2: Verify settings loads**

```bash
cd backend
python -c "from app.core.config import settings; print('SANDBOX_MODE:', settings.SANDBOX_MODE)"
```

Expected output: `SANDBOX_MODE: False`

- [ ] **Step 3: Verify env override works**

```bash
SANDBOX_MODE=true python -c "from app.core.config import settings; print('SANDBOX_MODE:', settings.SANDBOX_MODE)"
```

Expected output: `SANDBOX_MODE: True`

- [ ] **Step 4: Commit**

```bash
git add backend/app/core/config.py
git commit -m "feat(sandbox): add SANDBOX_MODE config flag"
```

---

## Task 2: Alembic migration — owner_id + sandbox_seeded

**Files:**
- Modify: `backend/app/models/user.py`
- Modify: `backend/app/models/item.py`
- Modify: `backend/app/models/location.py`
- Create: `backend/migrations/versions/008_sandbox_owner.py`

- [ ] **Step 1: Add `sandbox_seeded` to User model**

In `backend/app/models/user.py`, after the `last_login_at` field add:

```python
    sandbox_seeded: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
```

- [ ] **Step 2: Add `owner_id` to Category and Item**

In `backend/app/models/item.py`, add to `Category` class after `created_at`:

```python
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
```

Add to `Item` class after `created_at` (the field near the bottom of Item):

```python
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
```

- [ ] **Step 3: Add `owner_id` to Area and Location**

In `backend/app/models/location.py`, add to `Area` class after `created_at`:

```python
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
```

Add to `Location` class after `created_at` (or the last field):

```python
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
```

- [ ] **Step 4: Create Alembic migration**

```bash
cd backend
alembic revision --autogenerate -m "add sandbox owner_id and sandbox_seeded"
```

This creates a file in `backend/migrations/versions/`. Rename it to `008_sandbox_owner.py`:

```bash
mv migrations/versions/*sandbox_owner_id*.py migrations/versions/008_sandbox_owner.py
```

- [ ] **Step 5: Verify migration content**

Open the generated migration. The `upgrade()` should contain:
- `op.add_column('users', sa.Column('sandbox_seeded', sa.Boolean(), server_default='false', nullable=False))`
- `op.add_column('categories', sa.Column('owner_id', sa.Integer(), nullable=True))`
- `op.add_column('items', sa.Column('owner_id', sa.Integer(), nullable=True))`
- `op.add_column('areas', sa.Column('owner_id', sa.Integer(), nullable=True))`
- `op.add_column('locations', sa.Column('owner_id', sa.Integer(), nullable=True))`

If any are missing, add them manually. The full migration should look like:

```python
"""add sandbox owner_id and sandbox_seeded

Revision ID: 008_sandbox_owner
Revises: <previous_revision>
Create Date: 2026-05-16
"""
from alembic import op
import sqlalchemy as sa


def upgrade() -> None:
    op.add_column('users', sa.Column('sandbox_seeded', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('categories', sa.Column('owner_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_categories_owner_id_users', 'categories', 'users', ['owner_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_categories_owner_id', 'categories', ['owner_id'])
    op.add_column('items', sa.Column('owner_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_items_owner_id_users', 'items', 'users', ['owner_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_items_owner_id', 'items', ['owner_id'])
    op.add_column('areas', sa.Column('owner_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_areas_owner_id_users', 'areas', 'users', ['owner_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_areas_owner_id', 'areas', ['owner_id'])
    op.add_column('locations', sa.Column('owner_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_locations_owner_id_users', 'locations', 'users', ['owner_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_locations_owner_id', 'locations', ['owner_id'])


def downgrade() -> None:
    op.drop_index('ix_locations_owner_id', 'locations')
    op.drop_constraint('fk_locations_owner_id_users', 'locations', type_='foreignkey')
    op.drop_column('locations', 'owner_id')
    op.drop_index('ix_areas_owner_id', 'areas')
    op.drop_constraint('fk_areas_owner_id_users', 'areas', type_='foreignkey')
    op.drop_column('areas', 'owner_id')
    op.drop_index('ix_items_owner_id', 'items')
    op.drop_constraint('fk_items_owner_id_users', 'items', type_='foreignkey')
    op.drop_column('items', 'owner_id')
    op.drop_index('ix_categories_owner_id', 'categories')
    op.drop_constraint('fk_categories_owner_id_users', 'categories', type_='foreignkey')
    op.drop_column('categories', 'owner_id')
    op.drop_column('users', 'sandbox_seeded')
```

- [ ] **Step 6: Run migration against local dev DB**

```bash
cd backend
alembic upgrade head
```

Expected: `Running upgrade <prev> -> 008_sandbox_owner, add sandbox owner_id and sandbox_seeded`

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/user.py backend/app/models/item.py backend/app/models/location.py backend/migrations/versions/008_sandbox_owner.py
git commit -m "feat(sandbox): migration — owner_id on inventory tables, sandbox_seeded on users"
```

---

## Task 3: Sandbox owner filter utility

**Files:**
- Create: `backend/app/core/sandbox.py`

- [ ] **Step 1: Create `backend/app/core/sandbox.py`**

```python
from app.core.config import settings
from app.models.user import User


def sandbox_owner_id(current_user: User) -> int | None:
    """Return current_user.id if SANDBOX_MODE is active, else None.

    Pass the return value as `owner_id` to repository methods.
    Repos skip the filter when owner_id is None (prod behaviour unchanged).
    """
    return current_user.id if settings.SANDBOX_MODE else None
```

- [ ] **Step 2: Verify import works**

```bash
cd backend
python -c "from app.core.sandbox import sandbox_owner_id; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/app/core/sandbox.py
git commit -m "feat(sandbox): sandbox_owner_id utility"
```

---

## Task 4: Update repositories for owner_id filtering

**Files:**
- Modify: `backend/app/repositories/item_repo.py`
- Modify: `backend/app/repositories/location_repo.py`

- [ ] **Step 1: Update `ItemRepository.search()` to accept owner_id**

In `backend/app/repositories/item_repo.py`, find the `search()` method signature and add `owner_id: int | None = None`:

```python
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
```

Inside the method, after the existing `if category_id:` block, add:

```python
        if owner_id is not None:
            base_q = base_q.where(Item.owner_id == owner_id)
```

- [ ] **Step 2: Update `CategoryRepository.get_all()` to accept owner_id**

Find `CategoryRepository` in `item_repo.py` (it likely has a `get_all` method or inherits from BaseRepository). Add a new method:

```python
class CategoryRepository(BaseRepository[Category]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Category, session)

    async def get_all_filtered(self, owner_id: int | None = None) -> list[Category]:
        q = select(Category)
        if owner_id is not None:
            q = q.where(Category.owner_id == owner_id)
        result = await self.session.execute(q.order_by(Category.name))
        return list(result.scalars().all())
```

- [ ] **Step 3: Update `AreaRepository.get_all_with_locations()` to accept owner_id**

In `backend/app/repositories/location_repo.py`, update `get_all_with_locations`:

```python
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
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/repositories/item_repo.py backend/app/repositories/location_repo.py
git commit -m "feat(sandbox): owner_id filter on item + location repositories"
```

---

## Task 5: Update routers to use owner_id filter in sandbox mode

**Files:**
- Modify: `backend/app/api/v1/items.py`
- Modify: `backend/app/api/v1/locations.py`

- [ ] **Step 1: Update items router imports**

In `backend/app/api/v1/items.py`, add:

```python
from app.core.sandbox import sandbox_owner_id
```

- [ ] **Step 2: Update `list_items` endpoint to pass owner_id**

Find the route that calls `repo.search(...)` and add the owner_id argument:

```python
@router.get("/", response_model=PaginatedResponse[ItemSummary])
async def list_items(
    session: DbSession,
    current_user: CurrentUser,
    query: str | None = Query(None),
    category_id: int | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
) -> PaginatedResponse[ItemSummary]:
    repo = ItemRepository(session)
    items, total = await repo.search(
        query=query,
        category_id=category_id,
        owner_id=sandbox_owner_id(current_user),
        skip=skip,
        limit=limit,
    )
    ...  # rest of the function unchanged
```

- [ ] **Step 3: Update `list_categories` endpoint**

Find `list_categories` and change:

```python
@router.get("/categories", response_model=list[CategoryRead])
async def list_categories(session: DbSession, current_user: CurrentUser) -> list[CategoryRead]:
    repo = CategoryRepository(session)
    cats = await repo.get_all_filtered(owner_id=sandbox_owner_id(current_user))
    return [CategoryRead.model_validate(c) for c in cats]
```

- [ ] **Step 4: Update locations router**

In `backend/app/api/v1/locations.py`, add:

```python
from app.core.sandbox import sandbox_owner_id
```

Find the endpoint that calls `get_all_with_locations()` and add `owner_id=sandbox_owner_id(current_user)`.

- [ ] **Step 5: Verify no regressions against local dev server**

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

Hit `GET /api/v1/items/` — should return same results as before (SANDBOX_MODE=False means owner_id=None → no filter).

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/items.py backend/app/api/v1/locations.py
git commit -m "feat(sandbox): items + locations routers pass owner_id when SANDBOX_MODE"
```

---

## Task 6: Sandbox seed service — inventory

**Files:**
- Create: `backend/app/services/sandbox_seed.py`

- [ ] **Step 1: Create seed data file**

Create `backend/app/services/sandbox_seed.py`:

```python
"""
Seed service for sandbox environment.
Creates realistic SEAR Lab inventory data scoped to a single user (owner_id).
Idempotent: checks user.sandbox_seeded before inserting.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import random
import math

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import Category, Item, ItemType
from app.models.location import Area, Location
from app.models.transaction import InventoryEvent, StockLevel, EventKind, Alert, AlertSeverity
from app.models.user import User

logger = logging.getLogger(__name__)

_CATEGORIES = [
    {"name": "Consumables", "item_type": ItemType.CONSUMABLE, "color": "#3b82f6", "icon": "package"},
    {"name": "Chemicals", "item_type": ItemType.CHEMICAL, "color": "#ef4444", "icon": "flask-conical"},
    {"name": "Equipment", "item_type": ItemType.EQUIPMENT, "color": "#8b5cf6", "icon": "wrench"},
    {"name": "Supplies", "item_type": ItemType.SUPPLY, "color": "#10b981", "icon": "clipboard"},
    {"name": "Assets", "item_type": ItemType.ASSET, "color": "#f59e0b", "icon": "shield"},
]

_ITEMS_TEMPLATE = [
    # (name, sku_suffix, category_idx, unit, unit_cost, reorder_level, reorder_qty, initial_qty, supplier, description)
    ("Nitrile Gloves S", "GLOVE-S", 0, "box", 12.99, 5, 10, 8, "VWR International", "100 gloves per box"),
    ("Nitrile Gloves M", "GLOVE-M", 0, "box", 12.99, 5, 10, 12, "VWR International", "100 gloves per box"),
    ("Nitrile Gloves L", "GLOVE-L", 0, "box", 12.99, 5, 10, 3, "VWR International", "100 gloves per box"),  # low stock
    ("Pipette Tips 200uL", "TIP-200", 0, "bag", 8.50, 3, 5, 6, "Eppendorf", "1000 tips per bag"),
    ("Centrifuge Tubes 50mL", "TUBE-50", 0, "pack", 15.00, 4, 8, 2, "Falcon", "25 tubes per pack"),  # low stock
    ("Filter Paper Grade 1", "FP-GR1", 0, "box", 22.00, 2, 4, 4, "Whatman", "100 circles per box"),
    ("Ethanol 95% 500mL", "ETH-95", 1, "bottle", 28.50, 3, 5, 5, "Sigma-Aldrich", "CAS 64-17-5"),
    ("HCl 37% 1L", "HCL-37", 1, "bottle", 45.00, 2, 3, 3, "Sigma-Aldrich", "CAS 7647-01-0"),
    ("NaOH Pellets 500g", "NAOH-P", 1, "jar", 19.00, 2, 4, 4, "Fisher Scientific", "CAS 1310-73-2"),
    ("PBS Buffer 1x 500mL", "PBS-1X", 1, "bottle", 12.00, 4, 6, 1, "Thermo Fisher", "pH 7.4"),  # low stock
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
    # (area_idx, code, name, description)
    (0, "LAB-A-S01-B01", "Lab A Shelf 1 Bin 1", "Chemicals shelf — flammables"),
    (0, "LAB-A-S01-B02", "Lab A Shelf 1 Bin 2", "Consumables — gloves and tips"),
    (1, "CR-B01", "Cold Room Bin 1", "Reagents — 4°C storage"),
    (1, "CR-B02", "Cold Room Bin 2", "Buffers — 4°C storage"),
    (2, "ST-B01", "Storage Bin 1", "Equipment storage"),
    (2, "ST-B02", "Storage Bin 2", "Assets — large equipment"),
    (2, "ST-B03", "Storage Bin 3", "Supplies — paper goods"),
    (2, "ST-B04", "Storage Bin 4", "Overflow — mixed items"),
]

# Maps item index → location index (where initial stock lives)
_ITEM_LOCATION_MAP = {
    0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 7,   # consumables → LAB-A-B02 or overflow
    6: 0, 7: 0, 8: 0, 9: 2, 10: 2,          # chemicals → LAB-A-B01 or cold room
    11: 4, 12: 4, 13: 4, 14: 4,              # equipment → ST-B01
    15: 6, 16: 6, 17: 6, 18: 6, 19: 6,      # supplies → ST-B03
    20: 5, 21: 5, 22: 5, 23: 5, 24: 5,      # assets → ST-B02
    25: 1, 26: 1, 27: 7, 28: 1, 29: 1,      # remaining
}


async def seed_user_sandbox(session: AsyncSession, user: User) -> None:
    """Insert sandbox data for user. Caller must commit session afterwards."""
    if user.sandbox_seeded:
        logger.info("Sandbox already seeded for user %d — skipping", user.id)
        return

    owner_id = user.id
    now = datetime.now(timezone.utc)

    # 1. Categories
    categories: list[Category] = []
    for i, cat_data in enumerate(_CATEGORIES):
        cat = Category(
            name=f"{cat_data['name']}",
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
        # Set expiry on one chemical item for demo
        if sku_suffix == "PBS-1X":
            item.expiry_date = now - timedelta(days=15)  # already expired
        session.add(item)
        items.append(item)
    await session.flush()

    # 4. Stock levels + seed inventory events
    rng = random.Random(owner_id)  # deterministic per user
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

        # Seed STOCK_IN event for initial stock
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
        # 1-3 events per day
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

    # 6. Alerts for low-stock items
    low_stock_items = [items[2], items[4], items[9]]  # GLOVE-L, TUBE-50, PBS-1X
    for item in low_stock_items:
        alert = Alert(
            item_id=item.id,
            severity=AlertSeverity.WARNING,
            message=f"{item.name} is below reorder level",
            is_resolved=False,
        )
        session.add(alert)
    # Expired item alert
    expired_alert = Alert(
        item_id=items[9].id,
        severity=AlertSeverity.CRITICAL,
        message=f"{items[9].name} expired 15 days ago",
        is_read=False,
    )
    session.add(expired_alert)
    await session.flush()

    # 7. Mark user as seeded
    user.sandbox_seeded = True
    session.add(user)
    await session.flush()

    logger.info("Sandbox seeded for user %d: %d items, %d locations", owner_id, len(items), len(locations))
```

- [ ] **Step 2: Check that all imports resolve**

```bash
cd backend
python -c "from app.services.sandbox_seed import seed_user_sandbox; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/sandbox_seed.py
git commit -m "feat(sandbox): inventory seed service — 30 items, 8 locations, 50+ events"
```

---

## Task 7: Sandbox seed service — energy readings

**Files:**
- Modify: `backend/app/services/sandbox_seed.py`

- [ ] **Step 1: Add energy seed function to sandbox_seed.py**

Append to `backend/app/services/sandbox_seed.py`:

```python
async def seed_user_energy(session: AsyncSession, user: User) -> None:
    """Insert 30 days of synthetic energy_readings rows for sandbox user."""
    from sqlalchemy import text

    owner_id = user.id
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    rng = random.Random(owner_id + 1000)  # different seed from inventory

    rows = []
    for day in range(30, 0, -1):
        base = now - timedelta(days=day)
        # One reading per hour
        for hour in range(24):
            ts = base.replace(hour=hour)
            # Solar: peaks midday, zero at night
            if 6 <= hour <= 19:
                solar_w = max(0, 4500 * math.sin(math.pi * (hour - 6) / 13) + rng.gauss(0, 150))
            else:
                solar_w = 0.0

            # AC: higher during lab hours
            if 8 <= hour <= 20:
                ac_w = 1800 + rng.gauss(0, 200)
            else:
                ac_w = 400 + rng.gauss(0, 50)
            ac_w = max(0, ac_w)

            # HWH: consistent baseline
            hwh_w = 500 + rng.gauss(0, 80) if 6 <= hour <= 22 else 100
            hwh_w = max(0, hwh_w)

            total_w = ac_w + hwh_w
            net_w = solar_w - total_w  # positive = exporting, negative = importing

            rows.append({
                "ts": ts.isoformat(),
                "ac_w": round(ac_w, 1),
                "hwh_w": round(hwh_w, 1),
                "solar_w": round(solar_w, 1),
                "total_w": round(total_w, 1),
                "net_w": round(net_w, 1),
                "owner_id": owner_id,
            })

    # Bulk insert via raw SQL (energy_readings schema — adjust column names to match your table)
    await session.execute(
        text("""
            INSERT INTO energy_readings (
                timestamp, ac_consumption_w, hwh_consumption_w,
                solar_current_power_w, total_consumption_w, net_balance_w,
                ac_device_name, ac_power_mode, ac_run_state,
                hwh_connected, solar_system_status, owner_id
            )
            SELECT
                CAST(r->>'ts' AS TIMESTAMPTZ),
                CAST(r->>'ac_w' AS FLOAT),
                CAST(r->>'hwh_w' AS FLOAT),
                CAST(r->>'solar_w' AS FLOAT),
                CAST(r->>'total_w' AS FLOAT),
                CAST(r->>'net_w' AS FLOAT),
                'Sandbox AC Unit',
                'on',
                'running',
                true,
                'normal',
                CAST(r->>'owner_id' AS INT)
            FROM json_array_elements(CAST(:rows AS json)) AS r
        """),
        {"rows": __import__("json").dumps(rows)},
    )
    logger.info("Energy seed: %d hourly readings inserted for user %d", len(rows), owner_id)
```

> **Note:** The `energy_readings` table needs an `owner_id` column. Add `op.add_column('energy_readings', sa.Column('owner_id', sa.Integer(), nullable=True))` to migration 008 if `energy_readings` exists in your schema. Check with `\d energy_readings` in psql.

- [ ] **Step 2: Verify energy seed imports**

```bash
cd backend
python -c "from app.services.sandbox_seed import seed_user_energy; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/sandbox_seed.py
git commit -m "feat(sandbox): energy readings seed — 30 days hourly synthetic data"
```

---

## Task 8: Sandbox API router

**Files:**
- Create: `backend/app/api/v1/sandbox.py`

- [ ] **Step 1: Create sandbox router**

Create `backend/app/api/v1/sandbox.py`:

```python
"""
Sandbox management endpoints.
Only mounted when SANDBOX_MODE=true (set via env var on sandbox Cloud Run).
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text, func, select

from app.api.v1.auth import CurrentUser, require_roles
from app.core.config import settings
from app.core.database import DbSession
from app.models.user import RoleName
from app.repositories.user_repo import UserRepository
from app.services.sandbox_seed import seed_user_sandbox, seed_user_energy

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sandbox", tags=["sandbox"])


class SeedStatusResponse(BaseModel):
    seeded: bool
    item_count: int
    event_count: int
    location_count: int


@router.post("/seed", response_model=SeedStatusResponse)
async def seed_sandbox(session: DbSession, current_user: CurrentUser) -> SeedStatusResponse:
    """Idempotent: seeds inventory + energy data for the calling user. Safe to call multiple times."""
    if not settings.SANDBOX_MODE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not in sandbox mode")

    if not current_user.sandbox_seeded:
        await seed_user_sandbox(session, current_user)
        await seed_user_energy(session, current_user)
        await session.commit()
        logger.info("Sandbox seeded for user %d", current_user.id)

    # Return counts
    from app.models.item import Item
    from app.models.transaction import InventoryEvent
    from app.models.location import Location

    item_count = (await session.execute(select(func.count()).select_from(Item).where(Item.owner_id == current_user.id))).scalar_one()
    event_count = (await session.execute(select(func.count()).select_from(InventoryEvent).where(InventoryEvent.actor_id == current_user.id))).scalar_one()
    location_count = (await session.execute(select(func.count()).select_from(Location).where(Location.owner_id == current_user.id))).scalar_one()

    return SeedStatusResponse(
        seeded=True,
        item_count=item_count,
        event_count=event_count,
        location_count=location_count,
    )


@router.post(
    "/reset",
    response_model=SeedStatusResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN))],
)
async def reset_sandbox(
    session: DbSession,
    current_user: CurrentUser,
    target_user_id: int,
) -> SeedStatusResponse:
    """Superadmin: wipe and re-seed one user's sandbox data."""
    if not settings.SANDBOX_MODE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not in sandbox mode")

    user_repo = UserRepository(session)
    target_user = await user_repo.get_by_id(target_user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Wipe existing data
    from app.models.item import Item, Category
    from app.models.location import Area, Location
    from app.models.transaction import InventoryEvent, StockLevel, Alert

    for model, col in [
        (Alert, "item_id"),
        (StockLevel, "item_id"),
        (InventoryEvent, "actor_id"),
        (Item, "owner_id"),
        (Category, "owner_id"),
        (Location, "owner_id"),
        (Area, "owner_id"),
    ]:
        if col == "actor_id":
            await session.execute(
                text("DELETE FROM inventory_events WHERE actor_id = :uid"),
                {"uid": target_user_id},
            )
        elif col == "item_id":
            # Delete via items owned by user
            await session.execute(
                text(f"DELETE FROM {model.__tablename__} WHERE item_id IN (SELECT id FROM items WHERE owner_id = :uid)"),
                {"uid": target_user_id},
            )
        else:
            await session.execute(
                text(f"DELETE FROM {model.__tablename__} WHERE owner_id = :uid"),
                {"uid": target_user_id},
            )

    await session.execute(
        text("DELETE FROM energy_readings WHERE owner_id = :uid"),
        {"uid": target_user_id},
    )

    target_user.sandbox_seeded = False
    session.add(target_user)
    await session.flush()

    # Re-seed
    await seed_user_sandbox(session, target_user)
    await seed_user_energy(session, target_user)
    await session.commit()

    return SeedStatusResponse(seeded=True, item_count=30, event_count=50, location_count=8)


@router.get("/status", response_model=SeedStatusResponse)
async def sandbox_status(session: DbSession, current_user: CurrentUser) -> SeedStatusResponse:
    """Returns seed state for calling user."""
    if not settings.SANDBOX_MODE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not in sandbox mode")

    from app.models.item import Item
    from app.models.transaction import InventoryEvent
    from app.models.location import Location

    item_count = (await session.execute(select(func.count()).select_from(Item).where(Item.owner_id == current_user.id))).scalar_one()
    event_count = (await session.execute(select(func.count()).select_from(InventoryEvent).where(InventoryEvent.actor_id == current_user.id))).scalar_one()
    location_count = (await session.execute(select(func.count()).select_from(Location).where(Location.owner_id == current_user.id))).scalar_one()

    return SeedStatusResponse(
        seeded=current_user.sandbox_seeded,
        item_count=item_count,
        event_count=event_count,
        location_count=location_count,
    )
```

- [ ] **Step 2: Verify router imports**

```bash
cd backend
python -c "from app.api.v1.sandbox import router; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/v1/sandbox.py
git commit -m "feat(sandbox): sandbox API router — seed, reset, status endpoints"
```

---

## Task 9: Wire sandbox router into main app

**Files:**
- Modify: `backend/app/api/router.py`

- [ ] **Step 1: Mount sandbox router conditionally**

In `backend/app/api/router.py`, add at the bottom:

```python
from app.core.config import settings

if settings.SANDBOX_MODE:
    from app.api.v1 import sandbox
    api_router.include_router(sandbox.router)
```

- [ ] **Step 2: Smoke-test sandbox endpoints locally**

```bash
cd backend
SANDBOX_MODE=true uvicorn app.main:app --reload --port 8001
```

Hit `GET http://localhost:8001/docs` — verify `/sandbox/seed`, `/sandbox/reset`, `/sandbox/status` appear in Swagger UI.

- [ ] **Step 3: Verify prod mode hides sandbox routes**

```bash
uvicorn app.main:app --reload --port 8002
```

Hit `GET http://localhost:8002/docs` — sandbox routes should NOT appear.

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/router.py
git commit -m "feat(sandbox): mount sandbox router when SANDBOX_MODE=true"
```

---

## Task 10: Cloud Run sandbox deployment

**Files:**
- Create: `backend/cloudbuild-sandbox.yaml`

- [ ] **Step 1: Create Cloud Build config for sandbox**

Create `backend/cloudbuild-sandbox.yaml`:

```yaml
steps:
  # Build image
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - build
      - -t
      - '$_REGION-docker.pkg.dev/$PROJECT_ID/$_REPO/inventory-backend:sandbox-$SHORT_SHA'
      - -f
      - backend/Dockerfile
      - backend
    id: build

  # Push image
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - push
      - '$_REGION-docker.pkg.dev/$PROJECT_ID/$_REPO/inventory-backend:sandbox-$SHORT_SHA'
    id: push
    waitFor: [build]

  # Deploy to sandbox Cloud Run service
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - run
      - deploy
      - inventory-sandbox
      - --image=$_REGION-docker.pkg.dev/$PROJECT_ID/$_REPO/inventory-backend:sandbox-$SHORT_SHA
      - --region=$_REGION
      - --platform=managed
      - --allow-unauthenticated
      - --set-env-vars=SANDBOX_MODE=true,ENVIRONMENT=staging
      - --set-secrets=POSTGRES_HOST=sandbox-db-host:latest,POSTGRES_PASSWORD=sandbox-db-password:latest,SECRET_KEY=sandbox-secret-key:latest
      - --min-instances=1
      - --max-instances=5
      - --memory=512Mi
      - --cpu=1
    id: deploy
    waitFor: [push]

substitutions:
  _REGION: us-central1
  _REPO: inventory-repo

options:
  logging: CLOUD_LOGGING_ONLY
```

- [ ] **Step 2: Create sandbox Cloud SQL instance (run once)**

```bash
# Create Cloud SQL sandbox instance
gcloud sql instances create inventory-sandbox \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1 \
  --no-backup

# Create database
gcloud sql databases create postgres --instance=inventory-sandbox

# Create user
gcloud sql users create sandbox-user \
  --instance=inventory-sandbox \
  --password=<generate-strong-password>

# Store secrets
echo -n "<cloud-sql-host>" | gcloud secrets create sandbox-db-host --data-file=-
echo -n "<password>" | gcloud secrets create sandbox-db-password --data-file=-
echo -n "$(python3 -c 'import secrets; print(secrets.token_hex(32))')" | gcloud secrets create sandbox-secret-key --data-file=-
```

- [ ] **Step 3: Run Alembic migration on sandbox DB**

Connect to sandbox DB via Cloud SQL Auth Proxy and run:

```bash
# In one terminal:
cloud-sql-proxy inventory-sandbox --port 5433

# In another terminal:
cd backend
POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_DB=postgres \
POSTGRES_USER=sandbox-user POSTGRES_PASSWORD=<password> DATABASE_SSL=false \
alembic upgrade head
```

Expected: All migrations run including `008_sandbox_owner`.

- [ ] **Step 4: Trigger first sandbox deploy**

```bash
gcloud builds submit --config=backend/cloudbuild-sandbox.yaml .
```

- [ ] **Step 5: Verify sandbox service health**

```bash
curl https://<sandbox-cloud-run-url>/health
```

Expected: `{"status": "ok", "env": "staging"}`

- [ ] **Step 6: Commit**

```bash
git add backend/cloudbuild-sandbox.yaml
git commit -m "feat(sandbox): Cloud Build config for sandbox Cloud Run deployment"
```

---

## Task 11: End-to-end backend test

**Files:**
- No new files — integration test via curl

- [ ] **Step 1: Register a test user on sandbox API**

```bash
SANDBOX_URL=https://<sandbox-cloud-run-url>

curl -X POST $SANDBOX_URL/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","username":"testuser","password":"Test1234!","full_name":"Test User","role":"viewer"}'
```

Expected: `{"id": 1, "email": "test@example.com", ...}`

- [ ] **Step 2: Verify OTP email arrives, then verify**

```bash
curl -X POST $SANDBOX_URL/api/v1/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","otp":"<6-digit-code>"}'
```

Expected: `{"access_token": "...", "token_type": "bearer"}`

- [ ] **Step 3: Trigger seed**

```bash
TOKEN=<access_token>
curl -X POST $SANDBOX_URL/api/v1/sandbox/seed \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `{"seeded": true, "item_count": 30, "event_count": ..., "location_count": 8}`

- [ ] **Step 4: Verify items are scoped to user**

```bash
curl $SANDBOX_URL/api/v1/items/ \
  -H "Authorization: Bearer $TOKEN"
```

Expected: 30 items with SKUs starting `SBX-`.

- [ ] **Step 5: Register a second user, seed, verify data isolation**

Repeat Steps 1-4 with `test2@example.com`. Verify the second user sees their own 30 items (different SKUs due to different owner_id suffix) and not the first user's items.

- [ ] **Step 6: Commit (no code changes — just record test passed)**

```bash
git commit --allow-empty -m "test(sandbox): backend E2E verified — isolation, seed, OTP flow"
```
