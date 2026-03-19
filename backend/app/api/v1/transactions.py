from datetime import datetime

from fastapi import APIRouter, Query

from app.api.v1.auth import CurrentUser
from app.core.database import DbSession
from app.repositories.transaction_repo import AlertRepository, InventoryEventRepository
from app.schemas.common import PaginatedResponse
from app.schemas.transaction import AlertRead, InventoryEventRead

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _to_read(event) -> InventoryEventRead:
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


@router.get("", response_model=PaginatedResponse[InventoryEventRead])
async def list_transactions(
    session: DbSession,
    current_user: CurrentUser,
    item_id: int | None = None,
    location_id: int | None = None,
    event_kind: str | None = None,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> PaginatedResponse[InventoryEventRead]:
    repo = InventoryEventRepository(session)
    skip = (page - 1) * page_size
    events, total = await repo.get_events_paginated(
        item_id=item_id,
        location_id=location_id,
        event_kind=event_kind,
        start_date=start_date,
        end_date=end_date,
        skip=skip,
        limit=page_size,
    )
    return PaginatedResponse(
        items=[_to_read(e) for e in events],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size,
    )


@router.get("/alerts", response_model=list[AlertRead])
async def list_alerts(
    session: DbSession,
    current_user: CurrentUser,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
) -> list[AlertRead]:
    repo = AlertRepository(session)
    skip = (page - 1) * page_size
    alerts = await repo.get_active_alerts(skip=skip, limit=page_size)
    return [
        AlertRead(
            id=a.id,
            item_id=a.item_id,
            alert_type=a.alert_type,
            severity=a.severity,
            message=a.message,
            is_resolved=a.is_resolved,
            created_at=a.created_at,
        )
        for a in alerts
    ]


@router.patch("/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: int, session: DbSession, current_user: CurrentUser) -> AlertRead:
    from datetime import datetime, timezone
    repo = AlertRepository(session)
    alert = await repo.get_by_id(alert_id)
    if not alert:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.is_resolved = True
    alert.resolved_by = current_user.id
    alert.resolved_at = datetime.now(timezone.utc)
    await session.flush()
    return AlertRead(
        id=alert.id,
        item_id=alert.item_id,
        alert_type=alert.alert_type,
        severity=alert.severity,
        message=alert.message,
        is_resolved=alert.is_resolved,
        created_at=alert.created_at,
    )
