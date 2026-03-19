"""
Scan workflow API.

The scan endpoints power the mobile-first scan flows:
  1. Stock-In:   POST /scans/stock-in
  2. Stock-Out:  POST /scans/stock-out
  3. Transfer:   POST /scans/transfer
  4. Adjustment: POST /scans/adjustment
  5. Lookup:     POST /scans/lookup  (resolve barcode to item or location)

All writes are idempotent when scan_session_id is provided.
The frontend groups events by scan_session_id for undo / review.
"""
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.v1.auth import CurrentUser
from app.core.database import DbSession
from app.schemas.transaction import (
    AdjustmentRequest,
    BarcodeScanApplyRequest,
    InventoryEventRead,
    ScanLookupRequest,
    StockInRequest,
    StockOutRequest,
    TransferRequest,
)
from app.services.inventory_service import InventoryService
from app.services.scan_service import ScanResult, ScanService

router = APIRouter(prefix="/scans", tags=["scans"])


class ScanLookupResponse(BaseModel):
    result_type: str
    id: int | None
    code: str
    name: str
    details: dict


def _event_to_read(event, session) -> InventoryEventRead:
    return InventoryEventRead(
        id=event.id,
        occurred_at=event.occurred_at,
        event_kind=event.event_kind,
        item_id=event.item_id,
        item_sku=event.item.sku if event.item else "",
        item_name=event.item.name if event.item else "",
        from_location_id=event.from_location_id,
        from_location_code=event.from_location.code if event.from_location else None,
        to_location_id=event.to_location_id,
        to_location_code=event.to_location.code if event.to_location else None,
        quantity=event.quantity,
        reference=event.reference,
        borrower=event.borrower,
        notes=event.notes,
        reason=event.reason,
        actor_username=event.actor.username if event.actor else None,
        source=event.source,
    )


@router.post("/lookup", response_model=ScanLookupResponse)
async def lookup_barcode(body: ScanLookupRequest, session: DbSession, current_user: CurrentUser) -> ScanLookupResponse:
    svc = ScanService(session)
    result: ScanResult = await svc.resolve(body.barcode_value)
    return ScanLookupResponse(
        result_type=result.result_type,
        id=result.id,
        code=result.code,
        name=result.name,
        details=result.details,
    )


@router.post(
    "/stock-in",
    response_model=InventoryEventRead,
    status_code=status.HTTP_201_CREATED,
)
async def stock_in(body: StockInRequest, session: DbSession, current_user: CurrentUser) -> InventoryEventRead:
    svc = InventoryService(session)
    event = await svc.stock_in(body, current_user.id)
    await session.refresh(event, ["item", "to_location", "actor"])
    return _event_to_read(event, session)


@router.post(
    "/stock-out",
    response_model=InventoryEventRead,
    status_code=status.HTTP_201_CREATED,
)
async def stock_out(body: StockOutRequest, session: DbSession, current_user: CurrentUser) -> InventoryEventRead:
    svc = InventoryService(session)
    actor_roles = [ur.role.name for ur in current_user.roles if ur.role]
    event = await svc.stock_out(body, current_user.id, actor_roles)
    await session.refresh(event, ["item", "from_location", "actor"])
    return _event_to_read(event, session)


@router.post(
    "/transfer",
    response_model=InventoryEventRead,
    status_code=status.HTTP_201_CREATED,
)
async def transfer(body: TransferRequest, session: DbSession, current_user: CurrentUser) -> InventoryEventRead:
    svc = InventoryService(session)
    event = await svc.transfer(body, current_user.id)
    await session.refresh(event, ["item", "from_location", "to_location", "actor"])
    return _event_to_read(event, session)


@router.post(
    "/adjustment",
    response_model=InventoryEventRead,
    status_code=status.HTTP_201_CREATED,
)
async def adjustment(body: AdjustmentRequest, session: DbSession, current_user: CurrentUser) -> InventoryEventRead:
    svc = InventoryService(session)
    event = await svc.adjustment(body, current_user.id)
    await session.refresh(event, ["item", "to_location", "actor"])
    return _event_to_read(event, session)


@router.post(
    "/apply",
    response_model=InventoryEventRead,
    status_code=status.HTTP_201_CREATED,
)
async def apply_scan_event(
    body: BarcodeScanApplyRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> InventoryEventRead:
    svc = InventoryService(session)
    actor_roles = [ur.role.name for ur in current_user.roles if ur.role]
    event = await svc.apply_barcode_scan(body, current_user.id, actor_roles)
    await session.refresh(event, ["item", "from_location", "to_location", "actor"])
    return _event_to_read(event, session)
