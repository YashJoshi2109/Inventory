# Sandbox Mode — Complete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every feature (scan, RFID, dashboard, transactions, imports, AI, barcodes, AI Copilot) fully sandbox-aware so exhibition visitors interact with owner_id-scoped data and are limited to 10 AI Copilot messages.

**Architecture:** Detect `X-Sandbox-Mode: true` header in every endpoint → derive `owner_id = current_user.id` → thread through service → repository. Repositories already support `owner_id` filtering on items/locations/categories; this plan adds it to the remaining repos and all services. AI Copilot gets a persistent 10-message quota stored on `users.sandbox_copilot_msgs_used`.

**Tech Stack:** FastAPI, SQLAlchemy async, Alembic, React + Zustand, TanStack Query, pytest-asyncio

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `backend/migrations/versions/010_sandbox_copilot_quota.py` | Create | Add `sandbox_copilot_msgs_used` column to users |
| `backend/app/models/user.py` | Modify | Add `sandbox_copilot_msgs_used` mapped column |
| `backend/app/core/config.py` | Modify | Add `SANDBOX_COPILOT_LIMIT = 10` |
| `backend/app/repositories/item_repo.py` | Modify | Add `owner_id` to `get_low_stock_items`, `get_low_stock_items`, `count`; add `owner_id` to `get_all_with_counts` on CategoryRepository |
| `backend/app/repositories/transaction_repo.py` | Modify | Add `actor_id` filter to `get_events_paginated`, `get_transactions_count_since`, `get_recent_activity`, `get_top_consumed`; add `owner_id` to `count_active` on AlertRepository |
| `backend/app/services/inventory_service.py` | Modify | Add `owner_id: int \| None = None` to all 5 methods; guard item/location ownership |
| `backend/app/services/scan_service.py` | Modify | Add `owner_id: int \| None = None` to `resolve`; filter item lookups |
| `backend/app/services/import_service.py` | Modify | Add `owner_id: int \| None = None` to `import_excel`; stamp `owner_id` on created items/categories/locations |
| `backend/app/api/v1/scans.py` | Modify | All 8 endpoints gain `Request` + `sandbox_owner_id` |
| `backend/app/api/v1/rfid.py` | Modify | `_resolve_epc` + all endpoints gain `owner_id` |
| `backend/app/api/v1/dashboard.py` | Modify | `get_dashboard_stats` scoped by `owner_id` |
| `backend/app/api/v1/transactions.py` | Modify | `list_transactions`, `list_alerts`, `resolve_alert` scoped |
| `backend/app/api/v1/imports.py` | Modify | `import_excel`, `import_csv` pass `owner_id` |
| `backend/app/api/v1/ai.py` | Modify | `nlp_search` + `demand_forecast` owner guards |
| `backend/app/api/v1/barcodes.py` | Modify | Ownership guard on all item/location label endpoints |
| `backend/app/api/v1/chat.py` | Modify | Quota pre-check + increment in `send_message` |
| `backend/app/api/v1/sandbox.py` | Modify | New `GET /sandbox/copilot-quota`; reset clears counter |
| `backend/app/ai/copilot.py` | Modify | `run_copilot` gains `sandbox_owner_id: int \| None = None` |
| `backend/app/ai/tools.py` | Modify | `dispatch_tool` + all 20 tool functions gain `owner_id` param |
| `frontend/src/api/sandbox.ts` | Create | `sandboxApi.getCopilotQuota()` |
| `frontend/src/pages/AiCopilot.tsx` | Modify | Import sandbox store + quota hook + banner + disable input |
| `backend/tests/test_sandbox_quota.py` | Create | Unit tests for quota logic |
| `backend/tests/test_sandbox_ownership.py` | Create | Unit tests for ownership guard helpers |

---

### Task 1: DB Migration + Model + Config

**Files:**
- Create: `backend/migrations/versions/010_sandbox_copilot_quota.py`
- Modify: `backend/app/models/user.py`
- Modify: `backend/app/core/config.py`

- [ ] **Step 1: Write failing test for User model field**

```python
# backend/tests/test_sandbox_quota.py
import pytest

def test_user_model_has_sandbox_copilot_msgs_used():
    from app.models.user import User
    u = User.__table__.columns
    assert "sandbox_copilot_msgs_used" in u, "Column missing from User model"
    col = u["sandbox_copilot_msgs_used"]
    assert col.server_default is not None or col.default is not None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/test_sandbox_quota.py::test_user_model_has_sandbox_copilot_msgs_used -v
```

Expected: `FAILED — AssertionError: Column missing from User model`

- [ ] **Step 3: Add column to User model**

In `backend/app/models/user.py`, after the `sandbox_seeded` line:

```python
sandbox_copilot_msgs_used: Mapped[int] = mapped_column(
    Integer, nullable=False, default=0, server_default="0"
)
```

Import `Integer` if not already imported: `from sqlalchemy import Boolean, DateTime, Integer, String`

- [ ] **Step 4: Add config constant**

In `backend/app/core/config.py`, in the `Settings` class body (near other limits):

```python
SANDBOX_COPILOT_LIMIT: int = 10
```

- [ ] **Step 5: Create migration**

```bash
cd backend && alembic revision --autogenerate -m "010_sandbox_copilot_quota"
```

Then open the generated file and rename it to `010_sandbox_copilot_quota.py`. Verify it contains:

```python
def upgrade() -> None:
    op.add_column('users', sa.Column('sandbox_copilot_msgs_used', sa.Integer(), server_default='0', nullable=False))

def downgrade() -> None:
    op.drop_column('users', 'sandbox_copilot_msgs_used')
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd backend && python -m pytest tests/test_sandbox_quota.py::test_user_model_has_sandbox_copilot_msgs_used -v
```

Expected: `PASSED`

- [ ] **Step 7: Apply migration**

```bash
cd backend && alembic upgrade head
```

Expected: `Running upgrade ... -> 010_sandbox_copilot_quota`

- [ ] **Step 8: Commit**

```bash
git add backend/migrations/versions/010_sandbox_copilot_quota.py backend/app/models/user.py backend/app/core/config.py backend/tests/test_sandbox_quota.py
git commit -m "feat(sandbox): add sandbox_copilot_msgs_used to users + SANDBOX_COPILOT_LIMIT config"
```

---

### Task 2: Repository Layer — owner_id on Missing Methods

**Files:**
- Modify: `backend/app/repositories/item_repo.py`
- Modify: `backend/app/repositories/transaction_repo.py`
- Test: `backend/tests/test_sandbox_ownership.py`

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_sandbox_ownership.py
import pytest
import inspect
from app.repositories.item_repo import ItemRepository, CategoryRepository
from app.repositories.transaction_repo import InventoryEventRepository, AlertRepository

def test_get_low_stock_items_accepts_owner_id():
    sig = inspect.signature(ItemRepository.get_low_stock_items)
    assert "owner_id" in sig.parameters

def test_get_all_with_counts_accepts_owner_id():
    sig = inspect.signature(CategoryRepository.get_all_with_counts)
    assert "owner_id" in sig.parameters

def test_get_events_paginated_accepts_actor_id():
    sig = inspect.signature(InventoryEventRepository.get_events_paginated)
    assert "actor_id" in sig.parameters

def test_count_active_accepts_owner_id():
    sig = inspect.signature(AlertRepository.count_active)
    assert "owner_id" in sig.parameters

def test_get_transactions_count_since_accepts_actor_id():
    sig = inspect.signature(InventoryEventRepository.get_transactions_count_since)
    assert "actor_id" in sig.parameters

def test_item_repo_count_accepts_owner_id():
    sig = inspect.signature(ItemRepository.count)
    assert "owner_id" in sig.parameters
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest tests/test_sandbox_ownership.py -v
```

Expected: all 5 FAILED

- [ ] **Step 3: Add `count(owner_id=None)` to `ItemRepository` in `item_repo.py`**

`ItemRepository` inherits `count()` from `BaseRepository` which has no `owner_id` param. Add an override directly on `ItemRepository` after `get_by_sku`:

```python
async def count(self, owner_id: int | None = None) -> int:
    q = select(func.count()).select_from(Item).where(Item.is_active == True)  # noqa: E712
    if owner_id is not None:
        q = q.where(Item.owner_id == owner_id)
    result = await self.session.execute(q)
    return result.scalar_one()
```

- [ ] **Step 4: Update `get_low_stock_items` in `item_repo.py`**

Replace:

```python
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
```

With:

```python
async def get_low_stock_items(self, owner_id: int | None = None) -> list[tuple[Item, Decimal]]:
    """Returns items where total stock <= reorder_level."""
    stock_sum = (
        select(StockLevel.item_id, func.sum(StockLevel.quantity).label("total_qty"))
        .group_by(StockLevel.item_id)
        .subquery()
    )
    q = (
        select(Item, stock_sum.c.total_qty)
        .outerjoin(stock_sum, Item.id == stock_sum.c.item_id)
        .where(
            Item.is_active == True,  # noqa: E712
            func.coalesce(stock_sum.c.total_qty, 0) <= Item.reorder_level,
        )
        .options(selectinload(Item.category))
        .order_by(Item.name)
    )
    if owner_id is not None:
        q = q.where(Item.owner_id == owner_id)
    result = await self.session.execute(q)
    return [(row[0], row[1] or Decimal("0")) for row in result.all()]
```

- [ ] **Step 5: Update `get_all_with_counts` in `item_repo.py` (CategoryRepository)**

Replace:

```python
async def get_all_with_counts(self) -> list[tuple[Category, int]]:
    result = await self.session.execute(
        select(Category, func.count(Item.id).label("item_count"))
        .outerjoin(Item, Item.category_id == Category.id)
        .group_by(Category.id)
        .order_by(Category.name)
    )
```

With:

```python
async def get_all_with_counts(self, owner_id: int | None = None) -> list[tuple[Category, int]]:
    q = (
        select(Category, func.count(Item.id).label("item_count"))
        .outerjoin(Item, Item.category_id == Category.id)
        .group_by(Category.id)
        .order_by(Category.name)
    )
    if owner_id is not None:
        q = q.where(Category.owner_id == owner_id)
    result = await self.session.execute(q)
```

- [ ] **Step 6: Update `get_events_paginated` in `transaction_repo.py`**

Add `actor_id: int | None = None` to the signature and filter inside the method. Find the `filters = []` block and add:

```python
async def get_events_paginated(
    self,
    item_id: int | None = None,
    location_id: int | None = None,
    event_kind: str | None = None,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
    actor_id: int | None = None,
    skip: int = 0,
    limit: int = 50,
) -> tuple[list[InventoryEvent], int]:
```

Inside the `filters` block, add after existing filters:

```python
if actor_id is not None:
    filters.append(InventoryEvent.actor_id == actor_id)
```

- [ ] **Step 7: Update `get_transactions_count_since` in `transaction_repo.py`**

Replace:

```python
async def get_transactions_count_since(self, since: datetime) -> int:
    result = await self.session.execute(
        select(func.count())
        .select_from(InventoryEvent)
        .where(InventoryEvent.occurred_at >= since)
    )
    return result.scalar_one()
```

With:

```python
async def get_transactions_count_since(self, since: datetime, actor_id: int | None = None) -> int:
    q = (
        select(func.count())
        .select_from(InventoryEvent)
        .where(InventoryEvent.occurred_at >= since)
    )
    if actor_id is not None:
        q = q.where(InventoryEvent.actor_id == actor_id)
    result = await self.session.execute(q)
    return result.scalar_one()
```

- [ ] **Step 8: Update `count_active` in `transaction_repo.py` (AlertRepository)**

Replace:

```python
async def count_active(self) -> int:
    result = await self.session.execute(
        select(func.count()).select_from(Alert).where(Alert.is_resolved == False)  # noqa: E712
    )
    return result.scalar_one()
```

With:

```python
async def count_active(self, owner_id: int | None = None) -> int:
    q = select(func.count()).select_from(Alert).where(Alert.is_resolved == False)  # noqa: E712
    if owner_id is not None:
        q = q.join(Item, Alert.item_id == Item.id).where(Item.owner_id == owner_id)
    result = await self.session.execute(q)
    return result.scalar_one()
```

- [ ] **Step 9: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/test_sandbox_ownership.py -v
```

Expected: all 6 PASSED

- [ ] **Step 10: Commit**

```bash
git add backend/app/repositories/item_repo.py backend/app/repositories/transaction_repo.py backend/tests/test_sandbox_ownership.py
git commit -m "feat(sandbox): add owner_id/actor_id params to repo methods for sandbox scoping"
```

---

### Task 3: Service Layer — InventoryService + ScanService + ImportService

**Files:**
- Modify: `backend/app/services/inventory_service.py`
- Modify: `backend/app/services/scan_service.py`
- Modify: `backend/app/services/import_service.py`

- [ ] **Step 1: Update `InventoryService.stock_in`**

Add `owner_id: int | None = None` param and ownership guard after fetching item:

```python
async def stock_in(self, req: StockInRequest, actor_id: int, owner_id: int | None = None) -> InventoryEvent:
    item = await self._item_repo.get_by_id(req.item_id)
    if not item or not item.is_active:
        raise HTTPException(status_code=404, detail="Item not found")
    if owner_id is not None and item.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Item not found")
    # ... rest unchanged
```

- [ ] **Step 2: Update `InventoryService.stock_out`**

```python
async def stock_out(
    self, req: StockOutRequest, actor_id: int, actor_roles: list[str], owner_id: int | None = None
) -> InventoryEvent:
    item = await self._item_repo.get_by_id(req.item_id)
    if not item or not item.is_active:
        raise HTTPException(status_code=404, detail="Item not found")
    if owner_id is not None and item.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Item not found")
    # ... rest unchanged
```

- [ ] **Step 3: Update `InventoryService.transfer`**

```python
async def transfer(self, req: TransferRequest, actor_id: int, owner_id: int | None = None) -> InventoryEvent:
    item = await self._item_repo.get_by_id(req.item_id)
    if not item or not item.is_active:
        raise HTTPException(status_code=404, detail="Item not found")
    if owner_id is not None and item.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Item not found")
    # ... rest unchanged
```

- [ ] **Step 4: Update `InventoryService.adjustment`**

```python
async def adjustment(self, req: AdjustmentRequest, actor_id: int, owner_id: int | None = None) -> InventoryEvent:
    item = await self._item_repo.get_by_id(req.item_id)
    if not item or not item.is_active:
        raise HTTPException(status_code=404, detail="Item not found")
    if owner_id is not None and item.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Item not found")
    # ... rest unchanged
```

- [ ] **Step 5: Update `InventoryService.apply_barcode_scan`**

```python
async def apply_barcode_scan(
    self, body: BarcodeScanApplyRequest, actor_id: int, actor_roles: list[str], owner_id: int | None = None
) -> InventoryEvent:
```

Inside the method, after resolving the item (wherever `item` is fetched), add:

```python
if owner_id is not None and item.owner_id != owner_id:
    raise HTTPException(status_code=404, detail="Item not found")
```

- [ ] **Step 6: Update `ScanService.resolve`**

In `backend/app/services/scan_service.py`, update the `resolve` signature:

```python
async def resolve(self, barcode_value: str, owner_id: int | None = None) -> ScanResult:
```

After any block that resolves an item (look for `return await self._item_result(item)` calls), add the owner guard before returning:

```python
if owner_id is not None and item.owner_id != owner_id:
    return ScanResult(
        result_type=ScanResultType.NOT_FOUND,
        id=None,
        code=barcode_value,
        name="Not found",
        details={},
    )
return await self._item_result(item)
```

Do this for ALL places where an item is resolved and returned — there are multiple barcode format branches. Each one that calls `self._item_result(item)` needs the guard inserted before it.

- [ ] **Step 7: Update `ImportService.import_excel`**

Change signature:

```python
async def import_excel(self, file_bytes: bytes, filename: str, actor_id: int, owner_id: int | None = None) -> ImportJob:
```

Inside the item creation block (where `item = Item(sku=sku, ...)` is created), add `owner_id=owner_id` to the constructor:

```python
item = Item(
    sku=sku,
    name=str(row.get("Description", sku)).strip(),
    category_id=category.id,
    unit_cost=unit_cost,
    reorder_level=reorder,
    reorder_qty=reorder * 2,
    lead_days=lead,
    owner_id=owner_id,
)
```

Also update `_get_or_create_category` to accept and set `owner_id`:

```python
async def _get_or_create_category(self, name: str, owner_id: int | None = None) -> Category:
    if owner_id is not None:
        # For sandbox: always create a new owner-scoped category
        from sqlalchemy import select
        result = await self._session.execute(
            select(Category).where(
                func.lower(Category.name) == name.lower(),
                Category.owner_id == owner_id,
            )
        )
        cat = result.scalar_one_or_none()
        if not cat:
            cat = Category(
                name=name,
                item_type="consumable",
                color=LEGACY_CATEGORY_COLOR_MAP.get(name, "#6b7280"),
                owner_id=owner_id,
            )
            self._session.add(cat)
            await self._session.flush()
        return cat
    # Original non-sandbox path unchanged
    cat = await self._cat_repo.get_by_name(name)
    if not cat:
        cat = Category(
            name=name,
            item_type="consumable",
            color=LEGACY_CATEGORY_COLOR_MAP.get(name, "#6b7280"),
        )
        self._session.add(cat)
        await self._session.flush()
    return cat
```

Update every call to `_get_or_create_category` inside `import_excel` to pass `owner_id`:

```python
category = await self._get_or_create_category(cat_name, owner_id=owner_id)
```

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/inventory_service.py backend/app/services/scan_service.py backend/app/services/import_service.py
git commit -m "feat(sandbox): owner_id ownership guards in InventoryService, ScanService, ImportService"
```

---

### Task 4: Scan + RFID Endpoints

**Files:**
- Modify: `backend/app/api/v1/scans.py`
- Modify: `backend/app/api/v1/rfid.py`

- [ ] **Step 1: Add `Request` import to `scans.py`**

At the top of `backend/app/api/v1/scans.py`, add to the fastapi import line:

```python
from fastapi import APIRouter, HTTPException, Request, status
```

Also add:

```python
from app.core.sandbox import sandbox_owner_id
```

- [ ] **Step 2: Update `lookup_barcode`**

```python
@router.post("/lookup", response_model=ScanLookupResponse)
async def lookup_barcode(
    body: ScanLookupRequest,
    request: Request,
    session: DbSession,
    current_user: CurrentUser,
) -> ScanLookupResponse:
    owner_id = sandbox_owner_id(request, current_user)
    svc = ScanService(session)
    result: ScanResult = await svc.resolve(body.barcode_value, owner_id=owner_id)
    return ScanLookupResponse(
        result_type=result.result_type,
        id=result.id,
        code=result.code,
        name=result.name,
        details=result.details,
    )
```

- [ ] **Step 3: Update `stock_in`, `stock_out`, `transfer`, `adjustment`**

For each of these four endpoints, add `request: Request` and pass `owner_id`:

```python
@router.post("/stock-in", response_model=InventoryEventRead, status_code=status.HTTP_201_CREATED)
async def stock_in(body: StockInRequest, request: Request, session: DbSession, current_user: CurrentUser) -> InventoryEventRead:
    owner_id = sandbox_owner_id(request, current_user)
    svc = InventoryService(session)
    event = await svc.stock_in(body, current_user.id, owner_id=owner_id)
    await session.refresh(event, ["item", "to_location", "actor"])
    return _event_to_read(event, session)

@router.post("/stock-out", response_model=InventoryEventRead, status_code=status.HTTP_201_CREATED)
async def stock_out(body: StockOutRequest, request: Request, session: DbSession, current_user: CurrentUser) -> InventoryEventRead:
    owner_id = sandbox_owner_id(request, current_user)
    svc = InventoryService(session)
    actor_roles = [ur.role.name for ur in current_user.roles if ur.role]
    event = await svc.stock_out(body, current_user.id, actor_roles, owner_id=owner_id)
    await session.refresh(event, ["item", "from_location", "actor"])
    return _event_to_read(event, session)

@router.post("/transfer", response_model=InventoryEventRead, status_code=status.HTTP_201_CREATED)
async def transfer(body: TransferRequest, request: Request, session: DbSession, current_user: CurrentUser) -> InventoryEventRead:
    owner_id = sandbox_owner_id(request, current_user)
    svc = InventoryService(session)
    event = await svc.transfer(body, current_user.id, owner_id=owner_id)
    await session.refresh(event, ["item", "from_location", "to_location", "actor"])
    return _event_to_read(event, session)

@router.post("/adjustment", response_model=InventoryEventRead, status_code=status.HTTP_201_CREATED)
async def adjustment(body: AdjustmentRequest, request: Request, session: DbSession, current_user: CurrentUser) -> InventoryEventRead:
    owner_id = sandbox_owner_id(request, current_user)
    svc = InventoryService(session)
    event = await svc.adjustment(body, current_user.id, owner_id=owner_id)
    await session.refresh(event, ["item", "to_location", "actor"])
    return _event_to_read(event, session)
```

- [ ] **Step 4: Update `apply_scan_event` and `smart_apply`**

```python
@router.post("/apply", response_model=InventoryEventRead, status_code=status.HTTP_201_CREATED)
async def apply_scan_event(body: BarcodeScanApplyRequest, request: Request, session: DbSession, current_user: CurrentUser) -> InventoryEventRead:
    owner_id = sandbox_owner_id(request, current_user)
    svc = InventoryService(session)
    actor_roles = [ur.role.name for ur in current_user.roles if ur.role]
    event = await svc.apply_barcode_scan(body, current_user.id, actor_roles, owner_id=owner_id)
    await session.refresh(event, ["item", "from_location", "to_location", "actor"])
    return _event_to_read(event, session)
```

For `smart_apply`, add `request: Request` and derive `owner_id = sandbox_owner_id(request, current_user)`. Pass `owner_id` to every `svc.stock_in`, `svc.stock_out`, `svc.transfer` call inside the function.

- [ ] **Step 5: Update `modify_item_by_scan`**

```python
@router.post("/modify-item", response_model=ModifyItemResponse)
async def modify_item_by_scan(body: ModifyItemRequest, request: Request, session: DbSession, current_user: CurrentUser) -> ModifyItemResponse:
    from app.repositories.item_repo import ItemRepository
    from app.core.sandbox import sandbox_owner_id
    owner_id = sandbox_owner_id(request, current_user)
    repo = ItemRepository(session)
    item = await repo.get_by_id(body.item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if owner_id is not None and item.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Item not found")
    # ... rest of update logic unchanged
```

- [ ] **Step 6: Update RFID endpoints**

In `backend/app/api/v1/rfid.py`, add imports:

```python
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from app.core.sandbox import sandbox_owner_id
```

Update `_resolve_epc` to accept `owner_id`:

```python
async def _resolve_epc(epc: str, session: DbSession, owner_id: int | None = None) -> ResolvedRfidItem | None:
    result = await ScanService(session).resolve(epc.strip().upper(), owner_id=owner_id)
    if result.result_type != ScanResultType.ITEM or result.id is None:
        return None
    return ResolvedRfidItem(
        item_id=result.id,
        sku=result.code,
        name=result.name,
        unit=result.details.get("unit", "pcs"),
        category=result.details.get("category", ""),
        total_quantity=result.details.get("total_quantity", 0.0),
        reorder_level=result.details.get("reorder_level", 0.0),
        unit_cost=result.details.get("unit_cost", 0.0),
        epc=epc.strip().upper(),
    )
```

Update `scan_single_epc`, `scan_batch_epcs`, `batch_stock_in`, `batch_stock_out` to add `request: Request` and pass `owner_id`:

```python
@router.post("/scan", response_model=EpcScanResponse)
async def scan_single_epc(body: EpcScanRequest, request: Request, session: DbSession, current_user: CurrentUser) -> EpcScanResponse:
    owner_id = sandbox_owner_id(request, current_user)
    epc = body.epc.strip().upper()
    item = await _resolve_epc(epc, session, owner_id=owner_id)
    return EpcScanResponse(found=item is not None, epc=epc, item=item)

@router.post("/batch-scan", response_model=BatchScanResponse)
async def scan_batch_epcs(body: BatchScanRequest, request: Request, session: DbSession, current_user: CurrentUser) -> BatchScanResponse:
    owner_id = sandbox_owner_id(request, current_user)
    matched, unknown, seen = [], [], set()
    for epc in body.epcs:
        item = await _resolve_epc(epc, session, owner_id=owner_id)
        if item is None:
            unknown.append(epc.strip().upper())
        elif item.item_id not in seen:
            matched.append(item)
            seen.add(item.item_id)
    return BatchScanResponse(matched=matched, unknown_epcs=unknown)

@router.post("/batch-stock-in", response_model=list[BatchActionResult])
async def batch_stock_in(body: BatchStockInRequest, request: Request, session: DbSession, current_user: CurrentUser) -> list[BatchActionResult]:
    owner_id = sandbox_owner_id(request, current_user)
    svc = InventoryService(session)
    repo = ItemRepository(session)
    results = []
    for item_id in body.item_ids:
        item = await repo.get_by_id(item_id)
        if not item or (owner_id is not None and item.owner_id != owner_id):
            results.append(BatchActionResult(item_id=item_id, sku="?", success=False, error="Not found"))
            continue
        try:
            await svc.stock_in(StockInRequest(
                item_id=item_id, location_id=body.location_id,
                quantity=body.quantity_each, reference=body.reference,
                notes=body.notes, source="rfid",
            ), current_user.id, owner_id=owner_id)
            results.append(BatchActionResult(item_id=item_id, sku=item.sku, success=True))
        except Exception as exc:
            results.append(BatchActionResult(item_id=item_id, sku=item.sku, success=False, error=str(exc)))
    return results
```

Do the same for `batch_stock_out` — add `request: Request`, derive `owner_id`, pass to `svc.stock_out(..., owner_id=owner_id)`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/v1/scans.py backend/app/api/v1/rfid.py
git commit -m "feat(sandbox): scan and RFID endpoints scoped by sandbox owner_id"
```

---

### Task 5: Dashboard + Transactions + Alerts Endpoints

**Files:**
- Modify: `backend/app/api/v1/dashboard.py`
- Modify: `backend/app/api/v1/transactions.py`

- [ ] **Step 1: Update dashboard imports**

In `backend/app/api/v1/dashboard.py`, add:

```python
from fastapi import APIRouter, Request
from app.core.sandbox import sandbox_owner_id
```

- [ ] **Step 2: Update `get_dashboard_stats`**

Add `request: Request` as first param after `session`:

```python
@router.get("/stats", response_model=DashboardStats)
async def get_dashboard_stats(session: DbSession, request: Request, current_user: CurrentUser) -> DashboardStats:
    owner_id = sandbox_owner_id(request, current_user)
    item_repo = ItemRepository(session)
    cat_repo = CategoryRepository(session)
    event_repo = InventoryEventRepository(session)
    stock_repo = StockLevelRepository(session)
    alert_repo = AlertRepository(session)

    total_skus = await item_repo.count(owner_id=owner_id)

    low_stock_items = await item_repo.get_low_stock_items(owner_id=owner_id)
    items_low = sum(1 for _, qty in low_stock_items if qty > 0)
    items_out = sum(1 for _, qty in low_stock_items if qty <= 0)
```

For the `total_value` query, add `owner_id` filter:

```python
    value_q = (
        select(func.sum(StockLevel.quantity * Item.unit_cost))
        .join(Item, StockLevel.item_id == Item.id)
        .where(Item.is_active == True)  # noqa: E712
    )
    if owner_id is not None:
        value_q = value_q.where(Item.owner_id == owner_id)
    value_result = await session.execute(value_q)
    total_value = Decimal(str(value_result.scalar_one() or 0))
```

Pass `actor_id=owner_id` to transaction counts:

```python
    txn_today = await event_repo.get_transactions_count_since(today_start, actor_id=owner_id)
    txn_week = await event_repo.get_transactions_count_since(week_start, actor_id=owner_id)
    active_alerts = await alert_repo.count_active(owner_id=owner_id)
    cats_with_counts = await cat_repo.get_all_with_counts(owner_id=owner_id)
```

For `get_recent_activity` and `get_top_consumed`, add `actor_id` param to those repo methods (same pattern — `if actor_id is not None: q = q.where(InventoryEvent.actor_id == actor_id)`) and pass `actor_id=owner_id`.

- [ ] **Step 3: Add `actor_id` to `get_recent_activity` and `get_top_consumed` in `transaction_repo.py`**

`get_recent_activity`:

```python
async def get_recent_activity(self, limit: int = 20, actor_id: int | None = None) -> list[InventoryEvent]:
    q = (
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
    if actor_id is not None:
        q = q.where(InventoryEvent.actor_id == actor_id)
    result = await self.session.execute(q)
    return list(result.scalars().unique().all())
```

`get_top_consumed` — open `transaction_repo.py`, find the method, add `actor_id` param and filter:

```python
async def get_top_consumed(self, days: int = 30, limit: int = 10, actor_id: int | None = None) -> list[dict]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    q = (
        select(InventoryEvent.item_id, func.sum(InventoryEvent.quantity).label("total"))
        .where(
            InventoryEvent.event_kind == EventKind.STOCK_OUT,
            InventoryEvent.occurred_at >= since,
        )
        .group_by(InventoryEvent.item_id)
        .order_by(func.sum(InventoryEvent.quantity).desc())
        .limit(limit)
    )
    if actor_id is not None:
        q = q.where(InventoryEvent.actor_id == actor_id)
    # ... rest of method unchanged (fetching item details for each result)
```

Note: the `if actor_id is not None` filter must be added BEFORE `.group_by()`.

Then in `dashboard.py`:

```python
    recent_events = await event_repo.get_recent_activity(limit=15, actor_id=owner_id)
    top_consumed = await event_repo.get_top_consumed(days=30, limit=8, actor_id=owner_id)
```

- [ ] **Step 4: Update transactions endpoint**

In `backend/app/api/v1/transactions.py`, add:

```python
from fastapi import APIRouter, HTTPException, Query, Request
from app.core.sandbox import sandbox_owner_id
```

Update `list_transactions`:

```python
@router.get("/", response_model=PaginatedResponse[InventoryEventRead])
async def list_transactions(
    session: DbSession,
    request: Request,
    current_user: CurrentUser,
    item_id: int | None = None,
    location_id: int | None = None,
    event_kind: str | None = None,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> PaginatedResponse[InventoryEventRead]:
    owner_id = sandbox_owner_id(request, current_user)
    repo = InventoryEventRepository(session)
    skip = (page - 1) * page_size
    events, total = await repo.get_events_paginated(
        item_id=item_id,
        location_id=location_id,
        event_kind=event_kind,
        start_date=start_date,
        end_date=end_date,
        actor_id=owner_id,
        skip=skip,
        limit=page_size,
    )
    return PaginatedResponse(
        items=[_to_read(e) for e in events],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size,
    )
```

Update `list_alerts`:

```python
@router.get("/alerts", response_model=list[AlertRead])
async def list_alerts(
    session: DbSession,
    request: Request,
    current_user: CurrentUser,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
) -> list[AlertRead]:
    owner_id = sandbox_owner_id(request, current_user)
    repo = AlertRepository(session)
    skip = (page - 1) * page_size
    if owner_id is not None:
        from sqlalchemy import select
        from app.models.item import Item
        from app.models.transaction import Alert
        q = (
            select(Alert)
            .join(Item, Alert.item_id == Item.id)
            .where(Alert.is_resolved == False, Item.owner_id == owner_id)  # noqa: E712
            .offset(skip).limit(page_size)
        )
        result = await session.execute(q)
        alerts = result.scalars().all()
    else:
        alerts = await repo.get_active_alerts(skip=skip, limit=page_size)
    return [
        AlertRead(
            id=a.id,
            item_id=a.item_id,
            alert_type=a.alert_type,
            severity=a.severity,
            message=a.message,
            is_resolved=a.is_resolved,
            created_at=a.created_at,
        )
        for a in alerts
    ]
```

Update `resolve_alert` — add ownership guard:

```python
@router.patch("/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: int, request: Request, session: DbSession, current_user: CurrentUser) -> AlertRead:
    from datetime import datetime, timezone
    from app.models.item import Item
    owner_id = sandbox_owner_id(request, current_user)
    repo = AlertRepository(session)
    alert = await repo.get_by_id(alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    if owner_id is not None:
        item = await session.get(Item, alert.item_id)
        if not item or item.owner_id != owner_id:
            raise HTTPException(status_code=404, detail="Alert not found")
    # ... rest unchanged
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/dashboard.py backend/app/api/v1/transactions.py backend/app/repositories/transaction_repo.py
git commit -m "feat(sandbox): dashboard + transactions + alerts scoped by sandbox owner_id"
```

---

### Task 6: Imports + AI + Barcodes Endpoints

**Files:**
- Modify: `backend/app/api/v1/imports.py`
- Modify: `backend/app/api/v1/ai.py`
- Modify: `backend/app/api/v1/barcodes.py`

- [ ] **Step 1: Update imports endpoint**

In `backend/app/api/v1/imports.py`, add:

```python
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from app.core.sandbox import sandbox_owner_id
```

Update `import_excel`:

```python
@router.post("/excel", response_model=ImportJobRead, status_code=status.HTTP_201_CREATED)
async def import_excel(
    session: DbSession,
    request: Request,
    current_user: CurrentUser,
    file: UploadFile = File(...),
) -> ImportJobRead:
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only .xlsx and .xls files are supported")
    owner_id = sandbox_owner_id(request, current_user)
    content = await file.read()
    svc = ImportService(session)
    job = await svc.import_excel(content, file.filename, current_user.id, owner_id=owner_id)
    return ImportJobRead.model_validate(job)
```

Do the same for `import_csv` — add `request: Request`, derive `owner_id`, pass `owner_id=owner_id` to `svc.import_excel(...)`.

- [ ] **Step 2: Update AI search endpoint**

In `backend/app/api/v1/ai.py`, update `nlp_search`:

```python
@router.get("/search", response_model=SearchResponse)
async def nlp_search(
    request: Request,
    q: str = Query(min_length=2),
    session: DbSession = None,
    current_user: CurrentUser = None,
    limit: int = Query(default=10, ge=1, le=50),
) -> SearchResponse:
    from decimal import Decimal
    from app.core.sandbox import sandbox_owner_id as _sbx_owner_id
    owner_id = _sbx_owner_id(request, current_user)
    
    item_repo = ItemRepository(session)
    stock_repo = StockLevelRepository(session)

    tfidf_hits = global_search(q, top_k=limit * 2)
    good_hits = [h for h in tfidf_hits if h.score >= 0.08]
    tfidf_score_map: dict[int, float] = {h.item_id: h.score for h in good_hits[:limit]}

    # Filter TF-IDF hits by owner_id if sandbox
    if owner_id is not None:
        filtered_map = {}
        for item_id, score in tfidf_score_map.items():
            item = await item_repo.get_by_id(item_id)
            if item and item.owner_id == owner_id:
                filtered_map[item_id] = score
        tfidf_score_map = filtered_map

    tokens = [t for t in q.split() if len(t) >= 2]
    search_term = max(tokens, key=len) if tokens else q
    db_items, _ = await item_repo.search(
        query=search_term, skip=0, limit=limit, is_active=True, owner_id=owner_id
    )
    # ... rest of merge logic unchanged
```

- [ ] **Step 3: Update AI forecast endpoint**

```python
@router.get("/forecast/{item_id}", response_model=ForecastResponse)
async def demand_forecast(
    item_id: int,
    request: Request,
    session: DbSession,
    current_user: CurrentUser,
    days: int = Query(default=90, ge=14, le=365),
) -> ForecastResponse:
    from app.core.sandbox import sandbox_owner_id as _sbx_owner_id
    owner_id = _sbx_owner_id(request, current_user)
    item_repo = ItemRepository(session)
    item = await item_repo.get_by_id(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if owner_id is not None and item.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Item not found")
    # ... rest unchanged
```

- [ ] **Step 4: Add ownership guards to barcodes**

In `backend/app/api/v1/barcodes.py`, add:

```python
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from app.core.sandbox import sandbox_owner_id
```

For every endpoint that fetches an item by ID (e.g., `item_qr_png`, `item_label_zpl`, `item_barcode_meta`, `item_barcode_png`, `bulk_items_zpl`), add `request: Request` and an ownership guard after fetching the item:

```python
# Example — apply the same pattern to ALL item-fetching endpoints:
@router.get("/items/{item_id}/qr.png")
async def item_qr_png(item_id: int, request: Request, session: DbSession, current_user: CurrentUser) -> Response:
    owner_id = sandbox_owner_id(request, current_user)
    item = await session.get(Item, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if owner_id is not None and item.owner_id != owner_id:
        raise HTTPException(status_code=404, detail="Item not found")
    # ... rest unchanged
```

For location endpoints (`location_label_zpl`, `location_barcode_meta`, etc.), do the same guard on `location.owner_id`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/imports.py backend/app/api/v1/ai.py backend/app/api/v1/barcodes.py
git commit -m "feat(sandbox): imports, AI search/forecast, barcodes scoped by sandbox owner_id"
```

---

### Task 7: Copilot Quota — Chat Endpoint + Sandbox Router

**Files:**
- Modify: `backend/app/api/v1/chat.py`
- Modify: `backend/app/api/v1/sandbox.py`

- [ ] **Step 1: Write failing test for quota enforcement**

```python
# backend/tests/test_sandbox_quota.py  (append to existing file)

def test_sandbox_copilot_limit_constant():
    from app.core.config import settings
    assert settings.SANDBOX_COPILOT_LIMIT == 10

def test_sandbox_header_detection():
    from app.core.sandbox import is_sandbox_request
    from unittest.mock import MagicMock
    req_sandbox = MagicMock()
    req_sandbox.headers = {"X-Sandbox-Mode": "true"}
    assert is_sandbox_request(req_sandbox) is True

    req_normal = MagicMock()
    req_normal.headers = {}
    assert is_sandbox_request(req_normal) is False
```

- [ ] **Step 2: Run tests**

```bash
cd backend && python -m pytest tests/test_sandbox_quota.py -v
```

Expected: PASSED (these use already-existing code)

- [ ] **Step 3: Update `send_message` in `chat.py`**

At the top of the `send_message` function, after session validation, add quota check:

```python
# ── Sandbox quota check ────────────────────────────────────────────────────
is_sandbox = request.headers.get("X-Sandbox-Mode", "").lower() == "true"
if is_sandbox and current_user.sandbox_copilot_msgs_used >= settings.SANDBOX_COPILOT_LIMIT:
    raise HTTPException(
        status_code=429,
        detail={
            "code": "SANDBOX_COPILOT_LIMIT",
            "used": current_user.sandbox_copilot_msgs_used,
            "limit": settings.SANDBOX_COPILOT_LIMIT,
            "message": "Sandbox copilot limit reached. Ask admin to reset.",
        },
    )
```

After `await db.flush()` for the user message, add increment:

```python
# ── Increment sandbox quota ────────────────────────────────────────────────
if is_sandbox:
    current_user.sandbox_copilot_msgs_used += 1
    db.add(current_user)
```

Make sure `settings` is imported: add `from app.core.config import settings` if not already present.

Also add to `send_message` signature: `request: Request` param, and import `Request` from fastapi if not already there.

Pass `sandbox_owner_id` to `run_copilot`:

```python
from app.core.sandbox import sandbox_owner_id as _sandbox_owner_id
# ...
sbx_owner_id = current_user.id if is_sandbox else None
# ...
async for sse_line in run_copilot(
    messages=openai_messages,
    db=None,
    actor_id=actor_id,
    actor_roles=actor_roles,
    image_bytes=image_bytes,
    image_mime=image_mime,
    sandbox_owner_id=sbx_owner_id,
):
```

- [ ] **Step 4: Add `GET /sandbox/copilot-quota` endpoint to `sandbox.py`**

```python
class CopilotQuotaResponse(BaseModel):
    used: int
    limit: int
    remaining: int


@router.get("/copilot-quota", response_model=CopilotQuotaResponse)
async def get_copilot_quota(current_user: CurrentUser) -> CopilotQuotaResponse:
    """Returns sandbox copilot message quota for calling user."""
    limit = settings.SANDBOX_COPILOT_LIMIT
    used = current_user.sandbox_copilot_msgs_used
    return CopilotQuotaResponse(
        used=used,
        limit=limit,
        remaining=max(0, limit - used),
    )
```

Note: This endpoint is intentionally mounted unconditionally (not gated by `SANDBOX_MODE`) so the frontend can safely call it in any environment. When not in sandbox, `used` will always be 0.

- [ ] **Step 5: Update `POST /sandbox/reset` to clear quota**

In the reset endpoint, after `target_user.sandbox_seeded = False`, add:

```python
target_user.sandbox_copilot_msgs_used = 0
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/chat.py backend/app/api/v1/sandbox.py
git commit -m "feat(sandbox): copilot 10-message quota enforcement + /sandbox/copilot-quota endpoint"
```

---

### Task 8: Copilot Tools — run_copilot + dispatch_tool + All Tool Functions

**Files:**
- Modify: `backend/app/ai/copilot.py`
- Modify: `backend/app/ai/tools.py`

- [ ] **Step 1: Update `run_copilot` signature in `copilot.py`**

Find `async def run_copilot(` and add `sandbox_owner_id: int | None = None` to the keyword args:

```python
async def run_copilot(
    *,
    messages: list[dict],
    db: AsyncSession | None,
    actor_id: int,
    actor_roles: list[str],
    image_bytes: bytes | None = None,
    image_mime: str | None = None,
    sandbox_owner_id: int | None = None,
) -> AsyncIterator[str]:
```

Find where `dispatch_tool` is called inside `run_copilot` (it will be in the agentic loop) and add `sandbox_owner_id=sandbox_owner_id`:

```python
result = await dispatch_tool(
    name=tool_name,
    args=tool_args,
    db=tool_db,
    actor_id=actor_id,
    actor_roles=actor_roles,
    role_names=actor_roles,
    sandbox_owner_id=sandbox_owner_id,
)
```

- [ ] **Step 2: Update `dispatch_tool` signature in `tools.py`**

Find `async def dispatch_tool(` at line 1565 and add `sandbox_owner_id: int | None = None`:

```python
async def dispatch_tool(
    name: str,
    args: dict[str, Any],
    db: AsyncSession,
    actor_id: int,
    actor_roles: list[str],
    role_names: list[str],
    sandbox_owner_id: int | None = None,
) -> dict[str, Any]:
```

- [ ] **Step 3: Thread `owner_id` through every tool call in `dispatch_tool`**

In the dispatch body, update every `await <tool_fn>(db, ...)` call to pass `owner_id=sandbox_owner_id`. Full replacement of the dispatch body (keep the rate limit check at top unchanged):

```python
    if name == "search_inventory":
        return await search_inventory(db, owner_id=sandbox_owner_id, **args)
    if name == "get_item_details":
        return await get_item_details(db, owner_id=sandbox_owner_id, **args)
    if name == "get_location_contents":
        return await get_location_contents(db, owner_id=sandbox_owner_id, **args)
    if name == "list_low_stock_items":
        return await list_low_stock_items(db, owner_id=sandbox_owner_id, **args)
    if name == "list_overdue_items":
        return await list_overdue_items(db, owner_id=sandbox_owner_id, **args)
    if name == "get_dashboard_summary":
        return await get_dashboard_summary(db, owner_id=sandbox_owner_id)
    if name == "perform_stock_in":
        return await perform_stock_in(db, actor_id, owner_id=sandbox_owner_id, **args)
    if name == "perform_stock_out":
        return await perform_stock_out(db, actor_id, actor_roles, owner_id=sandbox_owner_id, **args)
    if name == "perform_transfer":
        return await perform_transfer(db, actor_id, owner_id=sandbox_owner_id, **args)
    if name == "list_locations":
        return await list_locations(db, owner_id=sandbox_owner_id, **args)
    if name == "get_transaction_history":
        return await get_transaction_history(db, owner_id=sandbox_owner_id, **args)
    if name == "list_categories":
        return await list_categories(db, owner_id=sandbox_owner_id)
    if name == "rag_search_docs":
        return await rag_search_docs(db, **args)
    if name == "create_item":
        return await create_item(db, owner_id=sandbox_owner_id, **args)
    if name == "update_item":
        return await update_item(db, owner_id=sandbox_owner_id, **args)
    if name == "delete_item":
        return await delete_item(db, owner_id=sandbox_owner_id, **args)
    if name == "create_category":
        return await create_category(db, owner_id=sandbox_owner_id, **args)
    if name == "update_category":
        return await update_category(db, owner_id=sandbox_owner_id, **args)
    if name == "delete_category":
        return await delete_category(db, owner_id=sandbox_owner_id, **args)
    if name == "create_location":
        return await create_location(db, owner_id=sandbox_owner_id, **args)
    if name == "update_location":
        return await update_location(db, owner_id=sandbox_owner_id, **args)
    if name == "delete_location":
        return await delete_location(db, owner_id=sandbox_owner_id, **args)
    if name == "ask_user":
        return await ask_user(**args)
    raise ValueError(f"Unknown tool: {name}")
```

- [ ] **Step 4: Update all tool function signatures in `tools.py`**

For each of the following functions, add `owner_id: int | None = None` as a parameter and apply the appropriate guard/filter. Work through them one at a time:

**`search_inventory` (line ~56):**
```python
async def search_inventory(db: AsyncSession, query: str, owner_id: int | None = None, ...) -> dict:
    # Pass owner_id to item_repo.search
    items, total = await item_repo.search(query=query, ..., owner_id=owner_id)
```

**`get_item_details` (line ~97):**
```python
async def get_item_details(db: AsyncSession, item_id: int, owner_id: int | None = None) -> dict:
    item = await item_repo.get_with_details(item_id)
    if not item:
        return {"error": "Item not found"}
    if owner_id is not None and item.owner_id != owner_id:
        return {"error": "Item not found"}
```

**`get_location_contents` (line ~182):**
```python
async def get_location_contents(db: AsyncSession, location_id: int, owner_id: int | None = None) -> dict:
    location = await loc_repo.get_with_area(location_id)
    if not location:
        return {"error": "Location not found"}
    if owner_id is not None and location.owner_id != owner_id:
        return {"error": "Location not found"}
```

**`list_low_stock_items` (line ~231):**
```python
async def list_low_stock_items(db: AsyncSession, owner_id: int | None = None) -> dict:
    items = await item_repo.get_low_stock_items(owner_id=owner_id)
```

**`list_overdue_items` (line ~268):**
```python
async def list_overdue_items(db: AsyncSession, owner_id: int | None = None) -> dict:
    # Existing query filters items by expiry — add .where(Item.owner_id == owner_id) if set
```

**`get_dashboard_summary` (line ~312):**
```python
async def get_dashboard_summary(db: AsyncSession, owner_id: int | None = None) -> dict:
    # Pass owner_id to all repo calls: count, get_low_stock_items, get_transactions_count_since, count_active
```

**`perform_stock_in` (line ~358):**
```python
async def perform_stock_in(db: AsyncSession, actor_id: int, owner_id: int | None = None, **kwargs) -> dict:
    svc = InventoryService(db)
    event = await svc.stock_in(StockInRequest(**kwargs), actor_id, owner_id=owner_id)
```

**`perform_stock_out` (line ~388):**
```python
async def perform_stock_out(db: AsyncSession, actor_id: int, actor_roles: list[str], owner_id: int | None = None, **kwargs) -> dict:
    svc = InventoryService(db)
    event = await svc.stock_out(StockOutRequest(**kwargs), actor_id, actor_roles, owner_id=owner_id)
```

**`perform_transfer` (line ~419):**
```python
async def perform_transfer(db: AsyncSession, actor_id: int, owner_id: int | None = None, **kwargs) -> dict:
    svc = InventoryService(db)
    event = await svc.transfer(TransferRequest(**kwargs), actor_id, owner_id=owner_id)
```

**`list_locations` (line ~455):**
```python
async def list_locations(db: AsyncSession, location_type: str | None = None, owner_id: int | None = None) -> dict:
    areas = await loc_repo.get_all_with_locations(owner_id=owner_id)
```

**`get_transaction_history` (line ~486):**
```python
async def get_transaction_history(db: AsyncSession, owner_id: int | None = None, **kwargs) -> dict:
    events, _ = await event_repo.get_events_paginated(..., actor_id=owner_id)
```

**`list_categories` (line ~666):**
```python
async def list_categories(db: AsyncSession, owner_id: int | None = None) -> dict:
    cats = await cat_repo.get_all_filtered(owner_id=owner_id)
```

**`create_item` (line ~521):**
```python
async def create_item(db: AsyncSession, owner_id: int | None = None, **kwargs) -> dict:
    # After creating item, set item.owner_id = owner_id
    item = Item(..., owner_id=owner_id)
```

**`update_item` (line ~564):**
```python
async def update_item(db: AsyncSession, item_id: int, owner_id: int | None = None, **kwargs) -> dict:
    item = await item_repo.get_by_id(item_id)
    if not item:
        return {"error": "Item not found"}
    if owner_id is not None and item.owner_id != owner_id:
        return {"error": "Item not found"}
```

**`delete_item` (line ~625):**
```python
async def delete_item(db: AsyncSession, item_id: int, owner_id: int | None = None) -> dict:
    item = await item_repo.get_by_id(item_id)
    if owner_id is not None and item and item.owner_id != owner_id:
        return {"error": "Item not found"}
```

**`create_category` (line ~681):**
```python
async def create_category(db: AsyncSession, owner_id: int | None = None, **kwargs) -> dict:
    cat = Category(..., owner_id=owner_id)
```

**`update_category` (line ~713):**
```python
async def update_category(db: AsyncSession, category_id: int, owner_id: int | None = None, **kwargs) -> dict:
    cat = await cat_repo.get_by_id(category_id)
    if not cat:
        return {"error": "Category not found"}
    if owner_id is not None and cat.owner_id != owner_id:
        return {"error": "Category not found"}
    # ... apply updates from kwargs, flush, return updated fields
```

**`delete_category` (line ~755):**
```python
async def delete_category(db: AsyncSession, category_id: int, owner_id: int | None = None) -> dict:
    cat = await cat_repo.get_by_id(category_id)
    if not cat:
        return {"error": "Category not found"}
    if owner_id is not None and cat.owner_id != owner_id:
        return {"error": "Category not found"}
    # ... delete, return success
```

**`create_location` (line ~791):**
```python
async def create_location(db: AsyncSession, owner_id: int | None = None, **kwargs) -> dict:
    location = Location(..., owner_id=owner_id)
```

**`update_location` (line ~857):**
```python
async def update_location(db: AsyncSession, location_id: int, owner_id: int | None = None, **kwargs) -> dict:
    location = await loc_repo.get_with_area(location_id)
    if not location:
        return {"error": "Location not found"}
    if owner_id is not None and location.owner_id != owner_id:
        return {"error": "Location not found"}
    # ... apply updates, flush, return
```

**`delete_location` (line ~902):**
```python
async def delete_location(db: AsyncSession, location_id: int, owner_id: int | None = None) -> dict:
    location = await loc_repo.get_with_area(location_id)
    if not location:
        return {"error": "Location not found"}
    if owner_id is not None and location.owner_id != owner_id:
        return {"error": "Location not found"}
    # ... delete, return success
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/ai/copilot.py backend/app/ai/tools.py
git commit -m "feat(sandbox): copilot tools fully scoped — dispatch_tool + all 20 tool fns receive owner_id"
```

---

### Task 9: Frontend — Sandbox Copilot Quota UI

**Files:**
- Create: `frontend/src/api/sandbox.ts`
- Modify: `frontend/src/pages/AiCopilot.tsx`

- [ ] **Step 1: Create sandbox API module**

```typescript
// frontend/src/api/sandbox.ts
import { apiClient } from "./client";

export interface CopilotQuota {
  used: number;
  limit: number;
  remaining: number;
}

export const sandboxApi = {
  getCopilotQuota: async (): Promise<CopilotQuota> => {
    const res = await apiClient.get<CopilotQuota>("/sandbox/copilot-quota");
    return res.data;
  },
};
```

- [ ] **Step 2: Add sandbox imports to `AiCopilot.tsx`**

At the top of `frontend/src/pages/AiCopilot.tsx`, add:

```typescript
import { useSandboxStore } from "@/store/sandbox";
import { sandboxApi, type CopilotQuota } from "@/api/sandbox";
```

- [ ] **Step 3: Add quota hook inside the main component**

Inside the main `AiCopilot` component function (near the other `useQuery` calls), add:

```typescript
const { sandboxMode } = useSandboxStore();
const [optimisticSandboxUsed, setOptimisticSandboxUsed] = useState(0);

const { data: sandboxQuota, refetch: refetchQuota } = useQuery<CopilotQuota>({
  queryKey: ["sandbox-copilot-quota"],
  queryFn: sandboxApi.getCopilotQuota,
  enabled: sandboxMode,
  staleTime: 30_000,
});

const sandboxUsed = sandboxMode
  ? Math.max(optimisticSandboxUsed, sandboxQuota?.used ?? 0)
  : 0;
const sandboxLimit = sandboxQuota?.limit ?? 10;
const sandboxAtLimit = sandboxMode && sandboxUsed >= sandboxLimit;
```

- [ ] **Step 4: Update `sendMessage` to increment optimistic counter + refetch**

Inside `sendMessage`, after the optimistic messages are added and before the `streamMessage` call:

```typescript
if (sandboxMode) {
  setOptimisticSandboxUsed(prev => prev + 1);
}
```

After stream completes (in the `done` or `error` case), refetch:

```typescript
if (sandboxMode) {
  void refetchQuota();
}
```

- [ ] **Step 5: Add quota banner above input area**

Find the chat input area in the JSX (near where the `<textarea>` or send button is). Insert the banner before the input:

```tsx
{sandboxMode && (
  <div
    style={{
      padding: "6px 12px",
      borderRadius: 8,
      marginBottom: 6,
      fontSize: 12,
      fontWeight: 500,
      display: "flex",
      alignItems: "center",
      gap: 6,
      background: sandboxAtLimit
        ? "rgba(239,68,68,0.1)"
        : sandboxUsed >= sandboxLimit - 2
        ? "rgba(245,158,11,0.1)"
        : "rgba(139,92,246,0.08)",
      border: `1px solid ${
        sandboxAtLimit
          ? "rgba(239,68,68,0.3)"
          : sandboxUsed >= sandboxLimit - 2
          ? "rgba(245,158,11,0.3)"
          : "rgba(139,92,246,0.2)"
      }`,
      color: sandboxAtLimit
        ? "#ef4444"
        : sandboxUsed >= sandboxLimit - 2
        ? "#f59e0b"
        : "#8b5cf6",
    }}
  >
    <FlaskConical size={12} />
    {sandboxAtLimit
      ? `Sandbox copilot limit reached (${sandboxUsed}/${sandboxLimit}). Ask admin to reset.`
      : `Sandbox · ${sandboxUsed}/${sandboxLimit} messages${sandboxUsed >= sandboxLimit - 2 ? " — limit approaching" : ""}`}
  </div>
)}
```

- [ ] **Step 6: Disable input and send button when at limit**

Find the textarea/input element and add `disabled={sandboxAtLimit}`. Find the send button and add `disabled={sandboxAtLimit || ...existingDisabledCondition}`. Update the textarea placeholder:

```tsx
placeholder={sandboxAtLimit ? "Sandbox message limit reached" : "Ask about your inventory..."}
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/sandbox.ts frontend/src/pages/AiCopilot.tsx
git commit -m "feat(sandbox): copilot quota banner + disabled input at 10-message limit"
```

---

### Task 10: Run Migration + Smoke Test

- [ ] **Step 1: Run all backend tests**

```bash
cd backend && python -m pytest tests/ -v
```

Expected: all tests PASSED

- [ ] **Step 2: Start backend and verify endpoints exist**

```bash
cd backend && uvicorn app.main:app --reload --port 8000
```

Then in another terminal:

```bash
curl -s http://localhost:8000/api/v1/sandbox/copilot-quota \
  -H "Authorization: Bearer <your_token>" | python -m json.tool
```

Expected:
```json
{"used": 0, "limit": 10, "remaining": 10}
```

- [ ] **Step 3: Test sandbox quota increment**

Send a message to the copilot with `X-Sandbox-Mode: true` header, then call `/sandbox/copilot-quota` again. Expected `used` increases by 1.

- [ ] **Step 4: Test ownership isolation**

Toggle sandbox mode on, create an item via copilot. Toggle off. Verify the item does NOT appear in the normal inventory list (it should have `owner_id` set). Toggle back on — item should appear.

- [ ] **Step 5: Run frontend dev server**

```bash
cd frontend && npm run dev
```

Open browser, log in, toggle sandbox mode, open AI Copilot. Verify:
- Purple banner shows `"Sandbox · 0/10 messages"`
- After sending a message, counter increments to `1/10`
- At 8/10, banner turns yellow
- At 10/10, banner turns red, input is disabled with correct placeholder

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "feat(sandbox): complete sandbox mode — all features scoped, copilot quota enforced"
```
