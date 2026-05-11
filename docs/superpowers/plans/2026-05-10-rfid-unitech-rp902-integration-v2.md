# Unitech RP902 RFID Integration — Full Plan (v2, Capacitor + SDK)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the Unitech RP902 via a Capacitor iOS wrapper that bridges the Unitech iOS SDK to the existing React app, so scanning RFID tags fires real-time JS events → items resolve in the RFID Scan page → full inventory CRUD (stock-in/out/transfer/adjust) executes.

**Architecture:** The existing React app (Vercel) is wrapped in a Capacitor iOS shell pointing at the live URL. A Swift Capacitor plugin initialises the Unitech iOS SDK and emits `tagRead(epc, rssi)` events into JS. `RfidScan.tsx` has dual mode: Capacitor SDK path (primary, real-time multi-tag) and HID keyboard fallback (for browser/non-iOS access). The FastAPI backend is unchanged except for new `/rfid/*` endpoints and an `rfid_epc` barcode row per item.

**Tech Stack:** FastAPI (Python 3.11) · React 18 + TypeScript · Capacitor 6 · Swift 5 · Unitech iOS SDK V2.0.0.6 · Tanstack Query · Tailwind/CSS vars glassmorphism · lucide-react

---

## Prerequisites — Confirm These Before Starting

> **All three must be in place before Phase 3 (Capacitor). Phases 1–2 are safe to do now.**

| # | Requirement | How to confirm |
|---|-------------|----------------|
| 1 | Mac + Xcode 15+ | `xcode-select --version` → must succeed |
| 2 | Apple Developer Program ($99/year) | Log in at developer.apple.com → Member Center shows "Active" |
| 3 | Unitech iOS SDK V2.0.0.6 unzipped | Download from ute.com → RP902 product page → Downloads → "RFID SDK iOS" |

Once SDK is downloaded, open the sample Xcode project inside it, deploy to your iPhone, and confirm: squeezing the RP902 trigger shows EPCs in the sample app. If that doesn't work, stop here and debug before continuing.

**Identify from the SDK sample project (needed for Task 8):**
- Framework filename (e.g. `UnitechRFID.framework` or `.xcframework`)
- MFi protocol string in sample's `Info.plist` → `UISupportedExternalAccessoryProtocols` array
- Class name for the main reader object and delegate protocol (e.g. `RFIDReader`, `RFIDReaderDelegate`)

---

## File Map

### Backend
| Action | File | What changes |
|--------|------|-------------|
| Modify | `backend/app/services/barcode_service.py:53` | Fix `EPC_PREFIX` to match physical labels |
| Modify | `backend/app/api/v1/items.py:133` | Also store `rfid_epc` barcode row on item create |
| Modify | `backend/app/core/config.py` | Add `RFID_WEBHOOK_API_KEY` setting |
| Create | `backend/app/api/v1/rfid.py` | RFID endpoints |
| Modify | `backend/app/api/router.py` | Register rfid router |

### Frontend (web)
| Action | File | What changes |
|--------|------|-------------|
| Create | `frontend/src/api/rfid.ts` | Typed API client for rfid endpoints |
| Create | `frontend/src/plugins/unitechRfid.ts` | Capacitor plugin JS wrapper |
| Create | `frontend/src/pages/RfidScan.tsx` | Dual-mode page (SDK events + HID fallback) |
| Modify | `frontend/src/App.tsx` | Add lazy `/rfid-scan` route |
| Modify | `frontend/src/components/layout/Sidebar.tsx` | Add RFID nav entry |
| Modify | `frontend/src/components/layout/MobileNav.tsx` | Add RFID nav entry |

### Capacitor / iOS (Phase 3 only)
| Action | File | What changes |
|--------|------|-------------|
| Create | `frontend/capacitor.config.ts` | Capacitor config pointing at Vercel URL |
| Create | `ios/App/App/UnitechRfidPlugin.swift` | Swift plugin wrapping Unitech SDK |
| Create | `ios/App/App/UnitechRfidPlugin.m` | ObjC bridge file |
| Modify | `ios/App/App/AppDelegate.swift` | Register the plugin |
| Modify | `ios/App/App/Info.plist` | Add MFi protocol string + camera/BT usage strings |

---

## Phase 1 — Backend

### Task 1: Fix EPC Prefix + Store rfid_epc Barcode on Item Create

**Files:**
- Modify: `backend/app/services/barcode_service.py` (~line 53)
- Modify: `backend/app/api/v1/items.py` (function `create_item`)

**Why first:** Physical labels are already programmed with prefix `E28011122223333344440` (21 chars). Current code has `E280111222233344440` (19 chars). New items generate wrong EPCs. Also, `create_item` only stores one barcode row (`qr+code128`); `scan_service.resolve()` step 4 won't match RFID scans until we add an `rfid_epc` row.

- [ ] **Step 1: Fix EPC_PREFIX**

In `backend/app/services/barcode_service.py`, find and replace:
```python
# OLD
EPC_PREFIX = "E280111222233344440"
```
```python
# NEW — matches physical labels (21-char prefix + 3-char item_id = 24-char EPC-96)
EPC_PREFIX = "E28011122223333344440"
```

- [ ] **Step 2: Add rfid_epc barcode row in create_item**

In `backend/app/api/v1/items.py`, find `create_item`. Extend the import block to add `generate_epc_serial` and insert the second barcode after `session.add(bc)`:

```python
async def create_item(body: ItemCreate, session: DbSession, current_user: CurrentUser) -> ItemRead:
    repo = ItemRepository(session)
    if await repo.get_by_sku(body.sku):
        raise HTTPException(status_code=409, detail=f"SKU '{body.sku}' already exists")

    from app.services.barcode_service import (
        render_qr_png,
        gtin14_for_item,
        gs1_digital_link_url,
        generate_epc_serial,          # ← add this
    )
    item = Item(**body.model_dump())
    session.add(item)
    await session.flush()

    gtin14 = gtin14_for_item(item.id)
    gs1_url = gs1_digital_link_url(item.id, item.name)
    qr_bytes = render_qr_png(gs1_url)
    bc = ItemBarcode(
        item_id=item.id,
        barcode_type="qr+code128",
        barcode_value=gtin14,
        qr_image=qr_bytes,
        is_primary=True,
    )
    session.add(bc)

    # RFID EPC — resolves RP902 scans via scan_service exact barcode match
    epc_bc = ItemBarcode(
        item_id=item.id,
        barcode_type="rfid_epc",
        barcode_value=generate_epc_serial(item.id),
        is_primary=False,
    )
    session.add(epc_bc)

    await session.flush()
    await session.refresh(item)

    await event_bus.publish(DomainEvent(
        event_type=EventType.ITEM_CREATED,
        payload={"item_id": item.id, "sku": item.sku, "name": item.name},
        actor_id=current_user.id,
    ))

    read = _to_item_read(item, Decimal("0"))
    return read.model_copy(
        update={"qr_png_base64": base64.standard_b64encode(qr_bytes).decode("ascii")},
    )
```

- [ ] **Step 3: Restart server**

```bash
cd backend && source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
Expected: `Application startup complete.` No import errors.

- [ ] **Step 4: Smoke-test — item creation produces two barcodes**

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -s -X POST http://localhost:8000/api/v1/items \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sku":"RFID-TEST-001","name":"RFID Test Widget","unit":"pcs"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); [print(b['barcode_type'], b['barcode_value']) for b in d.get('barcodes',[])]"
```
Expected output (two lines):
```
qr+code128   002420411500...
rfid_epc     E28011122223333344440001
```

- [ ] **Step 5: Verify EPC resolves via scan lookup**

```bash
curl -s -X POST http://localhost:8000/api/v1/scans/lookup \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"barcode_value":"E28011122223333344440001"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result_type'], d['name'])"
```
Expected: `item   RFID Test Widget`

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/barcode_service.py backend/app/api/v1/items.py
git commit -m "feat: fix EPC prefix to match physical labels; store rfid_epc barcode on item create"
```

---

### Task 2: Add RFID Webhook API Key Config

**Files:**
- Modify: `backend/app/core/config.py`

- [ ] **Step 1: Add setting**

In `backend/app/core/config.py`, after the `RESEND_ENABLE_LOW_STOCK` block, add:
```python
    # RFID webhook — shared secret for external integrations
    # Leave empty to disable the webhook endpoint
    RFID_WEBHOOK_API_KEY: str = ""
```

- [ ] **Step 2: Restart, confirm no error**

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/core/config.py
git commit -m "feat: add RFID_WEBHOOK_API_KEY config setting"
```

---

### Task 3: Backend RFID Router

**Files:**
- Create: `backend/app/api/v1/rfid.py`
- Modify: `backend/app/api/router.py`

- [ ] **Step 1: Create `backend/app/api/v1/rfid.py`**

```python
"""
RFID integration endpoints — Unitech RP902 UHF Bluetooth reader.

Flow A (Capacitor SDK — primary):
  iOS app → Unitech SDK fires tagRead event → JS plugin wrapper emits to RfidScan.tsx
  → frontend calls POST /rfid/scan → gets item → user applies action via /scans/*

Flow B (HID keyboard — browser fallback):
  RP902 in HID mode types 24-char EPC + Enter into focused input
  → same frontend flow

Flow C (webhook — future SDK integration):
  Custom iOS SDK app POSTs batch EPCs to POST /rfid/webhook with API key
"""
from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.api.v1.auth import CurrentUser, require_roles
from app.core.config import settings
from app.core.database import DbSession
from app.models.item import ItemBarcode
from app.models.user import RoleName
from app.repositories.item_repo import ItemRepository
from app.schemas.transaction import StockInRequest, StockOutRequest
from app.services.inventory_service import InventoryService
from app.services.scan_service import ScanResultType, ScanService

router = APIRouter(prefix="/rfid", tags=["rfid"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class EpcScanRequest(BaseModel):
    epc: str


class ResolvedRfidItem(BaseModel):
    item_id: int
    sku: str
    name: str
    unit: str
    category: str
    total_quantity: float
    reorder_level: float
    unit_cost: float
    epc: str


class EpcScanResponse(BaseModel):
    found: bool
    epc: str
    item: ResolvedRfidItem | None = None


class BatchScanRequest(BaseModel):
    epcs: list[str]


class BatchScanResponse(BaseModel):
    matched: list[ResolvedRfidItem]
    unknown_epcs: list[str]


class BatchStockInRequest(BaseModel):
    item_ids: list[int]
    location_id: int
    quantity_each: float = 1.0
    reference: str | None = None
    notes: str | None = None


class BatchStockOutRequest(BaseModel):
    item_ids: list[int]
    location_id: int
    quantity_each: float = 1.0
    reason: str | None = None
    notes: str | None = None


class BatchActionResult(BaseModel):
    item_id: int
    sku: str
    success: bool
    error: str | None = None


class WebhookEpcEntry(BaseModel):
    epc: str
    rssi: float | None = None
    count: int | None = None


class WebhookRequest(BaseModel):
    device_id: str | None = None
    epcs: list[WebhookEpcEntry]


class EpcInfoResponse(BaseModel):
    item_id: int
    sku: str
    name: str
    epc: str


class RegisterEpcRequest(BaseModel):
    item_id: int
    epc: str


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _resolve_epc(epc: str, session: DbSession) -> ResolvedRfidItem | None:
    svc = ScanService(session)
    result = await svc.resolve(epc.strip().upper())
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


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/scan", response_model=EpcScanResponse)
async def scan_single_epc(
    body: EpcScanRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> EpcScanResponse:
    epc = body.epc.strip().upper()
    item = await _resolve_epc(epc, session)
    return EpcScanResponse(found=item is not None, epc=epc, item=item)


@router.post("/batch-scan", response_model=BatchScanResponse)
async def scan_batch_epcs(
    body: BatchScanRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> BatchScanResponse:
    matched: list[ResolvedRfidItem] = []
    unknown: list[str] = []
    seen: set[int] = set()
    for epc in body.epcs:
        item = await _resolve_epc(epc, session)
        if item is None:
            unknown.append(epc.strip().upper())
        elif item.item_id not in seen:
            matched.append(item)
            seen.add(item.item_id)
    return BatchScanResponse(matched=matched, unknown_epcs=unknown)


@router.post("/batch-stock-in", response_model=list[BatchActionResult])
async def batch_stock_in(
    body: BatchStockInRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> list[BatchActionResult]:
    svc = InventoryService(session)
    repo = ItemRepository(session)
    results: list[BatchActionResult] = []
    for item_id in body.item_ids:
        item = await repo.get_by_id(item_id)
        if not item:
            results.append(BatchActionResult(item_id=item_id, sku="?", success=False, error="Not found"))
            continue
        try:
            await svc.stock_in(StockInRequest(
                item_id=item_id,
                location_id=body.location_id,
                quantity=body.quantity_each,
                reference=body.reference,
                notes=body.notes,
                source="rfid",
            ), current_user.id)
            results.append(BatchActionResult(item_id=item_id, sku=item.sku, success=True))
        except Exception as exc:
            results.append(BatchActionResult(item_id=item_id, sku=item.sku, success=False, error=str(exc)))
    return results


@router.post("/batch-stock-out", response_model=list[BatchActionResult])
async def batch_stock_out(
    body: BatchStockOutRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> list[BatchActionResult]:
    svc = InventoryService(session)
    repo = ItemRepository(session)
    actor_roles = [ur.role.name for ur in current_user.roles if ur.role]
    results: list[BatchActionResult] = []
    for item_id in body.item_ids:
        item = await repo.get_by_id(item_id)
        if not item:
            results.append(BatchActionResult(item_id=item_id, sku="?", success=False, error="Not found"))
            continue
        try:
            await svc.stock_out(StockOutRequest(
                item_id=item_id,
                location_id=body.location_id,
                quantity=body.quantity_each,
                reason=body.reason,
                notes=body.notes,
                source="rfid",
            ), current_user.id, actor_roles)
            results.append(BatchActionResult(item_id=item_id, sku=item.sku, success=True))
        except Exception as exc:
            results.append(BatchActionResult(item_id=item_id, sku=item.sku, success=False, error=str(exc)))
    return results


@router.post("/webhook", response_model=BatchScanResponse)
async def rfid_webhook(
    body: WebhookRequest,
    session: DbSession,
    x_rfid_api_key: str = Header(default=""),
) -> BatchScanResponse:
    if not settings.RFID_WEBHOOK_API_KEY:
        raise HTTPException(status_code=503, detail="RFID webhook not configured")
    if x_rfid_api_key != settings.RFID_WEBHOOK_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid RFID API key")
    matched: list[ResolvedRfidItem] = []
    unknown: list[str] = []
    seen: set[int] = set()
    for entry in body.epcs:
        item = await _resolve_epc(entry.epc, session)
        if item is None:
            unknown.append(entry.epc.strip().upper())
        elif item.item_id not in seen:
            matched.append(item)
            seen.add(item.item_id)
    return BatchScanResponse(matched=matched, unknown_epcs=unknown)


@router.get("/epc/{item_id}", response_model=EpcInfoResponse)
async def get_item_epc(
    item_id: int,
    session: DbSession,
    current_user: CurrentUser,
) -> EpcInfoResponse:
    repo = ItemRepository(session)
    item = await repo.get_with_details(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    epc_bc = next((b for b in item.barcodes if b.barcode_type == "rfid_epc"), None)
    if not epc_bc:
        raise HTTPException(status_code=404, detail="No RFID EPC registered for this item")
    return EpcInfoResponse(item_id=item.id, sku=item.sku, name=item.name, epc=epc_bc.barcode_value)


@router.post(
    "/register-epc",
    response_model=EpcInfoResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
)
async def register_epc(
    body: RegisterEpcRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> EpcInfoResponse:
    """Register a custom EPC — use when tag was programmed externally via TagAccess."""
    repo = ItemRepository(session)
    item = await repo.get_with_details(body.item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    epc = body.epc.strip().upper()
    conflict = await session.execute(
        select(ItemBarcode).where(ItemBarcode.barcode_value == epc, ItemBarcode.item_id != body.item_id)
    )
    if conflict.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"EPC '{epc}' already registered to another item")
    existing = next((b for b in item.barcodes if b.barcode_type == "rfid_epc"), None)
    if existing:
        existing.barcode_value = epc
    else:
        session.add(ItemBarcode(item_id=body.item_id, barcode_type="rfid_epc", barcode_value=epc, is_primary=False))
    await session.flush()
    return EpcInfoResponse(item_id=item.id, sku=item.sku, name=item.name, epc=epc)
```

- [ ] **Step 2: Register in `backend/app/api/router.py`**

```python
# Change the import line to add rfid:
from app.api.v1 import auth, items, locations, barcodes, scans, transactions, dashboard, imports, ai, users, chat, passkeys, energy, rfid

# Add at the end of router registrations:
api_router.include_router(rfid.router)
```

- [ ] **Step 3: Verify 7 RFID endpoints appear**

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

curl -s http://localhost:8000/openapi.json \
  | python3 -c "import sys,json; [print(p) for p in json.load(sys.stdin)['paths'] if '/rfid/' in p]"
```
Expected (7 paths):
```
/api/v1/rfid/scan
/api/v1/rfid/batch-scan
/api/v1/rfid/batch-stock-in
/api/v1/rfid/batch-stock-out
/api/v1/rfid/webhook
/api/v1/rfid/epc/{item_id}
/api/v1/rfid/register-epc
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/v1/rfid.py backend/app/api/router.py
git commit -m "feat: add RFID API router (scan, batch-scan, batch-stock-in/out, webhook, register-epc)"
```

---

## Phase 2 — Frontend (Web)

### Task 4: Frontend API Client

**Files:**
- Create: `frontend/src/api/rfid.ts`

- [ ] **Step 1: Create `frontend/src/api/rfid.ts`**

```typescript
import { apiClient } from "./client";

export interface ResolvedRfidItem {
  item_id: number;
  sku: string;
  name: string;
  unit: string;
  category: string;
  total_quantity: number;
  reorder_level: number;
  unit_cost: number;
  epc: string;
}

export interface EpcScanResponse {
  found: boolean;
  epc: string;
  item: ResolvedRfidItem | null;
}

export interface BatchScanResponse {
  matched: ResolvedRfidItem[];
  unknown_epcs: string[];
}

export interface BatchActionResult {
  item_id: number;
  sku: string;
  success: boolean;
  error: string | null;
}

export interface EpcInfoResponse {
  item_id: number;
  sku: string;
  name: string;
  epc: string;
}

export const rfidApi = {
  scanEpc: (epc: string): Promise<EpcScanResponse> =>
    apiClient.post("/rfid/scan", { epc }).then((r) => r.data),

  batchScan: (epcs: string[]): Promise<BatchScanResponse> =>
    apiClient.post("/rfid/batch-scan", { epcs }).then((r) => r.data),

  batchStockIn: (payload: {
    item_ids: number[];
    location_id: number;
    quantity_each: number;
    reference?: string;
    notes?: string;
  }): Promise<BatchActionResult[]> =>
    apiClient.post("/rfid/batch-stock-in", payload).then((r) => r.data),

  batchStockOut: (payload: {
    item_ids: number[];
    location_id: number;
    quantity_each: number;
    reason?: string;
    notes?: string;
  }): Promise<BatchActionResult[]> =>
    apiClient.post("/rfid/batch-stock-out", payload).then((r) => r.data),

  getItemEpc: (item_id: number): Promise<EpcInfoResponse> =>
    apiClient.get(`/rfid/epc/${item_id}`).then((r) => r.data),

  registerEpc: (item_id: number, epc: string): Promise<EpcInfoResponse> =>
    apiClient.post("/rfid/register-epc", { item_id, epc }).then((r) => r.data),
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/rfid.ts
git commit -m "feat: add rfid API client"
```

---

### Task 5: Capacitor Plugin TypeScript Wrapper

**Files:**
- Create: `frontend/src/plugins/unitechRfid.ts`

This file is written now but only activates once the Swift plugin exists (Phase 3). The web layer detects `Capacitor.isNativePlatform()` at runtime — if false, the plugin calls are no-ops and the page falls back to HID keyboard mode.

- [ ] **Step 1: Install Capacitor core**

```bash
cd frontend
npm install @capacitor/core
```

- [ ] **Step 2: Create `frontend/src/plugins/unitechRfid.ts`**

```typescript
import { registerPlugin, Capacitor } from "@capacitor/core";

export interface TagReadEvent {
  epc: string;
  rssi: number;
  timestamp: number;
}

export interface UnitechRfidPlugin {
  connect(): Promise<{ connected: boolean }>;
  disconnect(): Promise<void>;
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  addListener(
    eventName: "tagRead",
    listenerFunc: (event: TagReadEvent) => void
  ): Promise<{ remove: () => void }>;
  addListener(
    eventName: "connected" | "disconnected",
    listenerFunc: () => void
  ): Promise<{ remove: () => void }>;
}

export const isNative = Capacitor.isNativePlatform();

export const UnitechRfid = registerPlugin<UnitechRfidPlugin>("UnitechRfidPlugin", {
  // Web fallback — all methods are no-ops when running in browser
  web: {
    connect: async () => ({ connected: false }),
    disconnect: async () => {},
    startScan: async () => {},
    stopScan: async () => {},
    addListener: async (_event: string, _fn: () => void) => ({ remove: () => {} }),
  },
});
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/plugins/unitechRfid.ts
git commit -m "feat: Capacitor plugin wrapper for UnitechRfidPlugin (web fallback no-ops)"
```

---

### Task 6: RFID Scan Page — Dual Mode

**Files:**
- Create: `frontend/src/pages/RfidScan.tsx`

**Dual mode logic:**
- `isNative === true` → use `UnitechRfid.addListener("tagRead", ...)` — EPCs arrive as real-time events from the SDK
- `isNative === false` → show HID keyboard input field (24-char hex auto-submit, same as v1 plan)

Both modes feed into the same session list + action panel.

- [ ] **Step 1: Create `frontend/src/pages/RfidScan.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Wifi, AlertCircle, CheckCircle2, Trash2,
  ArrowUpRight, ArrowDownRight, Loader2, Radio, Keyboard,
} from "lucide-react";
import toast from "react-hot-toast";
import { rfidApi, type ResolvedRfidItem } from "@/api/rfid";
import { apiClient } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { useThemeStore } from "@/store/theme";
import { UnitechRfid, isNative } from "@/plugins/unitechRfid";

interface SessionEntry {
  epc: string;
  item: ResolvedRfidItem | null;
  selected: boolean;
}

type ActionMode = "none" | "stock_in" | "stock_out";

interface LocationOption {
  id: number;
  name: string;
  code: string;
}

export function RfidScan() {
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === "dark";

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [epcInput, setEpcInput] = useState("");
  const [session, setSession] = useState<SessionEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [sdkConnected, setSdkConnected] = useState(false);
  const [actionMode, setActionMode] = useState<ActionMode>("none");
  const [locationId, setLocationId] = useState<number | null>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [quantityEach, setQuantityEach] = useState(1);
  const [actionNote, setActionNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Load locations on mount
  useEffect(() => {
    apiClient.get("/locations").then((r) => {
      const data = r.data?.items ?? r.data ?? [];
      setLocations(Array.isArray(data) ? data : []);
    }).catch(() => {});
  }, []);

  // Auto-focus HID input on mount (browser mode only)
  useEffect(() => {
    if (!isNative) inputRef.current?.focus();
  }, []);

  // Capacitor SDK mode — connect + subscribe to tagRead events
  useEffect(() => {
    if (!isNative) return;
    let listenerHandle: { remove: () => void } | null = null;

    (async () => {
      try {
        const result = await UnitechRfid.connect();
        setSdkConnected(result.connected);
        if (result.connected) {
          await UnitechRfid.startScan();
          listenerHandle = await UnitechRfid.addListener("tagRead", (event) => {
            resolveEpc(event.epc);
          });
        } else {
          toast.error("RP902 not found — pair via Bluetooth first");
        }
      } catch {
        toast.error("Failed to connect to RP902");
      }
    })();

    return () => {
      listenerHandle?.remove();
      UnitechRfid.stopScan().catch(() => {});
      UnitechRfid.disconnect().catch(() => {});
      setSdkConnected(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolveEpc = useCallback(async (epc: string) => {
    const clean = epc.trim().toUpperCase();
    if (!clean) return;
    setSession((prev) => {
      if (prev.some((e) => e.epc === clean)) return prev; // skip duplicate
      return prev; // will be added after API call
    });

    // Check duplicate before API call
    const currentEpcs = new Set(
      (document.querySelectorAll("[data-epc]") as NodeListOf<HTMLElement>)
        ? Array.from(document.querySelectorAll("[data-epc]")).map((el) => el.dataset.epc!)
        : []
    );
    if (currentEpcs.has(clean)) {
      setEpcInput("");
      return;
    }

    setScanning(true);
    try {
      const result = await rfidApi.scanEpc(clean);
      setSession((prev) => {
        if (prev.some((e) => e.epc === clean)) return prev;
        return [...prev, { epc: clean, item: result.item, selected: true }];
      });
      if (result.found && result.item) {
        toast.success(`Found: ${result.item.name}`, { duration: 1500 });
      } else {
        toast(`Unknown EPC: ${clean}`, { icon: "⚠️", duration: 2000 });
      }
    } catch {
      toast.error("Scan failed");
    } finally {
      setScanning(false);
      setEpcInput("");
      if (!isNative) inputRef.current?.focus();
    }
  }, []);

  const handleInputChange = (value: string) => {
    setEpcInput(value);
    // RP902 HID sometimes doesn't send Enter — auto-submit after 24 hex chars
    if (value.trim().length >= 24 && /^[0-9A-Fa-f]+$/.test(value.trim())) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => resolveEpc(value), 150);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      resolveEpc(epcInput);
    }
  };

  const toggleSelect = (epc: string) => {
    setSession((prev) => prev.map((e) => e.epc === epc ? { ...e, selected: !e.selected } : e));
  };

  const selectedItems = session.filter((e) => e.selected && e.item !== null);
  const selectedItemIds = selectedItems.map((e) => e.item!.item_id);
  const matchedCount = session.filter((e) => e.item !== null).length;
  const unknownCount = session.filter((e) => e.item === null).length;

  const handleBatchAction = async () => {
    if (!locationId) { toast.error("Select a location first"); return; }
    if (selectedItemIds.length === 0) { toast.error("No items selected"); return; }
    setSubmitting(true);
    try {
      const payload = { item_ids: selectedItemIds, location_id: locationId, quantity_each: quantityEach };
      const results = actionMode === "stock_in"
        ? await rfidApi.batchStockIn({ ...payload, notes: actionNote || undefined })
        : await rfidApi.batchStockOut({ ...payload, reason: actionNote || undefined });
      const ok = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);
      if (ok.length > 0) toast.success(`${actionMode === "stock_in" ? "Stocked in" : "Stocked out"} ${ok.length} item(s)`);
      if (failed.length > 0) toast.error(`${failed.length} failed: ${failed.map((f) => f.error).join("; ")}`);
      const successIds = new Set(ok.map((r) => r.item_id));
      setSession((prev) => prev.filter((e) => !e.item || !successIds.has(e.item.item_id)));
      setActionMode("none");
      setActionNote("");
    } catch {
      toast.error("Action failed");
    } finally {
      setSubmitting(false);
    }
  };

  const glass = {
    background: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.75)",
    backdropFilter: "blur(12px)",
    border: "1px solid var(--border-card)",
    borderRadius: 16,
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
          style={{ background: "rgba(37,99,235,0.12)", border: "1px solid rgba(37,99,235,0.3)" }}>
          <Radio size={20} style={{ color: "var(--accent)" }} />
        </div>
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>RFID Scan</h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {isNative
              ? sdkConnected ? "RP902 connected — pull trigger to scan" : "Connecting to RP902…"
              : "HID keyboard mode — focus input and scan"}
          </p>
        </div>
        {/* Mode badge */}
        <div className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
          style={{
            background: isNative ? "rgba(37,99,235,0.12)" : "rgba(107,114,128,0.12)",
            border: `1px solid ${isNative ? "rgba(37,99,235,0.3)" : "rgba(107,114,128,0.3)"}`,
            color: isNative ? "var(--accent)" : "var(--text-muted)",
          }}>
          {isNative ? <Wifi size={12} /> : <Keyboard size={12} />}
          {isNative ? "SDK" : "HID"}
        </div>
      </div>

      {/* HID Input (browser only) */}
      {!isNative && (
        <div style={glass} className="p-5 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Keyboard size={16} style={{ color: "var(--accent)" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Scan Tags — keep focused, pull trigger
            </span>
          </div>
          <div className="relative">
            <input
              ref={inputRef}
              value={epcInput}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Waiting for RP902 HID scan… (or type EPC)"
              className="w-full px-4 py-3 rounded-xl text-sm font-mono"
              style={{
                background: isDark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.9)",
                border: "2px solid var(--accent)",
                color: "var(--text-primary)",
                outline: "none",
              }}
              autoComplete="off"
              spellCheck={false}
            />
            {scanning && <Loader2 size={16} className="animate-spin absolute right-3 top-3.5" style={{ color: "var(--accent)" }} />}
          </div>
        </div>
      )}

      {/* Session stats + clear */}
      {session.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
            style={{ background: "rgba(34,197,94,0.12)", color: "#16a34a" }}>
            {matchedCount} matched
          </span>
          {unknownCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
              style={{ background: "rgba(239,68,68,0.12)", color: "#dc2626" }}>
              {unknownCount} unknown
            </span>
          )}
          <button onClick={() => { setSession([]); setActionMode("none"); }}
            className="ml-auto flex items-center gap-1 text-xs hover:opacity-70"
            style={{ color: "var(--text-muted)" }}>
            <Trash2 size={12} /> Clear session
          </button>
        </div>
      )}

      {/* Session list */}
      {session.length > 0 && (
        <div style={glass} className="p-4 space-y-2">
          <p className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
            Scanned ({session.length})
          </p>
          {session.map((entry) => (
            <button
              key={entry.epc}
              data-epc={entry.epc}
              onClick={() => entry.item && toggleSelect(entry.epc)}
              className="w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left"
              style={{
                background: entry.selected && entry.item
                  ? isDark ? "rgba(37,99,235,0.15)" : "rgba(37,99,235,0.08)"
                  : isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.6)",
                border: entry.selected && entry.item
                  ? "1px solid rgba(37,99,235,0.4)"
                  : "1px solid var(--border-card)",
              }}
            >
              {entry.item ? (
                <>
                  <CheckCircle2 size={16} style={{ color: entry.selected ? "var(--accent)" : "var(--text-muted)", flexShrink: 0 }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>{entry.item.name}</p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {entry.item.sku} · {entry.item.total_quantity} {entry.item.unit}
                    </p>
                  </div>
                  <Badge
                    label={entry.item.total_quantity <= 0 ? "OUT" : entry.item.total_quantity <= entry.item.reorder_level ? "LOW" : "OK"}
                    variant={entry.item.total_quantity <= 0 ? "error" : entry.item.total_quantity <= entry.item.reorder_level ? "warning" : "success"}
                  />
                </>
              ) : (
                <>
                  <AlertCircle size={16} style={{ color: "#dc2626", flexShrink: 0 }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono truncate" style={{ color: "#dc2626" }}>{entry.epc}</p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>Unknown — not in inventory</p>
                  </div>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Action panel */}
      {matchedCount > 0 && (
        <div style={glass} className="p-5 space-y-4">
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Action — {selectedItems.length} item(s) selected
          </p>
          <div className="flex gap-2">
            {(["stock_in", "stock_out"] as const).map((mode) => (
              <button key={mode}
                onClick={() => setActionMode(actionMode === mode ? "none" : mode)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={{
                  background: actionMode === mode
                    ? mode === "stock_in" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.12)"
                    : isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.8)",
                  border: actionMode === mode
                    ? mode === "stock_in" ? "1px solid rgba(34,197,94,0.4)" : "1px solid rgba(239,68,68,0.3)"
                    : "1px solid var(--border-card)",
                  color: actionMode === mode
                    ? mode === "stock_in" ? "#16a34a" : "#dc2626"
                    : "var(--text-primary)",
                }}>
                {mode === "stock_in" ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                {mode === "stock_in" ? "Stock In" : "Stock Out"}
              </button>
            ))}
          </div>
          {actionMode !== "none" && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-muted)" }}>Location</label>
                <select value={locationId ?? ""} onChange={(e) => setLocationId(Number(e.target.value) || null)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm"
                  style={{ background: isDark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.9)", border: "1px solid var(--border-card)", color: "var(--text-primary)" }}>
                  <option value="">Select location…</option>
                  {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name} ({loc.code})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-muted)" }}>Qty per item</label>
                <Input type="number" min={1} value={quantityEach} onChange={(e) => setQuantityEach(Number(e.target.value))} />
              </div>
              <div>
                <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-muted)" }}>
                  {actionMode === "stock_out" ? "Reason (optional)" : "Notes (optional)"}
                </label>
                <Input value={actionNote} onChange={(e) => setActionNote(e.target.value)}
                  placeholder={actionMode === "stock_out" ? "Checkout, damaged…" : "PO ref…"} />
              </div>
              <Button onClick={handleBatchAction} disabled={submitting || !locationId || selectedItemIds.length === 0}
                className="w-full" variant={actionMode === "stock_in" ? "primary" : "danger"}>
                {submitting
                  ? <Loader2 size={16} className="animate-spin mr-2" />
                  : actionMode === "stock_in" ? <ArrowUpRight size={16} className="mr-2" /> : <ArrowDownRight size={16} className="mr-2" />}
                Confirm {actionMode === "stock_in" ? "Stock In" : "Stock Out"} ({selectedItemIds.length})
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {session.length === 0 && (
        <div className="py-16 text-center space-y-3">
          <div className="w-16 h-16 rounded-3xl flex items-center justify-center mx-auto"
            style={{ background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", border: "1px dashed var(--border-card)" }}>
            <Radio size={28} style={{ color: "var(--text-muted)" }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {isNative ? (sdkConnected ? "Pull the RP902 trigger to scan" : "Connecting to RP902…") : "Ready — focus here, pull RP902 trigger"}
          </p>
          <p className="text-xs max-w-xs mx-auto" style={{ color: "var(--text-muted)" }}>
            {isNative
              ? "Running in iOS app. RP902 connects automatically via Bluetooth/iAP2. Scanned EPCs appear as cards above."
              : "Running in browser (HID mode). Pair RP902 via Bluetooth, keep input focused, pull trigger. EPC types automatically."}
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Check TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -30
```
Fix any type errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/RfidScan.tsx
git commit -m "feat: RFID scan page — dual mode (Capacitor SDK events + HID keyboard fallback)"
```

---

### Task 7: Route + Navigation Wiring

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Modify: `frontend/src/components/layout/MobileNav.tsx`

- [ ] **Step 1: Add route in App.tsx**

After the SmartScan lazy import line:
```typescript
const RfidScan = lazy(() => import("@/pages/RfidScan").then((m) => ({ default: m.RfidScan })));
```

Inside `<Routes>`, after the `/smart-scan` route:
```tsx
<Route path="/rfid-scan" element={<Suspense fallback={<PageSpinner />}><RfidScan /></Suspense>} />
```

- [ ] **Step 2: Add to Sidebar.tsx**

Add `Radio` to the lucide import. In `navItems`, after the Smart Scan entry:
```typescript
{ to: "/rfid-scan", label: "RFID Scan", icon: Radio, highlight: true },
```

- [ ] **Step 3: Add to MobileNav.tsx**

Add `Radio` to the lucide import. In the bottom nav items array:
```typescript
{ to: "/rfid-scan", label: "RFID", icon: Radio, highlight: true },
```

- [ ] **Step 4: Verify in browser**

```bash
cd frontend && npm run dev
```
Navigate to `http://localhost:5173`:
- Sidebar shows "RFID Scan" with Radio icon
- `/rfid-scan` loads without errors
- HID input auto-focuses
- Mode badge shows "HID" (since running in browser)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/layout/Sidebar.tsx frontend/src/components/layout/MobileNav.tsx
git commit -m "feat: wire /rfid-scan route and navigation"
```

---

## Phase 3 — Capacitor iOS Shell

> **Requires:** Xcode 15+, Apple Developer account, Unitech iOS SDK downloaded and sample tested.

### Task 8: Capacitor Setup

**Files:**
- Create: `frontend/capacitor.config.ts`

- [ ] **Step 1: Install Capacitor packages**

```bash
cd frontend
npm install @capacitor/core @capacitor/cli @capacitor/ios
```

- [ ] **Step 2: Create `frontend/capacitor.config.ts`**

```typescript
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "edu.uta.searlab.inventory",
  appName: "SEAR Lab Inventory",
  // Points at the live Vercel deployment — no rebuild needed when React changes
  server: {
    url: "https://inventory-brown-beta.vercel.app",
    cleartext: false,
  },
  ios: {
    contentInset: "automatic",
  },
};

export default config;
```

- [ ] **Step 3: Initialise Capacitor and add iOS platform**

```bash
cd frontend
npx cap init "SEAR Lab Inventory" "edu.uta.searlab.inventory" --web-dir=dist
npx cap add ios
```

- [ ] **Step 4: Open in Xcode and verify it runs**

```bash
npm run build           # builds dist/ (needed for npx cap sync)
npx cap sync ios
npx cap open ios
```
In Xcode: select an iPhone simulator → Product → Run. Expected: the SEAR Lab Inventory dashboard loads in the simulator. If it doesn't load, check the server URL in capacitor.config.ts matches your live Vercel URL exactly.

- [ ] **Step 5: Commit Capacitor files**

```bash
cd ..   # repo root
git add frontend/capacitor.config.ts frontend/package.json frontend/package-lock.json ios/
git commit -m "feat: add Capacitor iOS shell pointing at Vercel deployment"
```

---

### Task 9: Unitech SDK + Swift Plugin

**Files:**
- Create: `ios/App/App/UnitechRfidPlugin.swift`
- Create: `ios/App/App/UnitechRfidPlugin.m`
- Modify: `ios/App/App/AppDelegate.swift`
- Modify: `ios/App/App/Info.plist`

> **Before writing this task:** open the Unitech SDK sample Xcode project and identify:
> - The framework filename → call it `<SDK_FRAMEWORK>` below
> - The main reader class name → call it `<READER_CLASS>`
> - The delegate protocol name → call it `<READER_DELEGATE>`
> - The tag-read delegate method signature
> - The MFi protocol string from the sample's Info.plist

- [ ] **Step 1: Add Unitech framework to Xcode project**

1. Open `ios/App/App.xcworkspace` in Xcode
2. In Finder, locate `<SDK_FRAMEWORK>.framework` (or `.xcframework`) from the SDK zip
3. Drag it into the `App/App` group in Xcode's Project Navigator
4. In the dialog: check "Copy items if needed", target "App" checked → Add
5. In Xcode: select the **App** target → **General** → **Frameworks, Libraries, and Embedded Content** → set the framework to **"Embed & Sign"**

- [ ] **Step 2: Add MFi protocol string to Info.plist**

Open `ios/App/App/Info.plist`. Add the `UISupportedExternalAccessoryProtocols` key (get the exact string from the SDK sample's Info.plist):

```xml
<key>UISupportedExternalAccessoryProtocols</key>
<array>
    <string>com.unitech-mobile.rfid</string>   <!-- REPLACE with exact string from SDK sample -->
</array>
<key>NSBluetoothAlwaysUsageDescription</key>
<string>SEAR Lab Inventory uses Bluetooth to connect to the Unitech RP902 RFID reader.</string>
<key>NSBluetoothPeripheralUsageDescription</key>
<string>SEAR Lab Inventory uses Bluetooth to connect to the Unitech RP902 RFID reader.</string>
```

- [ ] **Step 3: Create `ios/App/App/UnitechRfidPlugin.swift`**

> Replace `<READER_CLASS>` and `<READER_DELEGATE>` with actual class/protocol names from the SDK sample.

```swift
import Foundation
import Capacitor
// import <SDK_FRAMEWORK>   // Uncomment after adding the framework — module name from SDK sample

@objc(UnitechRfidPlugin)
public class UnitechRfidPlugin: CAPPlugin {

    // Replace these type names with the actual SDK class names from the sample project
    // private var reader: <READER_CLASS>?

    // MARK: - Plugin lifecycle

    @objc func connect(_ call: CAPPluginCall) {
        // TODO: replace with actual SDK initialization from sample project
        // Typical pattern:
        //   reader = <READER_CLASS>.sharedInstance()
        //   reader?.delegate = self
        //   let connected = reader?.connect() ?? false

        // Placeholder — returns false until SDK is integrated
        let connected = false
        call.resolve(["connected": connected])
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        // reader?.disconnect()
        // reader = nil
        call.resolve()
    }

    @objc func startScan(_ call: CAPPluginCall) {
        // reader?.startInventory()
        call.resolve()
    }

    @objc func stopScan(_ call: CAPPluginCall) {
        // reader?.stopInventory()
        call.resolve()
    }
}

// MARK: - SDK Delegate
// Replace <READER_DELEGATE> with the actual protocol name from the SDK sample

// extension UnitechRfidPlugin: <READER_DELEGATE> {
//     // Replace with actual delegate method signature from SDK sample
//     // Typical pattern:
//     func rfidReader(_ reader: AnyObject, didReadTag epc: String, rssi: Float) {
//         notifyListeners("tagRead", data: [
//             "epc": epc.uppercased(),
//             "rssi": rssi,
//             "timestamp": Date().timeIntervalSince1970,
//         ])
//     }
// }
```

- [ ] **Step 4: Create ObjC bridge `ios/App/App/UnitechRfidPlugin.m`**

```objc
#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(UnitechRfidPlugin, "UnitechRfidPlugin",
    CAP_PLUGIN_METHOD(connect, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(disconnect, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(startScan, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stopScan, CAPPluginReturnPromise);
)
```

- [ ] **Step 5: Register plugin in AppDelegate.swift**

Open `ios/App/App/AppDelegate.swift`. Ensure the plugin is registered. Capacitor auto-discovers plugins from the ObjC bridge file — no manual registration needed. Verify by confirming `AppDelegate.swift` has the standard Capacitor boilerplate:

```swift
import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }
    // ... standard Capacitor lifecycle methods
}
```
No changes needed if this is already the default Capacitor AppDelegate.

- [ ] **Step 6: Build and run on real device**

> MFi only works on physical hardware — not in the simulator.

1. Connect iPhone via USB
2. In Xcode: select your iPhone as the run destination (not a simulator)
3. Product → Run (⌘R)
4. First run: Xcode will ask to trust the developer certificate on the device
5. App opens → navigate to **RFID Scan** page
6. Mode badge shows **SDK** (because `Capacitor.isNativePlatform()` returns true)
7. Status shows "Connecting to RP902…"

At this step the SDK is not yet integrated (placeholders in Swift file), so connection will fail. That's expected — the shell and plugin structure is verified.

- [ ] **Step 7: Integrate actual SDK calls**

Replace all `// TODO:` and `// reader?.` placeholder comments in `UnitechRfidPlugin.swift` with the actual SDK API calls from the sample project. Specifically:

1. Copy the import statement from the sample
2. Replace `<READER_CLASS>` with the actual class (e.g. `RFIDReader` or `UnitechReader`)
3. Uncomment the delegate extension, replace `<READER_DELEGATE>` with the actual protocol
4. Copy the actual delegate method signature from the sample's view controller
5. Keep `notifyListeners("tagRead", data: [...])` — this is the bridge to JS

- [ ] **Step 8: Live test with RP902**

1. Pair RP902 to iPhone via Bluetooth (same pairing as TagAccess)
2. Run app on device, navigate to RFID Scan
3. Status shows "RP902 connected — pull trigger to scan"
4. Squeeze trigger pointing at a tagged item
5. Item card appears in the session list
6. Apply stock-in: select location, qty=1, Confirm
7. Check Transactions page — event appears with `source: rfid`

- [ ] **Step 9: Commit**

```bash
git add ios/App/App/UnitechRfidPlugin.swift \
        ios/App/App/UnitechRfidPlugin.m \
        ios/App/App/Info.plist
git commit -m "feat: Unitech Swift Capacitor plugin + MFi protocol declaration"
```

---

### Task 10: TestFlight Distribution

- [ ] **Step 1: Configure signing**

In Xcode → **App** target → **Signing & Capabilities**:
- Team: select your Apple Developer team
- Bundle Identifier: `edu.uta.searlab.inventory`
- Signing Certificate: "Apple Distribution" (for TestFlight) or "Apple Development" (for testing)

- [ ] **Step 2: Archive and upload**

```
Product → Archive
```
When complete, Xcode Organizer opens. Click **Distribute App** → **TestFlight & App Store** → follow the wizard. Upload takes 5–10 minutes.

- [ ] **Step 3: Add testers in App Store Connect**

- Go to appstoreconnect.apple.com → your app → TestFlight → Internal Testing
- Add lab users by Apple ID email
- They receive an email → install TestFlight app → install SEAR Lab Inventory

- [ ] **Step 4: First review**

Apple review for TestFlight typically takes 1–3 days on first submission. Subsequent updates to the same build are usually approved within hours.

---

## Phase 4 — EPC Backfill for Existing Physical Tags

### Task 11: Register Existing Lab Tags

The physical labels in the lab (image 4) were programmed with EPCs directly via TagAccess before this integration was built. Those items need EPC rows added to `item_barcodes`.

- [ ] **Step 1: Find item IDs for existing tagged items**

```bash
curl -s "http://localhost:8000/api/v1/items?q=zebra" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; [print(i['id'], i['sku'], i['name']) for i in json.load(sys.stdin)['items']]"
```
Do this for each tagged item: Zebra 170, Ubisense Box, RFID Antenna, Brown Box, Black Box.

- [ ] **Step 2: Register EPC for each item**

From TagAccess Inventory scan (image 3), EPCs are:
- `E28011122223333344440001` → Zebra 170 Label Printer
- `E28011122223333344440002` → Ubisense Box
- `E28011122223333344440003` → RFID Antenna
- `E28011122223333344440004` → Brown Box (3-Pack)
- `E28011122223333344440005` → Black Box

```bash
# Run once per item — replace ITEM_ID and EPC_VALUE
curl -s -X POST http://localhost:8000/api/v1/rfid/register-epc \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"item_id": ITEM_ID, "epc": "EPC_VALUE"}' \
  | python3 -m json.tool
```

- [ ] **Step 3: Verify all 5 tags resolve**

```bash
for epc in E28011122223333344440001 E28011122223333344440002 E28011122223333344440003 E28011122223333344440004 E28011122223333344440005; do
  result=$(curl -s -X POST http://localhost:8000/api/v1/rfid/scan \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"epc\":\"$epc\"}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['found'], d.get('item',{}).get('name','?'))")
  echo "$epc → $result"
done
```
Expected: all 5 lines show `True <item name>`.

---

## Summary — Task Order

| Phase | Task | Prerequisites |
|-------|------|--------------|
| 1 | Task 1: EPC prefix + barcode row | None |
| 1 | Task 2: Config key | Task 1 |
| 1 | Task 3: Backend RFID router | Tasks 1–2 |
| 2 | Task 4: Frontend API client | Task 3 |
| 2 | Task 5: Capacitor plugin TS wrapper | Task 4 |
| 2 | Task 6: RfidScan.tsx (dual mode) | Tasks 4–5 |
| 2 | Task 7: Route + nav | Task 6 |
| 3 | Task 8: Capacitor iOS setup | Tasks 1–7 + Xcode + Apple Dev account |
| 3 | Task 9: Swift plugin + SDK | Task 8 + Unitech SDK downloaded + sample working |
| 3 | Task 10: TestFlight | Task 9 working on device |
| 4 | Task 11: EPC backfill | Task 3 running |
