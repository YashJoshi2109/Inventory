"""
Sandbox management endpoints.
Only mounted when SANDBOX_MODE=true (set via env var on sandbox Cloud Run).
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select, text

from app.api.v1.auth import CurrentUser, require_roles
from app.core.config import settings
from app.core.database import DbSession
from app.models.user import RoleName
from app.repositories.user_repo import UserRepository
from app.services.sandbox_seed import seed_user_energy, seed_user_sandbox

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sandbox", tags=["sandbox"])


class SeedStatusResponse(BaseModel):
    seeded: bool
    item_count: int
    event_count: int
    location_count: int


@router.post("/seed", response_model=SeedStatusResponse)
async def seed_sandbox(session: DbSession, current_user: CurrentUser) -> SeedStatusResponse:
    """Idempotent: seeds inventory + energy data for the calling user. Safe to call multiple times."""
    if not settings.SANDBOX_MODE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not in sandbox mode")

    if not current_user.sandbox_seeded:
        await seed_user_sandbox(session, current_user)
        await seed_user_energy(session, current_user)
        await session.commit()
        logger.info("Sandbox seeded for user %d", current_user.id)

    from app.models.item import Item
    from app.models.location import Location
    from app.models.transaction import InventoryEvent

    item_count = (await session.execute(
        select(func.count()).select_from(Item).where(Item.owner_id == current_user.id)
    )).scalar_one()
    event_count = (await session.execute(
        select(func.count()).select_from(InventoryEvent).where(InventoryEvent.actor_id == current_user.id)
    )).scalar_one()
    location_count = (await session.execute(
        select(func.count()).select_from(Location).where(Location.owner_id == current_user.id)
    )).scalar_one()

    return SeedStatusResponse(
        seeded=True,
        item_count=item_count,
        event_count=event_count,
        location_count=location_count,
    )


@router.post(
    "/reset",
    response_model=SeedStatusResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN))],
)
async def reset_sandbox(
    session: DbSession,
    current_user: CurrentUser,
    target_user_id: int,
) -> SeedStatusResponse:
    """Superadmin: wipe and re-seed one user's sandbox data."""
    if not settings.SANDBOX_MODE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not in sandbox mode")

    user_repo = UserRepository(session)
    target_user = await user_repo.get_by_id(target_user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    from app.models.item import Category, Item
    from app.models.location import Area, Location
    from app.models.transaction import Alert, InventoryEvent, StockLevel

    uid = target_user_id
    # Delete in FK-safe order: alerts/stock → events → items/cats → locations → areas
    for tbl in ("alerts", "stock_levels"):
        await session.execute(
            text(f"DELETE FROM {tbl} WHERE item_id IN (SELECT id FROM items WHERE owner_id = :uid)"),
            {"uid": uid},
        )
    await session.execute(text("DELETE FROM inventory_events WHERE actor_id = :uid"), {"uid": uid})
    await session.execute(text("DELETE FROM items WHERE owner_id = :uid"), {"uid": uid})
    await session.execute(text("DELETE FROM categories WHERE owner_id = :uid"), {"uid": uid})
    await session.execute(text("DELETE FROM locations WHERE owner_id = :uid"), {"uid": uid})
    await session.execute(text("DELETE FROM areas WHERE owner_id = :uid"), {"uid": uid})
    await session.execute(text("DELETE FROM energy_readings WHERE owner_id = :uid"), {"uid": uid})

    target_user.sandbox_seeded = False
    session.add(target_user)
    await session.flush()

    await seed_user_sandbox(session, target_user)
    await seed_user_energy(session, target_user)
    await session.commit()

    return SeedStatusResponse(seeded=True, item_count=30, event_count=50, location_count=8)


@router.get("/status", response_model=SeedStatusResponse)
async def sandbox_status(session: DbSession, current_user: CurrentUser) -> SeedStatusResponse:
    """Returns seed state for calling user."""
    if not settings.SANDBOX_MODE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not in sandbox mode")

    from app.models.item import Item
    from app.models.location import Location
    from app.models.transaction import InventoryEvent

    item_count = (await session.execute(
        select(func.count()).select_from(Item).where(Item.owner_id == current_user.id)
    )).scalar_one()
    event_count = (await session.execute(
        select(func.count()).select_from(InventoryEvent).where(InventoryEvent.actor_id == current_user.id)
    )).scalar_one()
    location_count = (await session.execute(
        select(func.count()).select_from(Location).where(Location.owner_id == current_user.id)
    )).scalar_one()

    return SeedStatusResponse(
        seeded=current_user.sandbox_seeded,
        item_count=item_count,
        event_count=event_count,
        location_count=location_count,
    )
