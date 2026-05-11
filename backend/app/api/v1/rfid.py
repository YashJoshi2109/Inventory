"""
RFID integration — Unitech RP902 UHF Bluetooth reader (HID keyboard mode).

Flow:
  1. RP902 paired to device via Bluetooth (HID mode — acts as wireless keyboard).
  2. User opens /rfid-scan page in browser, EPC input is focused.
  3. Pulling RP902 trigger types the 24-char hex EPC + Enter into the input.
  4. Frontend POSTs to POST /rfid/scan → item resolved via scan_service.
  5. User selects action (stock-in / stock-out) → POST /rfid/batch-stock-in|out.
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


# ── Helper ────────────────────────────────────────────────────────────────────

async def _resolve_epc(epc: str, session: DbSession) -> ResolvedRfidItem | None:
    result = await ScanService(session).resolve(epc.strip().upper())
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
    """Resolve a single EPC to an inventory item (called per RP902 HID scan)."""
    epc = body.epc.strip().upper()
    item = await _resolve_epc(epc, session)
    return EpcScanResponse(found=item is not None, epc=epc, item=item)


@router.post("/batch-scan", response_model=BatchScanResponse)
async def scan_batch_epcs(
    body: BatchScanRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> BatchScanResponse:
    """Resolve a list of EPCs — matched items + unknown EPCs returned separately."""
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
    """Stock in multiple items from one RFID scan session."""
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
    """Stock out multiple items from one RFID scan session."""
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
    """Webhook for future external integrations. Requires RFID_WEBHOOK_API_KEY in .env."""
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
    """Return the RFID EPC for an item — used when programming a new RFID tag via TagAccess."""
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
    """
    Register a custom EPC for an existing item.
    Use when an RFID tag was programmed externally via TagAccess with a different EPC
    than the system auto-generated (e.g. the 5 existing lab tags).
    """
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
        session.add(ItemBarcode(
            item_id=body.item_id,
            barcode_type="rfid_epc",
            barcode_value=epc,
            is_primary=False,
        ))
    await session.flush()
    return EpcInfoResponse(item_id=item.id, sku=item.sku, name=item.name, epc=epc)
