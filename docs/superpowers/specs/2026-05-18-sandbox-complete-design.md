# Sandbox Mode — Complete Implementation Design

**Date:** 2026-05-18
**Status:** Approved
**Scope:** All features sandbox-aware — scan, RFID, dashboard, transactions, imports, AI, barcodes, copilot quota + owner_id scoping

---

## Context

The SEAR Lab Inventory System needs a sandbox mode for public exhibitions. Visitors interact with ALL features — inventory, transactions, scan, RFID, AI Copilot, energy hub, bulk import — but every mutation hits sandbox data (owner_id-scoped rows), leaving the real lab DB untouched.

**Already built:**

- `owner_id` columns on `items`, `categories`, `locations`, `areas`, `energy_readings`
- `sandbox_seeded` flag on `users`; seed service creates 30 items + 30 days energy data
- `X-Sandbox-Mode: true` header auto-injected by `apiClient` when sandbox toggle is on
- REST endpoints for items/locations/energy filter by `owner_id` when header present
- Toggle UI in `Sidebar.tsx`; `/sandbox/seed|status|reset` endpoints

**Gaps this spec closes:**

1. AI Copilot tools (`dispatch_tool`) have no `owner_id` → writes hit real DB
2. No copilot message limit for sandbox users
3. Scan + RFID endpoints use `InventoryService`/`ScanService` with no owner scoping
4. Dashboard stats unscoped — shows real lab totals in sandbox mode
5. Transactions + alerts unscoped — sandbox users see real lab history
6. Bulk import creates items/categories without `owner_id`
7. AI search + forecast unscoped
8. Barcode label generation has no ownership guard
9. No frontend quota UI for copilot

---

## Architecture

### 1. Database

**Migration `010_sandbox_copilot_quota`:**

```sql
ALTER TABLE users
  ADD COLUMN sandbox_copilot_msgs_used INTEGER NOT NULL DEFAULT 0;
```

- Increments +1 per sandbox copilot message sent
- Never auto-resets; resets only when admin calls `POST /sandbox/reset`
- `SANDBOX_COPILOT_LIMIT = 10` constant in `app/core/config.py`

---

### 2. Service Layer — owner_id Threading

All three services that currently lack owner_id scoping get a new optional param:

**`InventoryService`** (`services/inventory_service.py`):

```python
async def stock_in(self, body, actor_id, owner_id=None): ...
async def stock_out(self, body, actor_id, roles, owner_id=None): ...
async def transfer(self, body, actor_id, owner_id=None): ...
async def adjustment(self, body, actor_id, owner_id=None): ...
async def apply_barcode_scan(self, body, actor_id, roles, owner_id=None): ...
```

When `owner_id` is set: verify that `item.owner_id == owner_id` before any write. Return 404 if mismatch (sandbox user cannot touch real items).

**`ScanService`** (`services/scan_service.py`):

```python
async def resolve(self, barcode_value, owner_id=None): ...
```

When `owner_id` is set: filter item lookup by `Item.owner_id == owner_id`. Returns `result_type="not_found"` for real items (sandbox users can only scan sandbox items).

**`ImportService`** (`services/import_service.py`):

```python
async def import_excel(self, content, filename, actor_id, owner_id=None): ...
```

When `owner_id` is set: set `item.owner_id = owner_id` and `category.owner_id = owner_id` on every created row.

---

### 3. Endpoint Changes — Scan

**`backend/app/api/v1/scans.py`** — all endpoints gain `Request` param:

```python
from app.core.sandbox import sandbox_owner_id

@router.post("/lookup")
async def lookup_barcode(body, request: Request, session, current_user):
    owner_id = sandbox_owner_id(request, current_user)
    svc = ScanService(session)
    result = await svc.resolve(body.barcode_value, owner_id=owner_id)
    ...
```

Same pattern for `/stock-in`, `/stock-out`, `/transfer`, `/adjustment`, `/apply`, `/smart-apply`, `/modify-item`.

---

### 4. Endpoint Changes — RFID

**`backend/app/api/v1/rfid.py`**:

- `_resolve_epc(epc, session, owner_id=None)` — passes `owner_id` to `ScanService.resolve`
- All endpoints that call `_resolve_epc` or `InventoryService` get `Request` param + derive `owner_id`
- `register_epc` — guard: item must have matching `owner_id` before registering EPC

---

### 5. Endpoint Changes — Dashboard

**`backend/app/api/v1/dashboard.py`** — `get_dashboard_stats` gains `Request` param:

When `owner_id` is set, all sub-queries add `WHERE items.owner_id = :owner_id`:

- `item_repo.count(owner_id=owner_id)`
- `item_repo.get_low_stock_items(owner_id=owner_id)`
- `total_value` query: add `.where(Item.owner_id == owner_id)`
- `event_repo.get_transactions_count_since(since, actor_id=owner_id)` (new param)
- `alert_repo.count_active(owner_id=owner_id)` (new param — filter by items owned)
- `cat_repo.get_all_with_counts(owner_id=owner_id)`

---

### 6. Endpoint Changes — Transactions + Alerts

**`backend/app/api/v1/transactions.py`**:

```python
@router.get("/")
async def list_transactions(request: Request, ...):
    owner_id = sandbox_owner_id(request, current_user)
    events, total = await repo.get_events_paginated(
        ..., actor_id=owner_id  # new param — filters by actor when set
    )
```

`list_alerts`: add `owner_id` join filter — only return alerts for items owned by sandbox user.

`resolve_alert`: guard — fetch alert's item, verify `item.owner_id == owner_id` before resolving.

---

### 7. Endpoint Changes — Bulk Import

**`backend/app/api/v1/imports.py`** — `import_excel` and `import_csv` gain `Request` param:

```python
owner_id = sandbox_owner_id(request, current_user)
job = await svc.import_excel(content, filename, current_user.id, owner_id=owner_id)
```

`ImportService` sets `owner_id` on all created `Item` and `Category` rows when param is provided.

---

### 8. Endpoint Changes — AI Search + Forecast

**`backend/app/api/v1/ai.py`**:

`nlp_search`:

- Derive `owner_id = sandbox_owner_id(request, current_user)`
- DB ILIKE fallback: add `.where(Item.owner_id == owner_id)` when set
- TF-IDF hits: after fetching enriched items, filter out items where `item.owner_id != owner_id`

`demand_forecast`:

- After fetching item by ID, guard: if `owner_id` set and `item.owner_id != owner_id` → 404

---

### 9. Endpoint Changes — Barcodes

**`backend/app/api/v1/barcodes.py`** — read-only ownership guard:

All endpoints that fetch item/location by ID get `Request` param. After fetching, verify ownership:

```python
owner_id = sandbox_owner_id(request, current_user)
if owner_id and item.owner_id != owner_id:
    raise HTTPException(404, "Item not found")
```

This prevents sandbox users from printing labels for real items, and real users from accidentally seeing sandbox items' labels.

---

### 10. Backend — Copilot Quota Enforcement

**`POST /chat/sessions/{id}/messages`** changes:

1. Detect sandbox: `is_sandbox = request.headers.get("X-Sandbox-Mode", "").lower() == "true"`
2. Pre-check before persisting user message:

```python
if is_sandbox and current_user.sandbox_copilot_msgs_used >= settings.SANDBOX_COPILOT_LIMIT:
    raise HTTPException(429, {"code": "SANDBOX_COPILOT_LIMIT", "used": used, "limit": 10})
```

3. Increment in same transaction as user message commit:

```python
if is_sandbox:
    current_user.sandbox_copilot_msgs_used += 1
```

**`GET /sandbox/copilot-quota`** — new endpoint:

```json
{"used": 3, "limit": 10, "remaining": 7}
```

**`POST /sandbox/reset`** — add:

```python
target_user.sandbox_copilot_msgs_used = 0
```

---

### 11. Backend — Copilot Tool Scoping

`run_copilot(... sandbox_owner_id=int|None)` → `dispatch_tool(sandbox_owner_id=int|None)` → all tool functions.

`send_message` derives:

```python
sandbox_owner_id = current_user.id if is_sandbox else None
```

**Affected tool functions in `tools.py`:**

| Function | Change |
|---|---|
| `search_inventory` | pass `owner_id` to `item_repo.search` |
| `get_item_details` | guard: reject if `item.owner_id != owner_id` |
| `get_location_contents` | pass `owner_id` to location repo |
| `list_low_stock_items` | pass `owner_id` filter |
| `list_overdue_items` | pass `owner_id` filter |
| `get_dashboard_summary` | pass `owner_id` to all sub-queries |
| `perform_stock_in` | set `owner_id`; verify item ownership before write |
| `perform_stock_out` | same |
| `perform_transfer` | same |
| `list_locations` | pass `owner_id` |
| `create_item` | set `item.owner_id = owner_id` |
| `update_item` | guard: verify `item.owner_id == owner_id` |
| `delete_item` | guard: verify `item.owner_id == owner_id` |
| `create_category` | set `category.owner_id = owner_id` |
| `update_category` | guard: verify ownership |
| `delete_category` | guard: verify ownership |
| `create_location` | set `location.owner_id = owner_id` |
| `update_location` | guard: verify ownership |
| `delete_location` | guard: verify ownership |
| `list_categories` | pass `owner_id` to `get_all_filtered` |
| `get_transaction_history` | filter events by `actor_id == owner_id` |

---

### 12. Frontend — Quota UI

**`AiCopilot.tsx`** changes:

- `useSandboxCopilotQuota()` hook: fetches `GET /sandbox/copilot-quota` when `sandboxMode=true`
- Optimistic counter: increments locally on each send
- Quota banner above chat input (sandbox mode only):
  - `used < 8`: subtle info, `"Sandbox · X/10 messages"`
  - `used >= 8 && used < 10`: yellow warning, `"limit approaching"`
  - `used >= 10`: red banner, `"Sandbox copilot limit reached (10/10). Ask admin to reset."`
- Input `disabled` + placeholder `"Sandbox message limit reached"` when `used >= 10`

---

## Data Flow (Sandbox Any Write)

```
User action (scan / import / copilot / manual CRUD)
  → frontend sends X-Sandbox-Mode: true
  → endpoint derives owner_id = current_user.id
  → passes owner_id to service
  → service verifies item.owner_id == owner_id (guard)
  → repo filters/writes with owner_id
  → sandbox rows only affected; real rows untouched
```

---

## Error Handling

| Scenario | Response |
|---|---|
| Sandbox copilot limit hit | HTTP 429, `code: SANDBOX_COPILOT_LIMIT` |
| Sandbox user accesses real item/location | 404 "not found" (ownership guard) |
| Non-sandbox mode | `owner_id=None` everywhere → behavior unchanged |
| Admin resets user | `sandbox_copilot_msgs_used=0` + data wiped |
| Import in sandbox | All created rows tagged with `owner_id`; isolated from real inventory |

---

## Out of Scope

- Separate sandbox chat session list (sessions remain shared)
- Per-user sandbox vision scan limit (separate concern)
- RN app (separate spec)
