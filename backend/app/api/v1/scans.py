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
from app.core.events import DomainEvent, EventType, event_bus
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
      qty at scanned location > 0              → stock_out
      qty at scanned location = 0, no stock anywhere → stock_in
      qty at scanned location = 0, stock elsewhere   → transfer

    dry_run=True  → preview only, no write
    dry_run=False → execute atomically
    """
    from app.repositories.transaction_repo import StockLevelRepository

    stock_repo = StockLevelRepository(session)
    svc = InventoryService(session)
    actor_roles = [ur.role.name for ur in current_user.roles if ur.role]

    all_levels = await stock_repo.list_by_item(body.item_id)
    target = next((l for l in all_levels if l.location_id == body.location_id), None)
    target_qty = int(target.quantity) if target else 0
    other_sources = [l for l in all_levels if l.location_id != body.location_id and int(l.quantity) > 0]
    qty = int(body.quantity)

    if target_qty > 0:
        action = "stock_out"
    elif not other_sources:
        action = "stock_in"
    else:
        action = "transfer"

    # ── stock_out ─────────────────────────────────────────────────────────────
    if action == "stock_out":
        new_qty = max(0, target_qty - qty)
        if body.dry_run:
            return SmartApplyResponse(action="stock_out", previous_quantity=target_qty, new_quantity=new_qty)
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
            action="stock_out", previous_quantity=target_qty, new_quantity=new_qty,
            event=_event_to_read(event, session),
        )

    # ── stock_in ──────────────────────────────────────────────────────────────
    if action == "stock_in":
        new_qty = target_qty + qty
        if body.dry_run:
            return SmartApplyResponse(action="stock_in", previous_quantity=target_qty, new_quantity=new_qty)
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
            action="stock_in", previous_quantity=target_qty, new_quantity=new_qty,
            event=_event_to_read(event, session),
        )

    # ── transfer ──────────────────────────────────────────────────────────────
    candidates = [
        CandidateSource(
            location_id=l.location_id,
            location_name=l.location.name if l.location else f"Loc {l.location_id}",
            location_code=l.location.code if l.location else "",
            quantity=int(l.quantity),
        )
        for l in other_sources
    ]

    chosen_source_id = body.source_location_id
    if chosen_source_id is None and len(candidates) == 1:
        chosen_source_id = candidates[0].location_id

    if chosen_source_id is None:
        if body.dry_run:
            return SmartApplyResponse(
                action="transfer", previous_quantity=target_qty, new_quantity=target_qty,
                requires_source_selection=True, candidate_sources=candidates,
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="source_location_id is required for transfer when multiple sources exist",
        )

    chosen = next((c for c in candidates if c.location_id == chosen_source_id), None)
    if chosen is None or chosen.quantity < qty:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Source location does not have sufficient stock (have {chosen.quantity if chosen else 0}, need {qty})",
        )

    new_qty = target_qty + qty
    if body.dry_run:
        return SmartApplyResponse(
            action="transfer", previous_quantity=target_qty, new_quantity=new_qty,
            source_location_id=chosen.location_id, source_location_name=chosen.location_name,
            candidate_sources=candidates,
        )

    req = TransferRequest(
        item_id=body.item_id,
        from_location_id=chosen.location_id,
        to_location_id=body.location_id,
        quantity=body.quantity,
        notes=body.notes,
        scan_session_id=body.scan_session_id,
    )
    event = await svc.transfer(req, current_user.id)
    await session.refresh(event, ["item", "from_location", "to_location", "actor"])
    return SmartApplyResponse(
        action="transfer", previous_quantity=target_qty, new_quantity=new_qty,
        source_location_id=chosen.location_id, source_location_name=chosen.location_name,
        event=_event_to_read(event, session),
    )


class ModifyItemRequest(BaseModel):
    item_id: int
    name: str | None = None
    description: str | None = None
    category_id: int | None = None
    unit: str | None = None
    unit_cost: float | None = None
    reorder_level: float | None = None
    supplier: str | None = None
    notes: str | None = None


class ModifyItemResponse(BaseModel):
    id: int
    sku: str
    name: str
    unit: str
    category_id: int | None
    unit_cost: float
    reorder_level: float
    supplier: str | None
    description: str | None
    notes: str | None


@router.post("/modify-item", response_model=ModifyItemResponse)
async def modify_item_by_scan(
    body: ModifyItemRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ModifyItemResponse:
    """Update item details via scan workflow."""
    from app.repositories.item_repo import ItemRepository
    repo = ItemRepository(session)
    item = await repo.get_by_id(body.item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    update_data = body.model_dump(exclude={"item_id"}, exclude_none=True)
    for field, value in update_data.items():
        setattr(item, field, value)
    await session.flush()
    await session.refresh(item)

    await event_bus.publish(DomainEvent(
        event_type=EventType.ITEM_UPDATED,
        payload={
            "item_id": item.id,
            "sku": item.sku,
            "source": "scan.modify_item",
            "fields": list(update_data.keys()),
        },
        actor_id=current_user.id,
    ))

    return ModifyItemResponse(
        id=item.id,
        sku=item.sku,
        name=item.name,
        unit=item.unit,
        category_id=item.category_id,
        unit_cost=float(item.unit_cost),
        reorder_level=float(item.reorder_level),
        supplier=item.supplier,
        description=item.description,
        notes=item.notes,
    )
