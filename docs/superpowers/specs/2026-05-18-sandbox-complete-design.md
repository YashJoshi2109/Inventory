# Sandbox Mode — Complete Implementation Design

**Date:** 2026-05-18  
**Status:** Approved  
**Scope:** Persistent AI Copilot quota, full owner_id scoping through copilot tools, frontend limit UI

---

## Context

The SEAR Lab Inventory System needs a sandbox mode for public exhibitions. Visitors interact with all features — inventory, transactions, AI Copilot, energy hub — but every mutation hits sandbox data (owner_id-scoped rows), leaving the real lab DB untouched.

**Already built:**
- `owner_id` columns on `items`, `categories`, `locations`, `areas`, `energy_readings`
- `sandbox_seeded` flag on `users`; seed service creates 30 items + 30 days energy data
- `X-Sandbox-Mode: true` header auto-injected by `apiClient` when sandbox toggle is on
- REST endpoints for items/locations/energy filter by `owner_id` when header present
- Toggle UI in `Sidebar.tsx`; `/sandbox/seed|status|reset` endpoints

**Gaps this spec closes:**
1. AI Copilot tools (`dispatch_tool`) do not receive `owner_id` → writes hit real DB in sandbox mode
2. No copilot message limit for sandbox users
3. No frontend quota UI

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

### 2. Backend — Quota Enforcement

**`POST /chat/sessions/{id}/messages`** changes:

1. Detect sandbox: `is_sandbox = request.headers.get("X-Sandbox-Mode", "").lower() == "true"`
2. **Pre-check** before persisting user message:
   ```python
   if is_sandbox and current_user.sandbox_copilot_msgs_used >= settings.SANDBOX_COPILOT_LIMIT:
       raise HTTPException(429, {"code": "SANDBOX_COPILOT_LIMIT", "used": used, "limit": 10})
   ```
3. **Increment** in same transaction as user message commit:
   ```python
   if is_sandbox:
       current_user.sandbox_copilot_msgs_used += 1
   ```

**`GET /sandbox/copilot-quota`** — new endpoint, returns:
```json
{"used": 3, "limit": 10, "remaining": 7}
```
Returns `{used: 0, limit: 10, remaining: 10}` when `SANDBOX_MODE=false` (safe no-op).

**`POST /sandbox/reset`** — already wipes sandbox data; add:
```python
target_user.sandbox_copilot_msgs_used = 0
```

### 3. Backend — Copilot Tool Scoping

All 13 tool functions in `tools.py` that mutate or read DB currently take `db: AsyncSession`. Add `owner_id: int | None = None` to each.

Call chain:
```
send_message
  └─ run_copilot(sandbox_owner_id=int|None)        # copilot.py
       └─ dispatch_tool(sandbox_owner_id=int|None)  # tools.py
            └─ search_inventory(owner_id=...)
            └─ create_item(owner_id=...)
            └─ perform_stock_in(owner_id=...)
            └─ ... (all 13 tool functions)
```

`send_message` derives `sandbox_owner_id`:
```python
sandbox_owner_id = current_user.id if is_sandbox else None
```

Each tool function passes `owner_id` to the relevant repository method (repos already support `owner_id` filtering — no repo changes needed).

**Affected tool functions:**
| Function | Change |
|---|---|
| `search_inventory` | pass `owner_id` to `item_repo.search` |
| `get_item_details` | pass `owner_id` to `item_repo.get_by_id` (guard: reject if item.owner_id doesn't match) |
| `get_location_contents` | pass `owner_id` to location repo |
| `list_low_stock_items` | pass `owner_id` to stock repo |
| `list_overdue_items` | pass `owner_id` filter |
| `get_dashboard_summary` | pass `owner_id` to all sub-queries |
| `perform_stock_in` | set `actor_id=owner_id` when scoped |
| `perform_stock_out` | same |
| `perform_transfer` | same |
| `list_locations` | pass `owner_id` |
| `create_item` | set `item.owner_id = owner_id` |
| `update_item` | guard: verify `item.owner_id == owner_id` before mutating |
| `delete_item` | guard: verify `item.owner_id == owner_id` before deleting |
| `create_category` | set `category.owner_id = owner_id` |
| `create_location` | set `location.owner_id = owner_id` |
| `update_location` | guard: verify `location.owner_id == owner_id` |
| `delete_location` | guard: verify `location.owner_id == owner_id` |
| `list_categories` | pass `owner_id` to `get_all_filtered` |
| `update_category` | guard: verify `category.owner_id == owner_id` |
| `delete_category` | guard: verify `category.owner_id == owner_id` |
| `get_transaction_history` | filter events by `actor_id == owner_id` when scoped |

### 4. Frontend — Quota UI

**`AiCopilot.tsx`** changes:

- `useSandboxCopilotQuota()` hook: fetches `GET /sandbox/copilot-quota` when `sandboxMode=true`, returns `{used, limit, remaining}`. Refetches on session change.
- Optimistic counter: increments locally on each send, syncs with server on next fetch.
- Quota banner rendered above chat input (only when `sandboxMode=true`):
  - `used < 8`: subtle info bar, `"Sandbox · X/10 messages"`
  - `used >= 8 && used < 10`: yellow warning, `"Sandbox · X/10 messages — limit approaching"`
  - `used >= 10`: red banner, `"Sandbox copilot limit reached (10/10). Ask admin to reset."`
- Chat input `disabled` when `used >= 10`; placeholder text: `"Sandbox message limit reached"`

---

## Data Flow (Sandbox Copilot Message)

```
User types message → frontend checks quota (optimistic) 
  → POST /chat/sessions/{id}/messages + X-Sandbox-Mode: true
  → backend pre-check: sandbox_copilot_msgs_used < 10?
    → NO  → 429 SANDBOX_COPILOT_LIMIT
    → YES → persist user message
           → increment sandbox_copilot_msgs_used
           → commit
           → run_copilot(sandbox_owner_id=user.id)
                → dispatch_tool passes owner_id to every repo call
                → all reads/writes scoped to sandbox rows only
           → stream SSE response
           → frontend banner updates to X+1/10
```

---

## Error Handling

| Scenario | Response |
|---|---|
| Sandbox copilot limit hit | HTTP 429, `code: SANDBOX_COPILOT_LIMIT` |
| Tool tries to access item not owned by sandbox user | tool returns `"Item not found"` (guard check, no 500) |
| Non-sandbox mode | `owner_id=None` everywhere → existing behavior unchanged |
| Admin resets user | `sandbox_copilot_msgs_used=0` + data wiped, user can start fresh |

---

## Out of Scope

- Separate sandbox chat session list (sessions remain shared)
- Sandbox vision scan limit (separate concern)
- Multi-user sandbox concurrency (each user's sandbox is already isolated by `owner_id`)
- RN app (separate spec)
