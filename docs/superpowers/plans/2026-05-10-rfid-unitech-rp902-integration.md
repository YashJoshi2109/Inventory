# Unitech RP902 RFID Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the Unitech RP902 Bluetooth UHF RFID reader with the SEAR Lab inventory system so that scanning RFID tags (via HID keyboard mode) resolves items in a dedicated RFID scan page and enables full CRUD inventory operations (stock-in, stock-out, transfer, adjustment).

**Architecture:** The RP902 connects to the host device via Bluetooth in HID (keyboard) mode, which causes it to type scanned EPCs as keystrokes into any focused input field. The React frontend hosts a dedicated `/rfid-scan` page with an auto-capturing input that accumulates EPCs into a batch session — each EPC is resolved via the existing `scan_service`, and the user can then apply inventory actions (stock-in/out/transfer/adjust) to matched items individually or in bulk. A webhook endpoint (`POST /api/v1/rfid/webhook`) with API-key auth handles future integrations (custom iOS SDK app using Unitech SDK). No new database schema changes are needed since `item_barcodes` already stores multi-type barcodes; we only add an `rfid_epc` row alongside the existing `qr+code128` row when items are created.

**Tech Stack:** FastAPI (Python 3.11), SQLAlchemy async, React 18 + TypeScript, Tanstack Query, Tailwind CSS (CSS vars + glassmorphism design), lucide-react icons, existing `scan_service.resolve()` for EPC→item lookup, existing `/scans/*` endpoints for inventory actions.

---

## Hardware Context

- **Device:** Unitech RP902 MFi — Bluetooth 5.0, UHF RFID, EPC Gen2 / ISO 18000-6C, 2m read range
- **Integration mode (primary):** HID Bluetooth keyboard — RP902 types the 24-char hex EPC string followed by Enter into any focused input
- **Labels in lab:** Already programmed with EPCs like `E28011122223333344440001` through `E28011122223333344440005` (24 hex chars = 96-bit EPC)
- **EPC format for new items:** `E28011122223333344440` (21-char prefix) + `{item_id:03d}` = 24 chars total

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| **Modify** | `backend/app/services/barcode_service.py:53` | Fix `EPC_PREFIX` to match physical labels |
| **Modify** | `backend/app/api/v1/items.py:133-173` | Store `rfid_epc` barcode row on item create |
| **Modify** | `backend/app/core/config.py` | Add `RFID_WEBHOOK_API_KEY` setting |
| **Create** | `backend/app/api/v1/rfid.py` | RFID endpoints: scan, batch-scan, batch-action, webhook, epc-for-item |
| **Modify** | `backend/app/api/router.py` | Register rfid router |
| **Create** | `frontend/src/api/rfid.ts` | Typed API client for rfid endpoints |
| **Create** | `frontend/src/pages/RfidScan.tsx` | RFID scan page (HID input + batch session + actions) |
| **Modify** | `frontend/src/App.tsx` | Add lazy-loaded `/rfid-scan` route |
| **Modify** | `frontend/src/components/layout/Sidebar.tsx` | Add RFID Scan nav entry |
| **Modify** | `frontend/src/components/layout/MobileNav.tsx` | Add RFID Scan nav entry |

---

## Task 1: Fix EPC Prefix + Store EPC Barcode on Item Create

**Files:**
- Modify: `backend/app/services/barcode_service.py` (line ~53)
- Modify: `backend/app/api/v1/items.py` (function `create_item`, lines 133–173)

### Why this first
Physical labels already programmed with prefix `E28011122223333344440` (21 chars). Current code has `E280111222233344440` (19 chars). If we don't fix this, new items generate EPCs that won't match programmed tags. Also, currently `create_item` only stores a `qr+code128` barcode — we need a second `rfid_epc` row so `scan_service.resolve()` step 4 (exact barcode match) can find items by EPC.

- [ ] **Step 1: Update EPC_PREFIX in barcode_service.py**

Open `backend/app/services/barcode_service.py`. Find line:
```python
EPC_PREFIX = "E280111222233344440"
```
Replace with:
```python
EPC_PREFIX = "E28011122223333344440"
```
This makes `generate_epc_serial(1)` return `"E28011122223333344440001"` — matching the physical labels.

- [ ] **Step 2: Add rfid_epc barcode row in create_item**

Open `backend/app/api/v1/items.py`. Find the `create_item` function. The import block inside it currently imports barcode helpers. Extend it and add the EPC barcode row after the existing `bc` (qr+code128) insert:

```python
async def create_item(body: ItemCreate, session: DbSession, current_user: CurrentUser) -> ItemRead:
    repo = ItemRepository(session)
    if await repo.get_by_sku(body.sku):
        raise HTTPException(status_code=409, detail=f"SKU '{body.sku}' already exists")

    from app.services.barcode_service import (
        render_qr_png,
        gtin14_for_item,
        gtin12_for_item,
        serial_for_item,
        gs1_digital_link_url,
        generate_epc_serial,          # ← add this import
    )
    item = Item(**body.model_dump())
    session.add(item)
    await session.flush()

    # SEAR Lab Standard: Code128 encodes GTIN-14; QR encodes GS1 Digital Link URL
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

    # RFID EPC barcode — allows scan_service to resolve RP902 scans by EPC
    epc_value = generate_epc_serial(item.id)
    epc_bc = ItemBarcode(
        item_id=item.id,
        barcode_type="rfid_epc",
        barcode_value=epc_value,
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

- [ ] **Step 3: Verify server starts cleanly**

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
Expected: `Application startup complete.` — no import errors.

- [ ] **Step 4: Smoke-test item creation via curl (need auth token first)**

```bash
# Login — replace with real credentials
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Create test item
curl -s -X POST http://localhost:8000/api/v1/items \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sku":"RFID-TEST-001","name":"RFID Test Widget","unit":"pcs"}' \
  | python3 -m json.tool
```
Expected: JSON response with `"barcodes"` array containing two entries — one `barcode_type: "qr+code128"` and one `barcode_type: "rfid_epc"` with value starting `E28011122223333344440`.

- [ ] **Step 5: Verify EPC scan resolves to item**

```bash
# Get the EPC value from the item created above (replace item_id)
ITEM_ID=<id from previous response>
EPC_VALUE=$(curl -s http://localhost:8000/api/v1/items/$ITEM_ID \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; barcodes=json.load(sys.stdin)['barcodes']; print(next(b['barcode_value'] for b in barcodes if b['barcode_type']=='rfid_epc'))")

echo "EPC: $EPC_VALUE"

# Resolve EPC via existing scan endpoint
curl -s -X POST http://localhost:8000/api/v1/scans/lookup \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"barcode_value\":\"$EPC_VALUE\"}" \
  | python3 -m json.tool
```
Expected: `"result_type": "item"` with the item name.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/barcode_service.py backend/app/api/v1/items.py
git commit -m "feat: store rfid_epc barcode on item create; fix EPC prefix to match physical labels"
```

---

## Task 2: Add RFID Webhook API Key to Config

**Files:**
- Modify: `backend/app/core/config.py`

- [ ] **Step 1: Add RFID_WEBHOOK_API_KEY to Settings**

Open `backend/app/core/config.py`. After the `RESEND_ENABLE_LOW_STOCK: bool = True` block (around line 189), add:

```python
    # RFID webhook — shared secret for external RFID integrations (e.g. custom RP902 iOS SDK app)
    # Set to any random string; leave empty to disable webhook endpoint auth (dev only)
    RFID_WEBHOOK_API_KEY: str = ""
```

- [ ] **Step 2: Verify server starts**

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
Expected: starts without error.

- [ ] **Step 3: Commit**

```bash
git add backend/app/core/config.py
git commit -m "feat: add RFID_WEBHOOK_API_KEY config setting"
```

---

## Task 3: Backend RFID Router

**Files:**
- Create: `backend/app/api/v1/rfid.py`
- Modify: `backend/app/api/router.py`

### Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/rfid/scan` | JWT | Single EPC → resolved item info |
| `POST` | `/rfid/batch-scan` | JWT | List of EPCs → list of resolved items + unknown |
| `POST` | `/rfid/batch-action` | JWT | Apply action to list of item_ids |
| `POST` | `/rfid/webhook` | API key header | External tool webhook (TagAccess / SDK) |
| `GET` | `/rfid/epc/{item_id}` | JWT | Get EPC value for an item (for tag programming) |
| `POST` | `/rfid/register-epc` | JWT (admin/manager) | Register a custom EPC for an existing item |

- [ ] **Step 1: Create `backend/app/api/v1/rfid.py`**

```python
"""
RFID integration endpoints — Unitech RP902 UHF Bluetooth reader.

Primary flow (HID keyboard mode):
  1. User opens /rfid-scan page, focuses the EPC input field.
  2. RP902 (in HID mode) scans a tag and types the 24-char EPC + Enter.
  3. Frontend POSTs to /rfid/scan → gets item info.
  4. User selects an action (stock-in / stock-out / transfer / adjust).
  5. Frontend calls the existing /scans/* endpoints with the item_id.

Batch flow:
  1. User presses "Start Batch" on the RFID scan page.
  2. Multiple EPCs accumulate via repeated HID inputs.
  3. Frontend POSTs to /rfid/batch-action with collected item_ids + action.

Webhook flow (future — requires custom iOS app with Unitech SDK):
  1. iOS app sends batch EPC data to POST /rfid/webhook with X-RFID-API-Key header.
  2. Endpoint resolves EPCs and returns matched items.
"""
from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel

from app.api.v1.auth import CurrentUser, require_roles
from app.core.config import settings
from app.core.database import DbSession
from app.models.item import ItemBarcode
from app.models.user import RoleName
from app.repositories.item_repo import ItemRepository
from app.schemas.transaction import (
    AdjustmentRequest,
    StockInRequest,
    StockOutRequest,
    TransferRequest,
)
from app.services.inventory_service import InventoryService
from app.services.scan_service import ScanResultType, ScanService

router = APIRouter(prefix="/rfid", tags=["rfid"])


# ── Request / Response models ─────────────────────────────────────────────────

class EpcScanRequest(BaseModel):
    epc: str


class ResolvedItem(BaseModel):
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
    item: ResolvedItem | None = None


class BatchScanRequest(BaseModel):
    epcs: list[str]


class BatchScanResponse(BaseModel):
    matched: list[ResolvedItem]
    unknown_epcs: list[str]


class BatchActionKind(str):
    STOCK_IN = "stock_in"
    STOCK_OUT = "stock_out"
    TRANSFER = "transfer"
    ADJUSTMENT = "adjustment"


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

async def _resolve_epc(epc: str, session: DbSession) -> ResolvedItem | None:
    svc = ScanService(session)
    result = await svc.resolve(epc.strip().upper())
    if result.result_type != ScanResultType.ITEM or result.id is None:
        return None
    return ResolvedItem(
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
    """Resolve a single EPC to an inventory item."""
    epc = body.epc.strip().upper()
    item = await _resolve_epc(epc, session)
    return EpcScanResponse(found=item is not None, epc=epc, item=item)


@router.post("/batch-scan", response_model=BatchScanResponse)
async def scan_batch_epcs(
    body: BatchScanRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> BatchScanResponse:
    """Resolve a list of EPCs. Returns matched items and unrecognised EPCs separately."""
    matched: list[ResolvedItem] = []
    unknown: list[str] = []
    seen_item_ids: set[int] = set()

    for epc in body.epcs:
        item = await _resolve_epc(epc, session)
        if item is None:
            unknown.append(epc.strip().upper())
        elif item.item_id not in seen_item_ids:
            matched.append(item)
            seen_item_ids.add(item.item_id)

    return BatchScanResponse(matched=matched, unknown_epcs=unknown)


@router.post("/batch-stock-in", response_model=list[BatchActionResult])
async def batch_stock_in(
    body: BatchStockInRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> list[BatchActionResult]:
    """Apply stock-in to multiple items in one call."""
    svc = InventoryService(session)
    repo = ItemRepository(session)
    results: list[BatchActionResult] = []

    for item_id in body.item_ids:
        item = await repo.get_by_id(item_id)
        if not item:
            results.append(BatchActionResult(item_id=item_id, sku="?", success=False, error="Item not found"))
            continue
        try:
            req = StockInRequest(
                item_id=item_id,
                location_id=body.location_id,
                quantity=body.quantity_each,
                reference=body.reference,
                notes=body.notes,
                source="rfid",
            )
            await svc.stock_in(req, current_user.id)
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
    """Apply stock-out to multiple items in one call."""
    svc = InventoryService(session)
    repo = ItemRepository(session)
    actor_roles = [ur.role.name for ur in current_user.roles if ur.role]
    results: list[BatchActionResult] = []

    for item_id in body.item_ids:
        item = await repo.get_by_id(item_id)
        if not item:
            results.append(BatchActionResult(item_id=item_id, sku="?", success=False, error="Item not found"))
            continue
        try:
            req = StockOutRequest(
                item_id=item_id,
                location_id=body.location_id,
                quantity=body.quantity_each,
                reason=body.reason,
                notes=body.notes,
                source="rfid",
            )
            await svc.stock_out(req, current_user.id, actor_roles)
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
    """
    Webhook for external RFID integrations (custom iOS app using Unitech SDK).
    Authenticated with X-RFID-Api-Key header (set RFID_WEBHOOK_API_KEY in .env).
    If RFID_WEBHOOK_API_KEY is empty, endpoint is disabled.
    """
    if not settings.RFID_WEBHOOK_API_KEY:
        raise HTTPException(status_code=503, detail="RFID webhook not configured")
    if x_rfid_api_key != settings.RFID_WEBHOOK_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid RFID API key")

    matched: list[ResolvedItem] = []
    unknown: list[str] = []
    seen_item_ids: set[int] = set()

    for entry in body.epcs:
        item = await _resolve_epc(entry.epc, session)
        if item is None:
            unknown.append(entry.epc.strip().upper())
        elif item.item_id not in seen_item_ids:
            matched.append(item)
            seen_item_ids.add(item.item_id)

    return BatchScanResponse(matched=matched, unknown_epcs=unknown)


@router.get("/epc/{item_id}", response_model=EpcInfoResponse)
async def get_item_epc(
    item_id: int,
    session: DbSession,
    current_user: CurrentUser,
) -> EpcInfoResponse:
    """Return the RFID EPC stored for an item (used for tag programming)."""
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
    dependencies=[__import__("fastapi", fromlist=["Depends"]).Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
)
async def register_epc(
    body: RegisterEpcRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> EpcInfoResponse:
    """
    Register a custom EPC for an existing item.
    Use when a physical RFID tag was programmed externally (e.g. via TagAccess)
    and the EPC doesn't match what the system auto-generated.
    """
    repo = ItemRepository(session)
    item = await repo.get_with_details(body.item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    epc = body.epc.strip().upper()

    # Check EPC not already used by another item
    from sqlalchemy import select
    from app.models.item import ItemBarcode as IB
    conflict = await session.execute(
        select(IB).where(IB.barcode_value == epc, IB.item_id != body.item_id)
    )
    if conflict.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"EPC '{epc}' already registered to another item")

    # Update existing rfid_epc row or add new one
    existing = next((b for b in item.barcodes if b.barcode_type == "rfid_epc"), None)
    if existing:
        existing.barcode_value = epc
    else:
        session.add(ItemBarcode(
            item_id=body.item_id,
            barcode_type="rfid_epc",
            barcode_value=epc,
            is_primary=False,
        ))
    await session.flush()

    return EpcInfoResponse(item_id=item.id, sku=item.sku, name=item.name, epc=epc)
```

- [ ] **Step 2: Register router in `backend/app/api/router.py`**

Open `backend/app/api/router.py`. Change:
```python
from app.api.v1 import auth, items, locations, barcodes, scans, transactions, dashboard, imports, ai, users, chat, passkeys, energy
```
to:
```python
from app.api.v1 import auth, items, locations, barcodes, scans, transactions, dashboard, imports, ai, users, chat, passkeys, energy, rfid
```

And add at the end of the router registrations:
```python
api_router.include_router(rfid.router)
```

- [ ] **Step 3: Restart server and verify endpoints appear**

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

```bash
curl -s http://localhost:8000/openapi.json | python3 -c "
import sys, json
paths = json.load(sys.stdin)['paths']
rfid_paths = [p for p in paths if '/rfid/' in p]
print('\n'.join(rfid_paths))
"
```
Expected output (6 paths):
```
/api/v1/rfid/scan
/api/v1/rfid/batch-scan
/api/v1/rfid/batch-stock-in
/api/v1/rfid/batch-stock-out
/api/v1/rfid/webhook
/api/v1/rfid/epc/{item_id}
/api/v1/rfid/register-epc
```

- [ ] **Step 4: Test single EPC scan**

```bash
# Use EPC from an existing item (from Task 1 Step 4)
curl -s -X POST http://localhost:8000/api/v1/rfid/scan \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"epc":"E28011122223333344440001"}' \
  | python3 -m json.tool
```
Expected: `"found": true` with item details if item with id=1 exists and has rfid_epc barcode.

- [ ] **Step 5: Test batch scan**

```bash
curl -s -X POST http://localhost:8000/api/v1/rfid/batch-scan \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"epcs":["E28011122223333344440001","E28011122223333344440002","UNKNOWN_EPC_XYZ"]}' \
  | python3 -m json.tool
```
Expected: `"matched"` array with resolved items, `"unknown_epcs": ["UNKNOWN_EPC_XYZ"]`.

- [ ] **Step 6: Test get EPC for item**

```bash
curl -s http://localhost:8000/api/v1/rfid/epc/1 \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```
Expected: `{"item_id": 1, "sku": "...", "name": "...", "epc": "E28011122223333344440001"}`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/v1/rfid.py backend/app/api/router.py
git commit -m "feat: add RFID API endpoints (scan, batch-scan, batch-stock-in/out, webhook, register-epc)"
```

---

## Task 4: Frontend RFID API Client

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

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors related to `rfid.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/rfid.ts
git commit -m "feat: add rfid API client"
```

---

## Task 5: Frontend RFID Scan Page

**Files:**
- Create: `frontend/src/pages/RfidScan.tsx`

### Page behaviour

1. **EPC Input (HID mode):** A focused text input that the RP902 types EPCs into. After Enter (or after 24 chars are received with a 200ms debounce), the EPC is resolved via `POST /rfid/scan`. The input auto-focuses on mount and auto-clears after each scan.

2. **Scan Session List:** Each resolved item is added to a session list (card row with name, SKU, qty, status badge). Duplicate EPCs are ignored. Unknown EPCs show a red row with the raw EPC for manual lookup.

3. **Action Panel:** Appears when the session has ≥1 matched items. User selects action (Stock In / Stock Out), sets quantity, picks a location, and submits. Calls `POST /rfid/batch-stock-in` or `POST /rfid/batch-stock-out`.

4. **Clear Session:** Button resets the session list.

- [ ] **Step 1: Create `frontend/src/pages/RfidScan.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Wifi, Package, AlertCircle, CheckCircle2, Trash2, ArrowUpRight, ArrowDownRight, Loader2, Radio } from "lucide-react";
import toast from "react-hot-toast";
import { useQuery } from "@tanstack/react-query";
import { rfidApi, type ResolvedRfidItem } from "@/api/rfid";
import { itemsApi } from "@/api/items";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useThemeStore } from "@/store/theme";
import type { Location } from "@/types";

interface SessionEntry {
  epc: string;
  item: ResolvedRfidItem | null;
  selected: boolean;
}

type ActionMode = "none" | "stock_in" | "stock_out";

export function RfidScan() {
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === "dark";

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [epcInput, setEpcInput] = useState("");
  const [session, setSession] = useState<SessionEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [actionMode, setActionMode] = useState<ActionMode>("none");
  const [locationId, setLocationId] = useState<number | null>(null);
  const [quantityEach, setQuantityEach] = useState(1);
  const [actionNote, setActionNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Fetch locations for action panel
  const { data: locationData } = useQuery({
    queryKey: ["locations-flat"],
    queryFn: () => itemsApi.getLocations?.() ?? Promise.resolve([]),
    staleTime: 60_000,
  });
  const locations: Location[] = Array.isArray(locationData) ? locationData : [];

  const resolveEpc = useCallback(async (epc: string) => {
    const clean = epc.trim().toUpperCase();
    if (!clean) return;

    // Skip duplicates
    if (session.some((e) => e.epc === clean)) {
      setEpcInput("");
      inputRef.current?.focus();
      return;
    }

    setScanning(true);
    try {
      const result = await rfidApi.scanEpc(clean);
      setSession((prev) => [...prev, { epc: clean, item: result.item, selected: true }]);
      if (result.found && result.item) {
        toast.success(`Found: ${result.item.name}`, { duration: 1500 });
      } else {
        toast.error(`Unknown EPC: ${clean}`, { duration: 2000 });
      }
    } catch {
      toast.error("Scan failed");
    } finally {
      setScanning(false);
      setEpcInput("");
      inputRef.current?.focus();
    }
  }, [session]);

  const handleInputChange = (value: string) => {
    setEpcInput(value);
    // Auto-submit: 24-char hex EPC received (RP902 HID doesn't always send Enter)
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
    setSession((prev) =>
      prev.map((e) => (e.epc === epc ? { ...e, selected: !e.selected } : e))
    );
  };

  const selectedItems = session.filter((e) => e.selected && e.item !== null);
  const selectedItemIds = selectedItems.map((e) => e.item!.item_id);

  const handleBatchAction = async () => {
    if (!locationId) { toast.error("Select a location first"); return; }
    if (selectedItemIds.length === 0) { toast.error("No items selected"); return; }

    setSubmitting(true);
    try {
      const payload = {
        item_ids: selectedItemIds,
        location_id: locationId,
        quantity_each: quantityEach,
        notes: actionNote || undefined,
      };

      const results = actionMode === "stock_in"
        ? await rfidApi.batchStockIn(payload)
        : await rfidApi.batchStockOut({ ...payload, reason: actionNote || undefined });

      const failed = results.filter((r) => !r.success);
      const ok = results.filter((r) => r.success);
      if (ok.length > 0) toast.success(`${actionMode === "stock_in" ? "Stocked in" : "Stocked out"} ${ok.length} item(s)`);
      if (failed.length > 0) toast.error(`${failed.length} item(s) failed: ${failed.map((f) => f.error).join(", ")}`);

      // Remove successfully processed items from session
      const successIds = new Set(ok.map((r) => r.item_id));
      setSession((prev) => prev.filter((e) => !e.item || !successIds.has(e.item.item_id)));
      setActionMode("none");
    } catch (err) {
      toast.error("Action failed");
    } finally {
      setSubmitting(false);
    }
  };

  const glassCard = {
    background: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.75)",
    backdropFilter: "blur(12px)",
    border: "1px solid var(--border-card)",
    borderRadius: 16,
  };

  const matchedCount = session.filter((e) => e.item !== null).length;
  const unknownCount = session.filter((e) => e.item === null).length;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-2xl flex items-center justify-center"
          style={{ background: "rgba(37,99,235,0.12)", border: "1px solid rgba(37,99,235,0.3)" }}
        >
          <Radio size={20} style={{ color: "var(--accent)" }} />
        </div>
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            RFID Scan
          </h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            RP902 HID mode — scan tags, then apply actions
          </p>
        </div>
      </div>

      {/* EPC Input */}
      <div style={glassCard} className="p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Wifi size={16} style={{ color: "var(--accent)" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Scan Tags
          </span>
          <span className="text-xs ml-auto" style={{ color: "var(--text-muted)" }}>
            HID keyboard mode — focus here and scan
          </span>
        </div>
        <div className="relative">
          <input
            ref={inputRef}
            value={epcInput}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Waiting for RFID scan… (or type EPC manually)"
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
          {scanning && (
            <Loader2 size={16} className="animate-spin absolute right-3 top-3.5" style={{ color: "var(--accent)" }} />
          )}
        </div>
        <div className="flex gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
          <span className="px-2 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.12)", color: "#16a34a" }}>
            {matchedCount} matched
          </span>
          {unknownCount > 0 && (
            <span className="px-2 py-0.5 rounded-full" style={{ background: "rgba(239,68,68,0.12)", color: "#dc2626" }}>
              {unknownCount} unknown
            </span>
          )}
          {session.length > 0 && (
            <button
              onClick={() => { setSession([]); setActionMode("none"); }}
              className="ml-auto flex items-center gap-1 hover:opacity-70"
              style={{ color: "var(--text-muted)" }}
            >
              <Trash2 size={12} /> Clear session
            </button>
          )}
        </div>
      </div>

      {/* Session List */}
      {session.length > 0 && (
        <div style={glassCard} className="p-4 space-y-2">
          <p className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
            Scanned Items
          </p>
          {session.map((entry) => (
            <button
              key={entry.epc}
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
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      {entry.item.name}
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {entry.item.sku} · {entry.item.total_quantity} {entry.item.unit} in stock
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
                    <p className="text-xs font-mono truncate" style={{ color: "#dc2626" }}>
                      {entry.epc}
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>Unknown EPC — not in inventory</p>
                  </div>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Action Panel */}
      {matchedCount > 0 && (
        <div style={glassCard} className="p-5 space-y-4">
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Apply Action to {selectedItems.length} selected item(s)
          </p>

          {/* Action selector */}
          <div className="flex gap-2">
            <button
              onClick={() => setActionMode(actionMode === "stock_in" ? "none" : "stock_in")}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{
                background: actionMode === "stock_in" ? "rgba(34,197,94,0.15)" : isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.8)",
                border: actionMode === "stock_in" ? "1px solid rgba(34,197,94,0.4)" : "1px solid var(--border-card)",
                color: actionMode === "stock_in" ? "#16a34a" : "var(--text-primary)",
              }}
            >
              <ArrowUpRight size={16} /> Stock In
            </button>
            <button
              onClick={() => setActionMode(actionMode === "stock_out" ? "none" : "stock_out")}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{
                background: actionMode === "stock_out" ? "rgba(239,68,68,0.12)" : isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.8)",
                border: actionMode === "stock_out" ? "1px solid rgba(239,68,68,0.3)" : "1px solid var(--border-card)",
                color: actionMode === "stock_out" ? "#dc2626" : "var(--text-primary)",
              }}
            >
              <ArrowDownRight size={16} /> Stock Out
            </button>
          </div>

          {actionMode !== "none" && (
            <div className="space-y-3">
              {/* Location picker */}
              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--text-muted)" }}>
                  Location
                </label>
                <select
                  value={locationId ?? ""}
                  onChange={(e) => setLocationId(Number(e.target.value) || null)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm"
                  style={{
                    background: isDark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.9)",
                    border: "1px solid var(--border-card)",
                    color: "var(--text-primary)",
                  }}
                >
                  <option value="">Select location…</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name} ({loc.code})</option>
                  ))}
                </select>
              </div>

              {/* Quantity */}
              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--text-muted)" }}>
                  Quantity per item
                </label>
                <Input
                  type="number"
                  min={1}
                  value={quantityEach}
                  onChange={(e) => setQuantityEach(Number(e.target.value))}
                />
              </div>

              {/* Note */}
              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--text-muted)" }}>
                  {actionMode === "stock_out" ? "Reason (optional)" : "Notes (optional)"}
                </label>
                <Input
                  value={actionNote}
                  onChange={(e) => setActionNote(e.target.value)}
                  placeholder={actionMode === "stock_out" ? "Checkout, damaged…" : "PO reference…"}
                />
              </div>

              <Button
                onClick={handleBatchAction}
                disabled={submitting || selectedItemIds.length === 0 || !locationId}
                className="w-full"
                variant={actionMode === "stock_in" ? "primary" : "danger"}
              >
                {submitting ? (
                  <Loader2 size={16} className="animate-spin mr-2" />
                ) : actionMode === "stock_in" ? (
                  <ArrowUpRight size={16} className="mr-2" />
                ) : (
                  <ArrowDownRight size={16} className="mr-2" />
                )}
                {actionMode === "stock_in" ? "Confirm Stock In" : "Confirm Stock Out"} ({selectedItemIds.length})
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {session.length === 0 && (
        <div className="py-16 text-center space-y-3">
          <div
            className="w-16 h-16 rounded-3xl flex items-center justify-center mx-auto"
            style={{ background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", border: "1px dashed var(--border-card)" }}
          >
            <Radio size={28} style={{ color: "var(--text-muted)" }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Ready to scan
          </p>
          <p className="text-xs max-w-xs mx-auto" style={{ color: "var(--text-muted)" }}>
            Pair RP902 via Bluetooth (HID mode), keep this field focused, and pull the trigger. EPCs appear automatically.
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Check TypeScript for errors**

```bash
cd frontend
npx tsc --noEmit 2>&1 | grep -i "rfidscan\|RfidScan" | head -20
```
Fix any type errors. Common fix: `itemsApi.getLocations` may not exist — replace that query with:
```typescript
queryFn: async () => {
  const r = await apiClient.get("/locations");
  return r.data?.items ?? r.data ?? [];
},
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/RfidScan.tsx
git commit -m "feat: add RFID scan page with HID mode input and batch action panel"
```

---

## Task 6: Wire Up Route and Navigation

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Modify: `frontend/src/components/layout/MobileNav.tsx`

- [ ] **Step 1: Add route in `frontend/src/App.tsx`**

After the existing `SmartScan` lazy import:
```typescript
const RfidScan = lazy(() => import("@/pages/RfidScan").then((m) => ({ default: m.RfidScan })));
```

Inside the `<Routes>` block, after the `/smart-scan` route, add:
```tsx
<Route path="/rfid-scan" element={<Suspense fallback={<PageSpinner />}><RfidScan /></Suspense>} />
```

- [ ] **Step 2: Add RFID Scan to Sidebar**

Open `frontend/src/components/layout/Sidebar.tsx`. Add `Radio` to the icon imports:
```typescript
import {
  LayoutDashboard, Package, MapPin, QrCode,
  ClipboardList, Upload, Users,
  Beaker, BrainCircuit, Bell, LogOut, Bot, Settings, Camera, Zap, Radio,
} from "lucide-react";
```

In `navItems`, add the RFID Scan entry directly after the Smart Scan entry:
```typescript
{ to: "/smart-scan",   label: "Smart Scan",   icon: Camera,        highlight: true },
{ to: "/rfid-scan",    label: "RFID Scan",     icon: Radio,         highlight: true },
```

- [ ] **Step 3: Add RFID Scan to MobileNav**

Open `frontend/src/components/layout/MobileNav.tsx`. Add `Radio` to icon imports (same line as the existing icons). In the bottom nav items array (the small one near line 13):
```typescript
{ to: "/scan",         label: "Scan",      icon: QrCode,  highlight: true },
{ to: "/rfid-scan",    label: "RFID",      icon: Radio,   highlight: true },
{ to: "/locations",    label: "Locations", icon: MapPin },
```

Also add `/rfid-scan` to the `isHidden` path exclusion check if one exists, mirroring how `/smart-scan` is handled.

- [ ] **Step 4: Start frontend dev server and verify**

```bash
cd frontend
npm run dev
```

Navigate to `http://localhost:5173`. Verify:
- Sidebar shows "RFID Scan" entry with Radio icon between Smart Scan and AI Copilot
- Clicking it loads the `/rfid-scan` page without errors
- EPC input auto-focuses
- Typing a 24-char hex string and pressing Enter shows "Unknown EPC" toast (since no matching item in DB yet)
- Typing an EPC that exists in `item_barcodes` (from Task 1) shows the item card

- [ ] **Step 5: End-to-end manual test**

1. Start backend + frontend
2. Create an item via UI → note the auto-generated EPC in the item's barcode list (visible on item detail page barcodes section)
3. Navigate to `/rfid-scan`
4. Type the EPC in the input and press Enter
5. Item card appears in session with name, SKU, stock count
6. Click "Stock In" → select location → set qty=1 → Confirm
7. Check Transactions page — stock-in event should appear with `source: "rfid"`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/layout/Sidebar.tsx frontend/src/components/layout/MobileNav.tsx
git commit -m "feat: wire up /rfid-scan route and navigation (sidebar + mobile nav)"
```

---

## Task 7: RP902 HID Mode Setup Instructions (no code)

This task is a one-time device configuration — no code changes. Document the steps for lab users.

- [ ] **Step 1: Pair RP902 in HID keyboard mode**

1. Power on RP902 (hold power button 3s)
2. On your phone/tablet, open Bluetooth settings and pair with `RP902_i_68A1` (or your device's name)
3. In TagAccess app → tap the top-right menu → **Devices** → select `RP902_i_68A1`
4. In the TagAccess app settings → **Output Mode** → select **HID** (keyboard emulation)
   - If output mode isn't in TagAccess, switch on the device directly: hold both side buttons for 3s until LED blinks blue = HID mode

5. Open our web app on the paired device browser, navigate to `/rfid-scan`
6. Tap the EPC input field to focus it
7. Squeeze the RP902 trigger while pointing at an RFID-tagged item
8. The EPC types into the field + Enter is sent automatically → item card appears

- [ ] **Step 2: Register EPCs for existing items (backfill)**

For items created before Task 1 (no `rfid_epc` barcode row), register their programmed EPCs via:

```bash
# Example: Item ID 5 has EPC E28011122223333344440005 programmed in its tag
curl -s -X POST http://localhost:8000/api/v1/rfid/register-epc \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"item_id": 5, "epc": "E28011122223333344440005"}' \
  | python3 -m json.tool
```

Do this for each item shown in the TagAccess Inventory scan (from image 3):
- Item EPC `E28011122223333344440001` → Zebra 170 Label Printer (find its item_id in DB)
- Item EPC `E28011122223333344440002` → Ubisense Box
- Item EPC `E28011122223333344440003` → RFID Antenna
- Item EPC `E28011122223333344440004` → Brown Box
- Item EPC `E28011122223333344440005` → Black Box

---

## Self-Review Checklist

**Spec coverage:**
- [x] EPC stored in `item_barcodes` on item create → Task 1
- [x] EPC prefix matches physical labels → Task 1
- [x] Single EPC → item lookup → Task 3 `POST /rfid/scan`
- [x] Batch EPC scan (RP902 reads 5 tags simultaneously in image 3) → Task 3 `POST /rfid/batch-scan`
- [x] CRUD operations (stock-in, stock-out) via RFID scan → Tasks 3 + 5
- [x] HID keyboard mode frontend capture → Task 5 (auto-detect 24-char hex, debounce, auto-clear)
- [x] Unknown EPC handling → Task 5 (red row in session, no crash)
- [x] Webhook endpoint for future SDK integration → Task 3
- [x] Register custom EPC for existing items → Task 3 `POST /rfid/register-epc`
- [x] Navigation (Sidebar + MobileNav) → Task 6
- [x] Existing scan operations reused (`InventoryService.stock_in/out`) → Task 3 (no reimplementation)
- [x] Backfill for existing physical tags → Task 7

**Placeholder scan:** No TBDs, TODOs, or vague steps found.

**Type consistency:**
- `ResolvedRfidItem` defined in `rfid.ts` → used in `RfidScan.tsx` ✓
- `BatchActionResult` defined in `rfid.ts` → used in `rfidApi.batchStockIn/Out` ✓
- `rfidApi.batchStockIn` / `rfidApi.batchStockOut` match backend endpoint names `/rfid/batch-stock-in` / `/rfid/batch-stock-out` ✓
- `source: "rfid"` passed in `StockInRequest` / `StockOutRequest` — field exists in schema ✓
- `require_roles` import in `rfid.py` uses `__import__` hack for `Depends` — cleaner to add proper import at top of file. **Fix:** add `from fastapi import Depends` to imports in `rfid.py` and change the `dependencies` line to `dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))]`

**Fix to apply before execution:**
In `backend/app/api/v1/rfid.py`, update the imports block to include `Depends`:
```python
from fastapi import APIRouter, Depends, Header, HTTPException, status
```
And in `register_epc` endpoint signature, change:
```python
    dependencies=[__import__("fastapi", fromlist=["Depends"]).Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
```
to:
```python
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
```
