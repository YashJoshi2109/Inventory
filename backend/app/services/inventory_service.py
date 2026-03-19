"""
Core inventory business logic — stock-in, stock-out, transfer, adjustment.

This service is the single authoritative source for all balance mutations.
Every operation:
  1. validates business rules
  2. creates an InventoryEvent (immutable ledger)
  3. updates StockLevel (materialised balance)
  4. publishes a domain event
"""
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import DomainEvent, EventType, event_bus
from app.models.transaction import InventoryEvent, EventKind
from app.models.user import RoleName
from app.repositories.item_repo import ItemRepository
from app.repositories.location_repo import LocationRepository
from app.repositories.transaction_repo import InventoryEventRepository, StockLevelRepository
from app.schemas.transaction import (
    AdjustmentRequest,
    BarcodeScanApplyRequest,
    StockInRequest,
    StockOutRequest,
    TransferRequest,
)
from app.services.scan_service import ScanService


class InventoryService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._item_repo = ItemRepository(session)
        self._loc_repo = LocationRepository(session)
        self._event_repo = InventoryEventRepository(session)
        self._stock_repo = StockLevelRepository(session)

    async def stock_in(self, req: StockInRequest, actor_id: int) -> InventoryEvent:
        item = await self._item_repo.get_by_id(req.item_id)
        if not item or not item.is_active:
            raise HTTPException(status_code=404, detail="Item not found")

        location = await self._loc_repo.get_with_area(req.location_id)
        if not location or not location.is_active:
            raise HTTPException(status_code=404, detail="Location not found")

        event = InventoryEvent(
            event_kind=EventKind.STOCK_IN,
            item_id=item.id,
            to_location_id=location.id,
            quantity=req.quantity,
            unit_cost_snapshot=req.unit_cost or item.unit_cost,
            reference=req.reference,
            notes=req.notes,
            actor_id=actor_id,
            source=req.source,
            scan_session_id=req.scan_session_id,
        )
        self._session.add(event)
        await self._stock_repo.upsert(item.id, location.id, req.quantity)
        await self._session.flush()

        await event_bus.publish(DomainEvent(
            event_type=EventType.STOCK_IN,
            payload={"item_id": item.id, "location_id": location.id, "quantity": float(req.quantity)},
            actor_id=actor_id,
        ))
        return event

    async def stock_out(
        self, req: StockOutRequest, actor_id: int, actor_roles: list[str]
    ) -> InventoryEvent:
        item = await self._item_repo.get_by_id(req.item_id)
        if not item or not item.is_active:
            raise HTTPException(status_code=404, detail="Item not found")

        location = await self._loc_repo.get_with_area(req.location_id)
        if not location or not location.is_active:
            raise HTTPException(status_code=404, detail="Location not found")

        current_stock = await self._stock_repo.get_total_for_item(item.id)
        if current_stock < req.quantity:
            if not req.override_negative:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "INSUFFICIENT_STOCK",
                        "available": float(current_stock),
                        "requested": float(req.quantity),
                        "message": "Insufficient stock. Set override_negative=true to proceed (requires Manager role).",
                    },
                )
            # Override requires elevated role
            can_override = RoleName.ADMIN in actor_roles or RoleName.MANAGER in actor_roles
            if not can_override:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Negative stock override requires Manager or Admin role",
                )

        event = InventoryEvent(
            event_kind=EventKind.STOCK_OUT,
            item_id=item.id,
            from_location_id=location.id,
            quantity=req.quantity,
            unit_cost_snapshot=item.unit_cost,
            reference=req.reference,
            borrower=req.borrower,
            notes=req.notes,
            reason=req.reason,
            requires_override=req.override_negative and current_stock < req.quantity,
            override_approved_by=actor_id if req.override_negative and current_stock < req.quantity else None,
            actor_id=actor_id,
            source=req.source,
            scan_session_id=req.scan_session_id,
        )
        self._session.add(event)
        await self._stock_repo.upsert(item.id, location.id, -req.quantity)
        await self._session.flush()

        await event_bus.publish(DomainEvent(
            event_type=EventType.STOCK_OUT,
            payload={"item_id": item.id, "location_id": location.id, "quantity": float(req.quantity)},
            actor_id=actor_id,
        ))
        return event

    async def transfer(self, req: TransferRequest, actor_id: int) -> InventoryEvent:
        item = await self._item_repo.get_by_id(req.item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Item not found")

        src = await self._loc_repo.get_with_area(req.from_location_id)
        dst = await self._loc_repo.get_with_area(req.to_location_id)

        if not src or not src.is_active:
            raise HTTPException(status_code=404, detail="Source location not found")
        if not dst or not dst.is_active:
            raise HTTPException(status_code=404, detail="Destination location not found")

        # Validate stock at source
        src_stock = await self._stock_repo.get_by_item_location(item.id, src.id)
        if not src_stock or src_stock.quantity < req.quantity:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Only {src_stock.quantity if src_stock else 0} available at source location",
            )

        event = InventoryEvent(
            event_kind=EventKind.TRANSFER,
            item_id=item.id,
            from_location_id=src.id,
            to_location_id=dst.id,
            quantity=req.quantity,
            unit_cost_snapshot=item.unit_cost,
            reference=req.reference,
            notes=req.notes,
            actor_id=actor_id,
            source="scan",
            scan_session_id=req.scan_session_id,
        )
        self._session.add(event)
        await self._stock_repo.upsert(item.id, src.id, -req.quantity)
        await self._stock_repo.upsert(item.id, dst.id, req.quantity)
        await self._session.flush()

        await event_bus.publish(DomainEvent(
            event_type=EventType.TRANSFER,
            payload={
                "item_id": item.id,
                "from_location_id": src.id,
                "to_location_id": dst.id,
                "quantity": float(req.quantity),
            },
            actor_id=actor_id,
        ))
        return event

    async def adjustment(self, req: AdjustmentRequest, actor_id: int) -> InventoryEvent:
        """Cycle count correction — sets absolute quantity at a location."""
        item = await self._item_repo.get_by_id(req.item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Item not found")

        sl = await self._stock_repo.get_by_item_location(req.item_id, req.location_id)
        current = sl.quantity if sl else Decimal("0")
        delta = req.new_quantity - current

        event = InventoryEvent(
            event_kind=EventKind.ADJUSTMENT,
            item_id=item.id,
            to_location_id=req.location_id if delta >= 0 else None,
            from_location_id=req.location_id if delta < 0 else None,
            quantity=abs(delta),
            unit_cost_snapshot=item.unit_cost,
            reason=req.reason,
            notes=req.notes,
            actor_id=actor_id,
            source="manual",
        )
        self._session.add(event)
        if sl:
            sl.quantity = req.new_quantity
        else:
            await self._stock_repo.upsert(item.id, req.location_id, req.new_quantity)
        await self._session.flush()
        return event

    async def apply_barcode_scan(
        self,
        req: BarcodeScanApplyRequest,
        actor_id: int,
        actor_roles: list[str],
    ) -> InventoryEvent:
        """Resolve barcodes and route to stock-in/out/transfer operations."""
        scan_service = ScanService(self._session)

        item_result = await scan_service.resolve(req.item_barcode)
        if item_result.result_type != "item" or item_result.id is None:
            raise HTTPException(status_code=404, detail=f"Item barcode not found: {req.item_barcode}")

        rack_result = await scan_service.resolve(req.rack_barcode)
        if rack_result.result_type != "location" or rack_result.id is None:
            raise HTTPException(status_code=404, detail=f"Rack barcode not found: {req.rack_barcode}")

        if req.event_type == "stock_in":
            return await self.stock_in(
                StockInRequest(
                    item_id=item_result.id,
                    location_id=rack_result.id,
                    quantity=req.quantity,
                    reference=req.reference,
                    notes=req.notes,
                    scan_session_id=req.scan_session_id,
                    source=req.source,
                ),
                actor_id,
            )

        if req.event_type == "stock_out":
            return await self.stock_out(
                StockOutRequest(
                    item_id=item_result.id,
                    location_id=rack_result.id,
                    quantity=req.quantity,
                    reason=req.reason,
                    reference=req.reference,
                    borrower=req.borrower,
                    notes=req.notes,
                    override_negative=req.override_negative,
                    scan_session_id=req.scan_session_id,
                    source=req.source,
                ),
                actor_id,
                actor_roles,
            )

        dest_result = await scan_service.resolve(req.destination_rack_barcode or "")
        if dest_result.result_type != "location" or dest_result.id is None:
            raise HTTPException(
                status_code=404,
                detail=f"Destination rack barcode not found: {req.destination_rack_barcode}",
            )

        return await self.transfer(
            TransferRequest(
                item_id=item_result.id,
                from_location_id=rack_result.id,
                to_location_id=dest_result.id,
                quantity=req.quantity,
                reference=req.reference,
                notes=req.notes,
                scan_session_id=req.scan_session_id,
            ),
            actor_id,
        )
