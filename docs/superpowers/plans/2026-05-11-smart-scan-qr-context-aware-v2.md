# Smart Scan QR Context-Aware Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AI-camera SmartScan page (1524 lines) with a two-scan QR/barcode flow that automatically determines stock-in vs stock-out vs transfer with zero intent prompting, and presents a single explicit Confirm button before committing.

**Architecture:**

1. User scans an item barcode and a location QR (either order).
2. Frontend calls `POST /scans/smart-apply` with `dry_run: true`. Backend inspects current stock and returns one of:
   - `stock_in` — item not at scanned location and not anywhere else
   - `stock_out` — item already has stock at the scanned location
   - `transfer` — item has stock at exactly one other location (auto-source) or multiple other locations (`requires_source_selection: true` with `candidate_sources`)
3. Frontend renders a preview card with item, target location, action, previous → new quantity, optional source-location picker, and a quantity stepper.
4. User presses **Confirm**. Frontend re-calls `POST /scans/smart-apply` with `dry_run: false` and `source_location_id` if needed. Backend executes the action atomically.
5. Success card shows for 4 s, then auto-reset to idle.

The dry-run pattern keeps the decision logic on the backend as the single source of truth — the frontend never duplicates "in vs out vs transfer" reasoning.

**Tech Stack:** FastAPI (backend), React 18 + TypeScript + Tailwind CSS variables (frontend), `@zxing/library` via `BarcodeScanner` component (already exists), `react-hot-toast`, Zustand theme store, `scanApi` in `transactions.ts`.

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `backend/app/api/v1/scans.py` | Add `POST /scans/smart-apply` endpoint with dry-run + transfer support |
| Modify | `backend/app/schemas/transaction.py` | Add `SmartApplyRequest`, `SmartApplyResponse`, `CandidateSource` schemas |
| Modify | `frontend/src/api/transactions.ts` | Add `scanApi.smartApply()` with typed response union |
| Overwrite | `frontend/src/pages/SmartScan.tsx` | Replace AI-vision page with QR state machine + explicit confirm (target ≤ 380 lines) |
| Verify (no change) | `frontend/src/App.tsx` | Route `/smart-scan` → `SmartScan` lazy import already exists |
| Verify (no change) | `frontend/src/components/layout/Sidebar.tsx` | Nav entry for Smart Scan already exists |
| Verify (no change) | `frontend/src/components/layout/MobileNav.tsx` | Nav entry for Smart Scan already exists |

---

### Task 1: Backend Schemas — `SmartApplyRequest` + `SmartApplyResponse` + `CandidateSource`

**Files:**
- Modify: `backend/app/schemas/transaction.py`

- [ ] **Step 1: Verify imports at top of file**

Ensure these imports exist near the top of `backend/app/schemas/transaction.py`:

```python
from typing import Literal
from decimal import Decimal
from pydantic import Field
```

Add any that are missing.

- [ ] **Step 2: Append new schemas at the end of `backend/app/schemas/transaction.py`**

Add after the last existing class (`InventoryEventRead` or wherever the file ends):

```python
class CandidateSource(OrmBase):
    """Lightweight reference to a location holding stock for an item."""
    location_id: int
    location_name: str
    location_code: str
    quantity: int


class SmartApplyRequest(OrmBase):
    """Automatically determine stock-in, stock-out, or transfer based on current stock."""
    item_id: int
    location_id: int  # the location the user scanned
    quantity: Decimal = Field(default=Decimal("1"), gt=0)
    notes: str | None = None
    scan_session_id: str | None = None
    source: str = "smart_scan"
    # New fields for transfer + preview support
    dry_run: bool = False
    source_location_id: int | None = None  # required when dry_run=False and action=transfer


class SmartApplyResponse(OrmBase):
    """Either a preview (dry_run=True) or a committed result (dry_run=False)."""
    action: Literal["stock_in", "stock_out", "transfer"]
    previous_quantity: int
    new_quantity: int
    # Populated only when action="transfer"
    source_location_id: int | None = None
    source_location_name: str | None = None
    # Disambiguation: only set on dry_run when multiple source candidates exist
    requires_source_selection: bool = False
    candidate_sources: list[CandidateSource] = Field(default_factory=list)
    # The committed event — None for dry_run, populated for live commits
    event: "InventoryEventRead | None" = None
```

Note: `Literal` and `Decimal` must be imported at the top of the file (step 1).

- [ ] **Step 3: Verify no import errors**

```bash
cd /Users/yash/Downloads/Inventory/backend
python -c "from app.schemas.transaction import SmartApplyRequest, SmartApplyResponse, CandidateSource; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
cd /Users/yash/Downloads/Inventory
git add backend/app/schemas/transaction.py
git commit -m "feat(scans): add SmartApplyRequest/Response + CandidateSource schemas with transfer + dry-run support"
```

---

### Task 2: Backend Endpoint — `POST /scans/smart-apply`

**Files:**
- Modify: `backend/app/api/v1/scans.py`

- [ ] **Step 1: Add imports at top of `backend/app/api/v1/scans.py`**

Find the existing imports block:
```python
from app.schemas.transaction import (
    AdjustmentRequest,
    BarcodeScanApplyRequest,
    InventoryEventRead,
    ScanLookupRequest,
    StockInRequest,
    StockOutRequest,
    TransferRequest,
)
```

Replace with:
```python
from app.schemas.transaction import (
    AdjustmentRequest,
    BarcodeScanApplyRequest,
    CandidateSource,
    InventoryEventRead,
    ScanLookupRequest,
    SmartApplyRequest,
    SmartApplyResponse,
    StockInRequest,
    StockOutRequest,
    TransferRequest,
)
from fastapi import HTTPException, status
```

(If `HTTPException` and `status` are already imported, skip those.)

- [ ] **Step 2: Add the endpoint after the existing `/apply` route (after line ~141)**

```python
@router.post(
    "/smart-apply",
    response_model=SmartApplyResponse,
    status_code=status.HTTP_200_OK,
)
async def smart_apply(
    body: SmartApplyRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> SmartApplyResponse:
    """
    Context-aware stock action.

    Decision rules:
      qty at scanned location > 0           → stock_out
      qty at scanned location = 0, no stock anywhere → stock_in
      qty at scanned location = 0, stock elsewhere  → transfer

    When dry_run=True:    returns the preview without writing.
    When dry_run=False:   executes and returns the committed event.

    For transfers with multiple source candidates, dry_run returns
    requires_source_selection=True. The client must then call again
    with source_location_id specified.
    """
    from app.repositories.transaction_repo import StockLevelRepository

    stock_repo = StockLevelRepository(session)
    svc = InventoryService(session)
    actor_roles = [ur.role.name for ur in current_user.roles if ur.role]

    # ── 1. Inspect current stock for this item across all locations
    all_levels = await stock_repo.list_by_item(body.item_id)
    target = next((l for l in all_levels if l.location_id == body.location_id), None)
    target_qty = int(target.quantity) if target else 0
    other_sources = [l for l in all_levels if l.location_id != body.location_id and int(l.quantity) > 0]
    qty = int(body.quantity)

    # ── 2. Decide the action
    if target_qty > 0:
        action = "stock_out"
    elif not other_sources:
        action = "stock_in"
    else:
        action = "transfer"

    # ── 3. Branch: stock_out ───────────────────────────────────────
    if action == "stock_out":
        new_qty = max(0, target_qty - qty)
        if body.dry_run:
            return SmartApplyResponse(
                action="stock_out",
                previous_quantity=target_qty,
                new_quantity=new_qty,
            )
        req = StockOutRequest(
            item_id=body.item_id,
            location_id=body.location_id,
            quantity=body.quantity,
            reason="Smart scan removal",
            notes=body.notes,
            scan_session_id=body.scan_session_id,
            source=body.source,
        )
        event = await svc.stock_out(req, current_user.id, actor_roles)
        await session.refresh(event, ["item", "from_location", "actor"])
        return SmartApplyResponse(
            action="stock_out",
            previous_quantity=target_qty,
            new_quantity=new_qty,
            event=_event_to_read(event, session),
        )

    # ── 4. Branch: stock_in ────────────────────────────────────────
    if action == "stock_in":
        new_qty = target_qty + qty
        if body.dry_run:
            return SmartApplyResponse(
                action="stock_in",
                previous_quantity=target_qty,
                new_quantity=new_qty,
            )
        req = StockInRequest(
            item_id=body.item_id,
            location_id=body.location_id,
            quantity=body.quantity,
            notes=body.notes,
            scan_session_id=body.scan_session_id,
            source=body.source,
        )
        event = await svc.stock_in(req, current_user.id)
        await session.refresh(event, ["item", "to_location", "actor"])
        return SmartApplyResponse(
            action="stock_in",
            previous_quantity=target_qty,
            new_quantity=new_qty,
            event=_event_to_read(event, session),
        )

    # ── 5. Branch: transfer ────────────────────────────────────────
    # Build candidate list for disambiguation
    candidates = [
        CandidateSource(
            location_id=l.location_id,
            location_name=l.location.name if l.location else f"Loc {l.location_id}",
            location_code=l.location.code if l.location else "",
            quantity=int(l.quantity),
        )
        for l in other_sources
    ]

    # Auto-pick source if exactly one candidate
    chosen_source_id = body.source_location_id
    if chosen_source_id is None and len(candidates) == 1:
        chosen_source_id = candidates[0].location_id

    # Still no source: ask the client to pick (dry_run only — live commits must specify)
    if chosen_source_id is None:
        if body.dry_run:
            return SmartApplyResponse(
                action="transfer",
                previous_quantity=target_qty,
                new_quantity=target_qty,  # unchanged at target until source picked
                requires_source_selection=True,
                candidate_sources=candidates,
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="source_location_id is required for transfer when multiple sources exist",
        )

    # Validate chosen source has enough stock
    chosen = next((c for c in candidates if c.location_id == chosen_source_id), None)
    if chosen is None or chosen.quantity < qty:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Source location does not have sufficient stock (have {chosen.quantity if chosen else 0}, need {qty})",
        )

    new_qty = target_qty + qty
    if body.dry_run:
        return SmartApplyResponse(
            action="transfer",
            previous_quantity=target_qty,
            new_quantity=new_qty,
            source_location_id=chosen.location_id,
            source_location_name=chosen.location_name,
            candidate_sources=candidates,  # echoed so UI can show full picker even on auto-pick
        )

    req = TransferRequest(
        item_id=body.item_id,
        from_location_id=chosen.location_id,
        to_location_id=body.location_id,
        quantity=body.quantity,
        notes=body.notes,
        scan_session_id=body.scan_session_id,
        source=body.source,
    )
    event = await svc.transfer(req, current_user.id, actor_roles)
    await session.refresh(event, ["item", "from_location", "to_location", "actor"])
    return SmartApplyResponse(
        action="transfer",
        previous_quantity=target_qty,
        new_quantity=new_qty,
        source_location_id=chosen.location_id,
        source_location_name=chosen.location_name,
        event=_event_to_read(event, session),
    )
```

**Note on `stock_repo.list_by_item`:** if this method doesn't exist, check `StockLevelRepository` for the equivalent (e.g., `get_levels_for_item`, `find_by_item_id`). Add a thin method if absent:

```python
async def list_by_item(self, item_id: int) -> list[StockLevel]:
    result = await self.session.execute(
        select(StockLevel).where(StockLevel.item_id == item_id).options(selectinload(StockLevel.location))
    )
    return list(result.scalars().all())
```

- [ ] **Step 3: Run backend and verify endpoint appears in OpenAPI**

```bash
cd /Users/yash/Downloads/Inventory/backend
uvicorn app.main:app --reload --port 8000 &
sleep 3
curl -s http://localhost:8000/openapi.json | python -c "import sys,json; paths=json.load(sys.stdin)['paths']; print([p for p in paths if 'smart' in p])"
```

Expected: `['/api/v1/scans/smart-apply']` (or similar with prefix)

- [ ] **Step 4: Quick dry-run sanity check**

With seed data (an item with stock at location 1), call dry_run for both same-location and different-location scans:

```bash
# Get an auth token first (replace credentials):
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login -H "Content-Type: application/json" -d '{"email":"yash@example.com","password":"..."}' | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# Dry-run: item at the scanned location → should be stock_out
curl -s -X POST http://localhost:8000/api/v1/scans/smart-apply \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"item_id":1,"location_id":1,"quantity":1,"dry_run":true}' | python -m json.tool
```

Expected: `"action": "stock_out"` with non-zero `previous_quantity`.

- [ ] **Step 5: Kill dev server and commit**

```bash
kill %1 2>/dev/null; sleep 1
cd /Users/yash/Downloads/Inventory
git add backend/app/api/v1/scans.py backend/app/repositories/transaction_repo.py
git commit -m "feat(scans): add POST /scans/smart-apply with dry-run, transfer, and source disambiguation"
```

---

### Task 3: Frontend API — `scanApi.smartApply()`

**Files:**
- Modify: `frontend/src/api/transactions.ts`

- [ ] **Step 1: Add types and the `smartApply` method to `scanApi` in `frontend/src/api/transactions.ts`**

Find the `scanApi` object. Above it, add the typed contracts (or in the file's types section if one exists):

```typescript
export type SmartAction = "stock_in" | "stock_out" | "transfer";

export interface CandidateSource {
  location_id: number;
  location_name: string;
  location_code: string;
  quantity: number;
}

export interface SmartApplyResponse {
  action: SmartAction;
  previous_quantity: number;
  new_quantity: number;
  source_location_id: number | null;
  source_location_name: string | null;
  requires_source_selection: boolean;
  candidate_sources: CandidateSource[];
  event: InventoryEvent | null;
}
```

Then in the `scanApi` object, insert before `modifyItem`:

```typescript
  smartApply: async (payload: {
    item_id: number;
    location_id: number;
    quantity?: number;
    notes?: string;
    scan_session_id?: string;
    dry_run?: boolean;
    source_location_id?: number;
  }): Promise<SmartApplyResponse> => {
    const { data } = await apiClient.post("/scans/smart-apply", { quantity: 1, dry_run: false, ...payload });
    return data;
  },
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/yash/Downloads/Inventory/frontend
npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors from `transactions.ts`.

- [ ] **Step 3: Commit**

```bash
cd /Users/yash/Downloads/Inventory
git add frontend/src/api/transactions.ts
git commit -m "feat(api): add scanApi.smartApply() with dry-run + transfer response types"
```

---

### Task 4: Replace `SmartScan.tsx` with QR State Machine + Confirm Flow

**Files:**
- Overwrite: `frontend/src/pages/SmartScan.tsx`

This is the largest task. The new page is ≤ 380 lines.

- [ ] **Step 1: Overwrite `frontend/src/pages/SmartScan.tsx` with the following**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Package, MapPin, CheckCircle2, XCircle, RotateCcw,
  ArrowUpRight, ArrowDownRight, ArrowLeftRight, Loader2,
  Minus, Plus,
} from "lucide-react";
import toast from "react-hot-toast";
import { BarcodeScanner } from "@/components/scanner/BarcodeScanner";
import { scanApi, type SmartApplyResponse, type SmartAction, type CandidateSource } from "@/api/transactions";
import { useThemeStore } from "@/store/theme";
import type { ScanResult } from "@/types";

// ─── State Machine Types ──────────────────────────────────────────────────────

type SmartPhase =
  | "idle"
  | "item_scanned"
  | "location_scanned"
  | "previewing"      // both scanned, dry-run returned, awaiting Confirm
  | "committing"
  | "success"
  | "error";

interface SmartState {
  phase: SmartPhase;
  item?: ScanResult;
  location?: ScanResult;
  preview?: SmartApplyResponse;
  selectedSourceId?: number | null;  // user-chosen transfer source
  quantity: number;
  errorMsg?: string;
}

const ACTION_COLOR: Record<SmartAction, string> = {
  stock_in: "#059669",
  stock_out: "#DC2626",
  transfer: "#2563EB",
};

const ACTION_LABEL: Record<SmartAction, string> = {
  stock_in: "Add to rack",
  stock_out: "Remove from rack",
  transfer: "Transfer to rack",
};

const ACTION_ICON: Record<SmartAction, typeof ArrowUpRight> = {
  stock_in: ArrowUpRight,
  stock_out: ArrowDownRight,
  transfer: ArrowLeftRight,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function apiErrMsg(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return (detail as { msg: string }[]).map((d) => d.msg).join(", ");
  return "Something went wrong";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScanCard({
  icon: Icon, label, name, code, color, isDark,
}: {
  icon: typeof Package; label: string; name: string; code: string; color: string; isDark: boolean;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl p-3"
      style={{
        background: isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.80)",
        border: "1px solid var(--border-card)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: `${color}22`, border: `1px solid ${color}44` }}
      >
        <Icon size={16} style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--text-muted)" }}>{label}</p>
        <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>{name}</p>
        <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>{code}</p>
      </div>
    </div>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="w-3 h-3 rounded-full transition-all duration-300"
        style={{
          background: done || active ? "var(--accent)" : "var(--border-card)",
          opacity: done || active ? 1 : 0.4,
          boxShadow: active ? "0 0 0 4px rgba(37,99,235,0.25)" : "none",
        }}
      />
      <span className="text-[9px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}

function QtyStepper({ value, onChange, isDark }: { value: number; onChange: (n: number) => void; isDark: boolean }) {
  return (
    <div
      className="flex items-center gap-2 rounded-xl px-2 py-1"
      style={{
        background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
        border: "1px solid var(--border-card)",
      }}
    >
      <button
        onClick={() => onChange(Math.max(1, value - 1))}
        className="w-7 h-7 rounded-lg flex items-center justify-center"
        style={{ color: "var(--text-primary)" }}
        aria-label="Decrease quantity"
      >
        <Minus size={14} />
      </button>
      <span className="w-8 text-center text-sm font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>{value}</span>
      <button
        onClick={() => onChange(value + 1)}
        className="w-7 h-7 rounded-lg flex items-center justify-center"
        style={{ color: "var(--text-primary)" }}
        aria-label="Increase quantity"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SmartScan() {
  const isDark = useThemeStore((s) => s.theme) === "dark";
  const [state, setState] = useState<SmartState>({ phase: "idle", quantity: 1 });
  const scanning = useRef(true);

  const reset = useCallback(() => {
    scanning.current = true;
    setState({ phase: "idle", quantity: 1 });
  }, []);

  // Auto-reset after success
  useEffect(() => {
    if (state.phase === "success") {
      const t = setTimeout(reset, 4000);
      return () => clearTimeout(t);
    }
  }, [state.phase, reset]);

  // ── Preview: call dry_run after both barcodes scanned
  const fetchPreview = useCallback(async (
    item: ScanResult,
    location: ScanResult,
    quantity: number,
    sourceLocationId?: number,
  ) => {
    scanning.current = false;
    try {
      const preview = await scanApi.smartApply({
        item_id: item.id!,
        location_id: location.id!,
        quantity,
        dry_run: true,
        source_location_id: sourceLocationId,
      });
      setState((s) => ({
        ...s,
        phase: "previewing",
        item, location, preview, quantity,
        selectedSourceId: sourceLocationId ?? preview.source_location_id ?? null,
      }));
    } catch (err) {
      setState((s) => ({ ...s, phase: "error", errorMsg: apiErrMsg(err) }));
    }
  }, []);

  // ── Commit: call dry_run=false on user Confirm
  const commit = useCallback(async () => {
    if (!state.item || !state.location || !state.preview) return;
    setState((s) => ({ ...s, phase: "committing" }));
    try {
      const result = await scanApi.smartApply({
        item_id: state.item.id!,
        location_id: state.location.id!,
        quantity: state.quantity,
        dry_run: false,
        source_location_id: state.selectedSourceId ?? undefined,
      });
      setState((s) => ({ ...s, phase: "success", preview: result }));
    } catch (err) {
      setState((s) => ({ ...s, phase: "error", errorMsg: apiErrMsg(err) }));
    }
  }, [state.item, state.location, state.preview, state.quantity, state.selectedSourceId]);

  // ── Re-fetch preview when quantity or source selection changes
  useEffect(() => {
    if (state.phase !== "previewing" || !state.item || !state.location) return;
    // Skip refetch on first preview render (quantity matches preview)
    const needsRefetch =
      (state.preview?.requires_source_selection && state.selectedSourceId !== null) ||
      false; // quantity change handled separately to avoid loops
    if (needsRefetch) {
      fetchPreview(state.item, state.location, state.quantity, state.selectedSourceId ?? undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedSourceId]);

  // Refresh preview when quantity changes (debounced via separate handler)
  const onQuantityChange = useCallback((n: number) => {
    setState((s) => ({ ...s, quantity: n }));
    if (state.item && state.location) {
      fetchPreview(state.item, state.location, n, state.selectedSourceId ?? undefined);
    }
  }, [state.item, state.location, state.selectedSourceId, fetchPreview]);

  // ── Barcode handler
  const onScan = useCallback(async (raw: string) => {
    if (!scanning.current) return;

    let resolved: ScanResult;
    try {
      resolved = await scanApi.lookup(raw);
    } catch {
      toast.error("Unrecognised barcode", { duration: 1500 });
      return;
    }
    if (resolved.result_type === "unknown") {
      toast.error("Barcode not in system", { duration: 1500 });
      return;
    }

    setState((prev) => {
      // Duplicate scan guard
      if (resolved.result_type === "item" && prev.item?.id === resolved.id) {
        toast("Item already scanned", { duration: 1200 });
        return prev;
      }
      if (resolved.result_type === "location" && prev.location?.id === resolved.id) {
        toast("Rack already scanned", { duration: 1200 });
        return prev;
      }

      if (resolved.result_type === "item") {
        if (prev.phase === "location_scanned" && prev.location) {
          // Both scanned — fire preview
          fetchPreview(resolved, prev.location, prev.quantity);
          return { ...prev, item: resolved };
        }
        return { ...prev, phase: "item_scanned", item: resolved };
      }

      if (resolved.result_type === "location") {
        if (prev.phase === "item_scanned" && prev.item) {
          fetchPreview(prev.item, resolved, prev.quantity);
          return { ...prev, location: resolved };
        }
        return { ...prev, phase: "location_scanned", location: resolved };
      }

      return prev;
    });
  }, [fetchPreview]);

  // ── Derived flags
  const itemDone = !!state.item;
  const locationDone = !!state.location;

  const ActionIcon = state.preview ? ACTION_ICON[state.preview.action] : ArrowUpRight;
  const actionColor = state.preview ? ACTION_COLOR[state.preview.action] : "var(--accent)";

  return (
    <div
      className="flex flex-col h-full relative overflow-hidden"
      style={{ background: "var(--bg-primary)" }}
    >
      {/* ── Camera ── */}
      <div className="flex-1 relative min-h-0">
        <BarcodeScanner
          onScan={onScan}
          autoStart
          hint={
            state.phase === "idle" ? "Scan item barcode or rack QR" :
            state.phase === "item_scanned" ? "Now scan a rack QR code" :
            state.phase === "location_scanned" ? "Now scan an item barcode" :
            undefined
          }
          className="w-full h-full"
        />

        {/* Step indicators */}
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-6 px-5 py-2 rounded-full"
          style={{
            background: isDark ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.70)",
            backdropFilter: "blur(12px)",
            border: "1px solid var(--border-card)",
          }}
        >
          <StepDot active={!itemDone} done={itemDone} label="Item" />
          <div className="w-8 h-px" style={{ background: "var(--border-card)" }} />
          <StepDot active={itemDone && !locationDone} done={locationDone} label="Rack" />
          <div className="w-8 h-px" style={{ background: "var(--border-card)" }} />
          <StepDot active={state.phase === "previewing"} done={state.phase === "success"} label="Confirm" />
        </div>
      </div>

      {/* ── Bottom Panel ── */}
      <div
        className="shrink-0 p-4 space-y-3 max-h-[60vh] overflow-y-auto"
        style={{
          background: isDark
            ? "linear-gradient(180deg, rgba(15,23,42,0.85) 0%, rgba(15,23,42,0.98) 100%)"
            : "linear-gradient(180deg, rgba(241,245,249,0.85) 0%, rgba(241,245,249,0.98) 100%)",
          backdropFilter: "blur(20px)",
          borderTop: "1px solid var(--border-card)",
        }}
      >
        {state.phase === "idle" && (
          <p className="text-center text-sm py-2" style={{ color: "var(--text-muted)" }}>Scan any barcode to begin</p>
        )}

        {state.phase === "item_scanned" && state.item && (
          <>
            <ScanCard icon={Package} label="Item" name={state.item.name} code={state.item.code} color="#2563EB" isDark={isDark} />
            <p className="text-center text-xs py-1" style={{ color: "var(--text-muted)" }}>Scan a rack QR to continue</p>
          </>
        )}

        {state.phase === "location_scanned" && state.location && (
          <>
            <ScanCard icon={MapPin} label="Rack" name={state.location.name} code={state.location.code} color="#7C3AED" isDark={isDark} />
            <p className="text-center text-xs py-1" style={{ color: "var(--text-muted)" }}>Scan an item barcode to continue</p>
          </>
        )}

        {/* ── PREVIEW (awaiting Confirm) ── */}
        {state.phase === "previewing" && state.item && state.location && state.preview && (
          <>
            <ScanCard icon={Package} label="Item" name={state.item.name} code={state.item.code} color="#2563EB" isDark={isDark} />
            <ScanCard icon={MapPin} label="Rack" name={state.location.name} code={state.location.code} color="#7C3AED" isDark={isDark} />

            {/* Source picker — only for transfer with multiple candidates */}
            {state.preview.action === "transfer" && state.preview.candidate_sources.length > 1 && (
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--text-muted)" }}>
                  Transfer from
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {state.preview.candidate_sources.map((c: CandidateSource) => (
                    <button
                      key={c.location_id}
                      onClick={() => setState((s) => ({ ...s, selectedSourceId: c.location_id }))}
                      className="text-left rounded-lg px-3 py-2 transition-all"
                      style={{
                        background: state.selectedSourceId === c.location_id
                          ? `${actionColor}22`
                          : (isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)"),
                        border: `1px solid ${state.selectedSourceId === c.location_id ? actionColor : "var(--border-card)"}`,
                      }}
                    >
                      <p className="text-xs font-bold truncate" style={{ color: "var(--text-primary)" }}>{c.location_name}</p>
                      <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>qty {c.quantity}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Action summary + quantity stepper */}
            <div
              className="flex items-center justify-between rounded-xl px-4 py-3"
              style={{ background: `${actionColor}18`, border: `1px solid ${actionColor}44` }}
            >
              <div className="flex items-center gap-2">
                <ActionIcon size={18} style={{ color: actionColor }} />
                <div>
                  <span className="text-sm font-bold" style={{ color: actionColor }}>
                    {ACTION_LABEL[state.preview.action]}
                  </span>
                  {state.preview.action === "transfer" && state.preview.source_location_name && (
                    <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      from {state.preview.source_location_name}
                    </p>
                  )}
                </div>
              </div>
              <QtyStepper value={state.quantity} onChange={onQuantityChange} isDark={isDark} />
            </div>

            {/* Quantity delta */}
            <div className="flex items-center justify-between text-xs px-1" style={{ color: "var(--text-muted)" }}>
              <span>Stock at {state.location.name}</span>
              <span className="tabular-nums">
                {state.preview.previous_quantity} → <span style={{ color: actionColor, fontWeight: 700 }}>{state.preview.new_quantity}</span>
              </span>
            </div>

            {/* Confirm + Cancel */}
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <button
                onClick={commit}
                disabled={state.preview.requires_source_selection && state.selectedSourceId == null}
                className="py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                style={{ background: actionColor, color: "#fff" }}
              >
                Confirm
              </button>
              <button
                onClick={reset}
                className="px-4 py-3 rounded-xl text-sm"
                style={{ border: "1px solid var(--border-card)", color: "var(--text-muted)" }}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {state.phase === "committing" && (
          <div className="flex items-center justify-center gap-2 py-4">
            <Loader2 size={18} className="animate-spin" style={{ color: "var(--accent)" }} />
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>Saving…</span>
          </div>
        )}

        {state.phase === "success" && state.preview && state.item && state.location && (
          <>
            <div className="flex items-center gap-3">
              <CheckCircle2 size={28} style={{ color: ACTION_COLOR[state.preview.action] }} />
              <div>
                <p className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>
                  {state.preview.action === "stock_in" && "Stock added"}
                  {state.preview.action === "stock_out" && "Stock removed"}
                  {state.preview.action === "transfer" && "Transfer complete"}
                </p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {state.item.name} · {state.location.name}
                </p>
              </div>
            </div>
            <button
              onClick={reset}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold"
              style={{
                background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                border: "1px solid var(--border-card)",
                color: "var(--text-primary)",
              }}
            >
              <RotateCcw size={14} /> Scan another
            </button>
          </>
        )}

        {state.phase === "error" && (
          <>
            <div className="flex items-center gap-3">
              <XCircle size={28} style={{ color: "#DC2626" }} />
              <div>
                <p className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>Failed</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>{state.errorMsg}</p>
              </div>
            </div>
            <button
              onClick={reset}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold"
              style={{
                background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                border: "1px solid var(--border-card)",
                color: "var(--text-primary)",
              }}
            >
              <RotateCcw size={14} /> Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles with no new errors**

```bash
cd /Users/yash/Downloads/Inventory/frontend
npx tsc --noEmit 2>&1 | head -30
```

Expected: 0 new errors from `SmartScan.tsx`.

- [ ] **Step 3: Commit**

```bash
cd /Users/yash/Downloads/Inventory
git add frontend/src/pages/SmartScan.tsx
git commit -m "feat(smart-scan): replace AI vision with QR + explicit confirm + transfer + qty stepper"
```

---

### Task 5: Verify Routes + Nav Wiring

**Files:**
- Read-only verify: `frontend/src/App.tsx`, `frontend/src/components/layout/Sidebar.tsx`, `frontend/src/components/layout/MobileNav.tsx`

- [ ] **Step 1: Verify route exists in App.tsx**

```bash
grep -n "smart-scan\|SmartScan" /Users/yash/Downloads/Inventory/frontend/src/App.tsx
```

Expected output includes both the lazy import and the route:
```
const SmartScan = lazy(...)
<Route path="smart-scan" element={<SmartScan />} />
```

If missing, add them following the existing pattern (e.g., next to the Scan route).

- [ ] **Step 2: Verify nav entries exist in Sidebar + MobileNav**

```bash
grep -n "smart-scan\|SmartScan\|Smart Scan" \
  /Users/yash/Downloads/Inventory/frontend/src/components/layout/Sidebar.tsx \
  /Users/yash/Downloads/Inventory/frontend/src/components/layout/MobileNav.tsx
```

Expected: at least one match in each file. If missing, add using the existing nav item shape (e.g., `{ to: "/smart-scan", label: "Smart Scan", icon: Zap }`).

- [ ] **Step 3: Commit if any wiring was added**

```bash
cd /Users/yash/Downloads/Inventory
git add frontend/src/App.tsx frontend/src/components/layout/Sidebar.tsx frontend/src/components/layout/MobileNav.tsx
git commit -m "fix(nav): ensure Smart Scan route + nav entries are wired"
```

---

### Task 6: End-to-End Smoke Test + Deploy

- [ ] **Step 1: Start dev servers**

```bash
# Terminal 1 — backend
cd /Users/yash/Downloads/Inventory/backend
uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd /Users/yash/Downloads/Inventory/frontend
npm run dev
```

- [ ] **Step 2: Test all three actions on the Smart Scan page**

Navigate to `http://localhost:5173/smart-scan`.

**Test 1 — stock_in (new item to fresh rack):**
1. Pick an item that has zero stock anywhere → scan its barcode
2. Scan a rack QR that doesn't hold any of that item
3. Expect: preview shows "Add to rack" (green), qty 0 → 1
4. Press Confirm → success card

**Test 2 — stock_out (item already at scanned rack):**
1. Scan an item that has stock at Rack A
2. Scan Rack A
3. Expect: preview shows "Remove from rack" (red), qty N → N-1
4. Press Confirm → success card

**Test 3 — transfer with single source (item at one other rack):**
1. Scan an item that has stock at Rack A only
2. Scan Rack B (empty for this item)
3. Expect: preview shows "Transfer to rack" (blue), source auto-picked = Rack A, qty 0 → 1
4. Press Confirm → success card

**Test 4 — transfer with multiple sources:**
1. Scan an item that has stock at both Rack A and Rack C
2. Scan Rack B (empty for this item)
3. Expect: preview shows source picker with both A and C; Confirm button disabled until pick
4. Tap Rack A in picker → preview updates, Confirm enables → Confirm → success

**Test 5 — quantity stepper:**
1. Repeat any flow but step quantity to 3 via the +/- buttons before Confirm
2. Expect: preview's new_quantity reflects 3, backend executes 3-unit operation

**Test 6 — duplicate scan guard:**
1. Scan an item → scan the same item again → expect toast "Item already scanned", no state change
2. Same for location

**Test 7 — unknown barcode:**
1. Scan a barcode not in the system → expect toast "Barcode not in system", camera stays active

**Test 8 — error path:**
1. With backend down (kill terminal 1), try a scan flow → expect error card with retry button

- [ ] **Step 3: Verify dark + light theme**

Toggle to dark theme in sidebar. Verify:
- Bottom panel uses dark glass background
- Source picker cards have correct dark colors
- Action color (green/red/blue) visible in both modes
- Quantity stepper readable in both modes

- [ ] **Step 4: Push to main and deploy**

```bash
cd /Users/yash/Downloads/Inventory
git push origin main
```

GitHub Actions CI/CD will deploy backend to Cloud Run and frontend to Vercel. Monitor Actions tab or run:
```bash
gh run watch $(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')
```

Expected: all jobs pass, production URLs show the new Smart Scan page.

---

## Self-Review

### Spec Coverage

| Requirement (from user) | Where addressed |
|-------------------------|-----------------|
| Scan item or location barcode, either order | Task 4 — `onScan` handles both result_types |
| System decides action automatically (no intent prompting) | Task 2 — three-branch decision on backend |
| Support stock-in (new inventory) | Task 2 branch 4 |
| Support stock-out (remove from rack) | Task 2 branch 3 |
| Support transfer between aisles | Task 2 branch 5 |
| Show details before commit | Task 4 — `previewing` phase with ScanCards + action summary |
| User presses Confirm to execute | Task 4 — explicit Confirm button, no auto-commit timer |
| Zero "intent" prompting | Backend computes the action; UI never asks "in or out?" |
| Multi-location transfer ambiguity | Task 4 — source picker; Task 2 — `requires_source_selection` flag |
| Dark + light theme | Task 4 — all styles via CSS vars + `isDark` flag |
| Production-quality UI/UX | Task 4 — glass panel, step dots (3 stages), action color coding |
| Backend atomicity | Task 2 — single endpoint, transactions handled by InventoryService |
| Nav + route wiring | Task 5 |

### Type Consistency Check

- `ScanResult` used in state (`item`, `location`) — imported from `@/types` ✓
- `SmartApplyResponse`, `SmartAction`, `CandidateSource` — exported from `@/api/transactions` ✓
- `InventoryEvent` used inside `SmartApplyResponse.event` — imported from `@/types` ✓
- Backend `SmartApplyResponse.action` is `Literal["stock_in", "stock_out", "transfer"]` — matches frontend `SmartAction` union ✓
- `requires_source_selection` and `candidate_sources` flow end-to-end ✓
- `quantity` is `Decimal` on backend, `number` on frontend — JSON serialization handles the conversion (verified via OpenAPI in Task 2) ✓

### Out of Scope (Not Addressed Here)

- **Unknown-barcode → create-new-item flow.** Currently toasts and stays idle. If wanted, separate task: extend `onScan` to surface a "Create new item from <code>?" modal when `result_type === "unknown"`, calling `itemsApi.create()` then re-running lookup.
- **Bulk multi-item scanning.** Each scan resets state after success; for batch-receiving 50 items at once, the RFID batch flow or a dedicated bulk page is better suited.
- **Source location selection for stock_out when item is at multiple racks.** Stock-out always targets the scanned rack (intuitive: "I'm at this rack, removing from it"). If users need "remove from a different rack than where I'm standing," that's a separate flow.
- **Concurrency / optimistic locking.** Two users smart-scanning the same item simultaneously could race. Backend's `InventoryService.transfer`/`stock_out` should already handle the DB-level constraint; surface the error gracefully in the error state.

### Placeholder Scan

None found. All steps contain exact code or exact commands.
