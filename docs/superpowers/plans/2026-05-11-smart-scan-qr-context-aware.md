# Smart Scan QR Context-Aware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AI-camera SmartScan page (1524 lines) with a two-scan QR/barcode flow that automatically determines stock-in vs stock-out with zero user prompting.

**Architecture:** User scans item barcode (or location first) → resolve both barcodes → query existing stock at that location → if qty > 0 auto stock-out, else auto stock-in → 1.5 s cancel window → commit → success. A new backend `POST /scans/smart-apply` endpoint encapsulates the decision atomically. Frontend is a pure state machine with a full-screen camera and a glassmorphic bottom panel.

**Tech Stack:** FastAPI (backend), React 18 + TypeScript + Tailwind CSS variables (frontend), `@zxing/library` via `BarcodeScanner` component (already exists), `react-hot-toast`, Zustand theme store, `scanApi` in `transactions.ts`.

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `backend/app/api/v1/scans.py` | Add `POST /scans/smart-apply` endpoint |
| Modify | `backend/app/schemas/transaction.py` | Add `SmartApplyRequest`, `SmartApplyResponse` schemas |
| Modify | `frontend/src/api/transactions.ts` | Add `scanApi.smartApply()` |
| Overwrite | `frontend/src/pages/SmartScan.tsx` | Replace AI-vision page with QR state machine (target ≤ 320 lines) |
| Verify (no change) | `frontend/src/App.tsx` | Route `/smart-scan` → `SmartScan` lazy import already exists |
| Verify (no change) | `frontend/src/components/layout/Sidebar.tsx` | Nav entry for Smart Scan already exists |
| Verify (no change) | `frontend/src/components/layout/MobileNav.tsx` | Nav entry for Smart Scan already exists |

---

### Task 1: Backend Schemas — `SmartApplyRequest` + `SmartApplyResponse`

**Files:**
- Modify: `backend/app/schemas/transaction.py`

- [ ] **Step 1: Read the file**

```bash
# already done — schemas are at lines 1–60, append after existing content
```

- [ ] **Step 2: Append new schemas at the end of `backend/app/schemas/transaction.py`**

Add after the last existing class (`InventoryEventRead` or wherever the file ends):

```python
class SmartApplyRequest(OrmBase):
    """Automatically determine stock-in vs stock-out based on current stock level."""
    item_id: int
    location_id: int
    quantity: Decimal = Field(default=Decimal("1"), gt=0)
    notes: str | None = None
    scan_session_id: str | None = None
    source: str = "smart_scan"


class SmartApplyResponse(OrmBase):
    action: Literal["stock_in", "stock_out"]
    event: "InventoryEventRead"
    previous_quantity: int
    new_quantity: int
```

Note: `Literal` is already imported from `typing` if present; if not, add `from typing import Literal` at the top of the file.

- [ ] **Step 3: Verify no import errors**

```bash
cd /Users/yash/Downloads/Inventory/backend
python -c "from app.schemas.transaction import SmartApplyRequest, SmartApplyResponse; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
cd /Users/yash/Downloads/Inventory
git add backend/app/schemas/transaction.py
git commit -m "feat(scans): add SmartApplyRequest + SmartApplyResponse schemas"
```

---

### Task 2: Backend Endpoint — `POST /scans/smart-apply`

**Files:**
- Modify: `backend/app/api/v1/scans.py`

- [ ] **Step 1: Add import at top of `backend/app/api/v1/scans.py`**

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
    InventoryEventRead,
    ScanLookupRequest,
    SmartApplyRequest,
    SmartApplyResponse,
    StockInRequest,
    StockOutRequest,
    TransferRequest,
)
```

- [ ] **Step 2: Add the endpoint after the existing `/apply` route (after line ~141)**

```python
@router.post(
    "/smart-apply",
    response_model=SmartApplyResponse,
    status_code=status.HTTP_201_CREATED,
)
async def smart_apply(
    body: SmartApplyRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> SmartApplyResponse:
    """Auto stock-in or stock-out based on current stock at the location."""
    from app.repositories.transaction_repo import StockLevelRepository

    stock_repo = StockLevelRepository(session)
    svc = InventoryService(session)
    actor_roles = [ur.role.name for ur in current_user.roles if ur.role]

    existing = await stock_repo.get_by_item_location(body.item_id, body.location_id)
    current_qty = int(existing.quantity) if existing else 0

    if current_qty > 0:
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
        new_qty = max(0, current_qty - int(body.quantity))
        action = "stock_out"
    else:
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
        new_qty = current_qty + int(body.quantity)
        action = "stock_in"

    return SmartApplyResponse(
        action=action,
        event=_event_to_read(event, session),
        previous_quantity=current_qty,
        new_quantity=new_qty,
    )
```

- [ ] **Step 3: Run backend and verify endpoint appears in OpenAPI**

```bash
cd /Users/yash/Downloads/Inventory/backend
uvicorn app.main:app --reload --port 8000 &
sleep 3
curl -s http://localhost:8000/openapi.json | python -c "import sys,json; paths=json.load(sys.stdin)['paths']; print([p for p in paths if 'smart' in p])"
```

Expected: `['/api/v1/scans/smart-apply']` (or similar with prefix)

- [ ] **Step 4: Kill dev server and commit**

```bash
kill %1 2>/dev/null; sleep 1
cd /Users/yash/Downloads/Inventory
git add backend/app/api/v1/scans.py
git commit -m "feat(scans): add POST /scans/smart-apply — auto stock-in/out by stock level"
```

---

### Task 3: Frontend API — `scanApi.smartApply()`

**Files:**
- Modify: `frontend/src/api/transactions.ts`

- [ ] **Step 1: Add `smartApply` to `scanApi` object in `frontend/src/api/transactions.ts`**

Find in `transactions.ts`:
```typescript
  modifyItem: async (payload: {
```

Insert before `modifyItem`:
```typescript
  smartApply: async (payload: {
    item_id: number;
    location_id: number;
    quantity?: number;
    notes?: string;
    scan_session_id?: string;
  }): Promise<{ action: "stock_in" | "stock_out"; event: InventoryEvent; previous_quantity: number; new_quantity: number }> => {
    const { data } = await apiClient.post("/scans/smart-apply", { quantity: 1, ...payload });
    return data;
  },
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/yash/Downloads/Inventory/frontend
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors (or pre-existing errors only — not from transactions.ts)

- [ ] **Step 3: Commit**

```bash
cd /Users/yash/Downloads/Inventory
git add frontend/src/api/transactions.ts
git commit -m "feat(api): add scanApi.smartApply() for context-aware stock action"
```

---

### Task 4: Replace SmartScan.tsx with QR State Machine

**Files:**
- Overwrite: `frontend/src/pages/SmartScan.tsx`

This is the largest task. The new page is ≤ 320 lines. Complete file content below.

- [ ] **Step 1: Overwrite `frontend/src/pages/SmartScan.tsx` with the following**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Package, MapPin, CheckCircle2, XCircle, RotateCcw, ArrowUpRight, ArrowDownRight, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { BarcodeScanner } from "@/components/scanner/BarcodeScanner";
import { scanApi } from "@/api/transactions";
import { itemsApi } from "@/api/items";
import { useThemeStore } from "@/store/theme";
import type { ScanResult, InventoryEvent, StockLevel } from "@/types";

// ─── State Machine Types ──────────────────────────────────────────────────────

type SmartPhase =
  | "idle"
  | "item_scanned"
  | "location_scanned"
  | "auto_commit"
  | "committing"
  | "success"
  | "error";

interface SmartState {
  phase: SmartPhase;
  item?: ScanResult;
  location?: ScanResult;
  action?: "stock_in" | "stock_out";
  prevQty?: number;
  event?: InventoryEvent;
  errorMsg?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function apiErrMsg(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return (detail as { msg: string }[]).map((d) => d.msg).join(", ");
  return "Something went wrong";
}

async function stockAt(item_id: number, location_id: number): Promise<number> {
  try {
    const levels: StockLevel[] = await itemsApi.getStockLevels(item_id);
    const found = levels.find((l) => l.location_id === location_id);
    return found ? Number(found.quantity) : 0;
  } catch {
    return 0;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScanCard({
  icon: Icon,
  label,
  name,
  code,
  color,
  isDark,
}: {
  icon: typeof Package;
  label: string;
  name: string;
  code: string;
  color: string;
  isDark: boolean;
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
        <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--text-muted)" }}>
          {label}
        </p>
        <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>
          {name}
        </p>
        <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
          {code}
        </p>
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
          background: done ? "var(--accent)" : active ? "var(--accent)" : "var(--border-card)",
          opacity: done || active ? 1 : 0.4,
          boxShadow: active ? "0 0 0 4px rgba(37,99,235,0.25)" : "none",
        }}
      />
      <span className="text-[9px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const COMMIT_DELAY_MS = 1800;

export default function SmartScan() {
  const isDark = useThemeStore((s) => s.theme) === "dark";
  const [state, setState] = useState<SmartState>({ phase: "idle" });
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanning = useRef(true);

  const reset = useCallback(() => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    scanning.current = true;
    setState({ phase: "idle" });
  }, []);

  // Auto-reset after success
  useEffect(() => {
    if (state.phase === "success") {
      const t = setTimeout(reset, 4000);
      return () => clearTimeout(t);
    }
  }, [state.phase, reset]);

  const commit = useCallback(async (item: ScanResult, location: ScanResult, action: "stock_in" | "stock_out", prevQty: number) => {
    setState((s) => ({ ...s, phase: "committing" }));
    try {
      const result = await scanApi.smartApply({
        item_id: item.id!,
        location_id: location.id!,
        quantity: 1,
      });
      setState({
        phase: "success",
        item,
        location,
        action: result.action,
        prevQty: result.previous_quantity,
        event: result.event,
      });
    } catch (err) {
      setState({ phase: "error", item, location, action, prevQty, errorMsg: apiErrMsg(err) });
    }
  }, []);

  const scheduleCommit = useCallback((item: ScanResult, location: ScanResult, action: "stock_in" | "stock_out", prevQty: number) => {
    scanning.current = false;
    setState({ phase: "auto_commit", item, location, action, prevQty });
    commitTimer.current = setTimeout(() => commit(item, location, action, prevQty), COMMIT_DELAY_MS);
  }, [commit]);

  const cancelCommit = useCallback(() => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    reset();
  }, [reset]);

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
      // ─ both already known: ignore until reset
      if (prev.phase === "auto_commit" || prev.phase === "committing" || prev.phase === "success") return prev;

      if (resolved.result_type === "item") {
        if (prev.phase === "location_scanned" && prev.location) {
          // complete the pair
          const location = prev.location;
          const item = resolved;
          stockAt(item.id!, location.id!).then((qty) => {
            scheduleCommit(item, location, qty > 0 ? "stock_out" : "stock_in", qty);
          });
          return { ...prev, phase: "auto_commit", item };
        }
        return { phase: "item_scanned", item: resolved };
      }

      if (resolved.result_type === "location") {
        if (prev.phase === "item_scanned" && prev.item) {
          const item = prev.item;
          const location = resolved;
          stockAt(item.id!, location.id!).then((qty) => {
            scheduleCommit(item, location, qty > 0 ? "stock_out" : "stock_in", qty);
          });
          return { ...prev, phase: "auto_commit", location };
        }
        return { phase: "location_scanned", location: resolved };
      }

      return prev;
    });
  }, [scheduleCommit]);

  const isDone = state.phase === "item_scanned" || state.phase === "location_scanned";
  const itemDone = !!(state.item);
  const locationDone = !!(state.location);

  const ACTION_COLOR = {
    stock_in: "#059669",
    stock_out: "#DC2626",
  };

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
            state.phase === "idle"
              ? "Scan item barcode or rack QR"
              : state.phase === "item_scanned"
              ? "Now scan a rack QR code"
              : state.phase === "location_scanned"
              ? "Now scan an item barcode"
              : undefined
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
        </div>
      </div>

      {/* ── Bottom Panel ── */}
      <div
        className="shrink-0 p-4 space-y-3"
        style={{
          background: isDark
            ? "linear-gradient(180deg, rgba(15,23,42,0.85) 0%, rgba(15,23,42,0.98) 100%)"
            : "linear-gradient(180deg, rgba(241,245,249,0.85) 0%, rgba(241,245,249,0.98) 100%)",
          backdropFilter: "blur(20px)",
          borderTop: "1px solid var(--border-card)",
        }}
      >
        {/* ── idle ── */}
        {state.phase === "idle" && (
          <p className="text-center text-sm py-2" style={{ color: "var(--text-muted)" }}>
            Scan any barcode to begin
          </p>
        )}

        {/* ── item scanned ── */}
        {state.phase === "item_scanned" && state.item && (
          <>
            <ScanCard icon={Package} label="Item" name={state.item.name} code={state.item.code} color="#2563EB" isDark={isDark} />
            <p className="text-center text-xs py-1" style={{ color: "var(--text-muted)" }}>
              Scan a rack QR to continue
            </p>
          </>
        )}

        {/* ── location scanned ── */}
        {state.phase === "location_scanned" && state.location && (
          <>
            <ScanCard icon={MapPin} label="Rack" name={state.location.name} code={state.location.code} color="#7C3AED" isDark={isDark} />
            <p className="text-center text-xs py-1" style={{ color: "var(--text-muted)" }}>
              Scan an item barcode to continue
            </p>
          </>
        )}

        {/* ── auto_commit ── */}
        {state.phase === "auto_commit" && state.item && state.location && state.action && (
          <>
            <ScanCard icon={Package} label="Item" name={state.item.name} code={state.item.code} color="#2563EB" isDark={isDark} />
            <ScanCard icon={MapPin} label="Rack" name={state.location.name} code={state.location.code} color="#7C3AED" isDark={isDark} />
            <div
              className="flex items-center justify-between rounded-xl px-4 py-3"
              style={{
                background: `${ACTION_COLOR[state.action]}18`,
                border: `1px solid ${ACTION_COLOR[state.action]}44`,
              }}
            >
              <div className="flex items-center gap-2">
                {state.action === "stock_in"
                  ? <ArrowUpRight size={18} style={{ color: ACTION_COLOR.stock_in }} />
                  : <ArrowDownRight size={18} style={{ color: ACTION_COLOR.stock_out }} />}
                <span className="text-sm font-bold" style={{ color: ACTION_COLOR[state.action] }}>
                  {state.action === "stock_in" ? "Adding to rack" : "Removing from rack"}
                </span>
              </div>
              <button
                onClick={cancelCommit}
                className="text-xs px-3 py-1 rounded-lg"
                style={{ border: "1px solid var(--border-card)", color: "var(--text-muted)" }}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {/* ── committing ── */}
        {state.phase === "committing" && (
          <div className="flex items-center justify-center gap-2 py-4">
            <Loader2 size={18} className="animate-spin" style={{ color: "var(--accent)" }} />
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>Saving…</span>
          </div>
        )}

        {/* ── success ── */}
        {state.phase === "success" && state.item && state.location && state.action && (
          <>
            <div className="flex items-center gap-3">
              <CheckCircle2 size={28} style={{ color: ACTION_COLOR[state.action] }} />
              <div>
                <p className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>
                  {state.action === "stock_in" ? "Stock added" : "Stock removed"}
                </p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {state.item.name} · {state.location.name}
                </p>
              </div>
            </div>
            <button
              onClick={reset}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all"
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

        {/* ── error ── */}
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

Expected: 0 new errors from `SmartScan.tsx`

- [ ] **Step 3: Commit**

```bash
cd /Users/yash/Downloads/Inventory
git add frontend/src/pages/SmartScan.tsx
git commit -m "feat(smart-scan): replace AI camera vision with QR context-aware two-scan flow"
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

Expected: at least one match in each file for the `/smart-scan` route. If missing, add the entry using the same object shape as existing nav items (e.g., `{ to: "/smart-scan", label: "Smart Scan", icon: Zap }`).

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

- [ ] **Step 2: Open Smart Scan in browser**

Navigate to `http://localhost:5173/smart-scan` (or the Vite port shown in terminal).

Test golden path:
1. Camera loads without errors
2. Step dots show "Item" and "Rack"
3. Scan an item barcode → item card appears, hint changes to "Scan a rack QR"
4. Scan a rack barcode → action preview appears ("Adding to rack" / "Removing from rack")
5. After 1.8 s the commit fires (or tap Cancel and verify reset)
6. Success card shows with correct action label
7. Auto-resets to idle after 4 s (or tap "Scan another")

Test edge case: scan location first → item second → same auto-commit

Test error: scan unknown barcode → toast "Barcode not in system" appears, camera stays active

- [ ] **Step 3: Verify dark mode**

Toggle to dark theme in sidebar. Verify:
- Bottom panel uses dark glass background
- Cards and badges have correct dark-theme colors
- Action color (green/red) visible in both modes

- [ ] **Step 4: Push to main and deploy**

```bash
cd /Users/yash/Downloads/Inventory
git push origin main
```

GitHub Actions CI/CD will deploy backend to Cloud Run and frontend to Vercel. Monitor Actions tab or run:
```bash
gh run watch $(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')
```

Expected: all jobs pass, production URLs show new Smart Scan page.

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| Scrap existing AI-vision SmartScan page | Task 4 (full overwrite) |
| QR/barcode camera scanner | Task 4 — `BarcodeScanner` component |
| Auto-identify item vs location | Task 4 — `scanApi.lookup()` → `result_type` |
| Show which location item is in (item first flow) | Task 4 — `stockAt()` check after both scanned |
| If item already in location → auto stock-out | Tasks 2 + 4 — backend decides, frontend schedules |
| If item NOT in location → auto stock-in | Tasks 2 + 4 — same logic, qty === 0 |
| Zero manual prompting | Task 4 — 1.8 s auto-commit with Cancel only escape |
| Scan location first flow | Task 4 — `location_scanned` phase handles this |
| Dark + light theme | Task 4 — all styles via CSS vars + `isDark` flag |
| Production-quality UI/UX | Task 4 — glassmorphic panel, step dots, action preview |
| Backend atomicity | Task 2 — single `/scans/smart-apply` endpoint |
| Nav + route wiring | Task 5 |

### Type Consistency Check

- `ScanResult` used in state (`item`, `location`) — imported from `@/types` ✓
- `InventoryEvent` used for `event` in success state — imported from `@/types` ✓  
- `StockLevel` used in `stockAt()` helper — imported from `@/types` ✓
- `scanApi.smartApply()` returns `{ action, event, previous_quantity, new_quantity }` — matches `SmartApplyResponse` schema ✓
- `scanApi.lookup()` returns `ScanResult` with `result_type`, `id`, `code`, `name` — matches existing usage in `Scan.tsx` ✓
- `itemsApi.getStockLevels(item_id)` returns `StockLevel[]` — `safeStockLevels` pattern from Scan.tsx ✓

### Placeholder Scan

None found. All steps contain exact code or exact commands.
