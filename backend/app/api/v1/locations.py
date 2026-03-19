from fastapi import APIRouter, Depends, HTTPException, status

from app.api.v1.auth import CurrentUser, require_roles
from app.core.database import DbSession
from app.models.location import Area, Location, LocationBarcode
from app.models.user import RoleName
from app.repositories.location_repo import AreaRepository, LocationRepository
from app.schemas.common import MessageResponse
from app.schemas.location import (
    AreaCreate,
    AreaRead,
    AreaUpdate,
    LocationCreate,
    LocationRead,
    LocationUpdate,
)

router = APIRouter(prefix="/locations", tags=["locations"])


def _model_dict(model, exclude: set[str] | None = None) -> dict:
    skip = {"_sa_instance_state"}
    if exclude:
        skip |= exclude
    return {k: v for k, v in model.__dict__.items() if k not in skip}


# ─── Areas ──────────────────────────────────────────────────────────────────

@router.get("/areas", response_model=list[AreaRead])
async def list_areas(session: DbSession, current_user: CurrentUser) -> list[AreaRead]:
    repo = AreaRepository(session)
    areas = await repo.get_all_with_locations()
    return [
        AreaRead(
            **_model_dict(area, {"locations"}),
            location_count=len(area.locations),
        )
        for area in areas
    ]


@router.post(
    "/areas",
    response_model=AreaRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
)
async def create_area(body: AreaCreate, session: DbSession, current_user: CurrentUser) -> AreaRead:
    repo = AreaRepository(session)
    if await repo.get_by_code(body.code):
        raise HTTPException(status_code=409, detail=f"Area code '{body.code}' already exists")
    area = Area(**body.model_dump())
    session.add(area)
    await session.flush()
    return AreaRead(**_model_dict(area), location_count=0)


@router.patch(
    "/areas/{area_id}",
    response_model=AreaRead,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
)
async def update_area(area_id: int, body: AreaUpdate, session: DbSession, current_user: CurrentUser) -> AreaRead:
    repo = AreaRepository(session)
    area = await repo.get_by_id(area_id)
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")
    for f, v in body.model_dump(exclude_unset=True).items():
        setattr(area, f, v)
    await session.flush()
    locs = await repo.get_all_with_locations()
    count = next((len(a.locations) for a in locs if a.id == area_id), 0)
    return AreaRead(**_model_dict(area), location_count=count)


# ─── Locations ───────────────────────────────────────────────────────────────

@router.get("", response_model=list[LocationRead])
async def list_locations(
    session: DbSession,
    current_user: CurrentUser,
    area_id: int | None = None,
) -> list[LocationRead]:
    repo = LocationRepository(session)
    if area_id:
        locs = await repo.get_by_area(area_id)
    else:
        locs = await repo.get_all()

    result = []
    for loc in locs:
        loc_with_area = await repo.get_with_area(loc.id)
        if loc_with_area:
            result.append(LocationRead(
                **_model_dict(loc_with_area, {"area", "barcodes"}),
                area_code=loc_with_area.area.code if loc_with_area.area else "",
                area_name=loc_with_area.area.name if loc_with_area.area else "",
                barcodes=[],
                item_count=0,
            ))
    return result


@router.post(
    "",
    response_model=LocationRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
)
async def create_location(body: LocationCreate, session: DbSession, current_user: CurrentUser) -> LocationRead:
    repo = LocationRepository(session)
    if await repo.get_by_code(body.code):
        raise HTTPException(status_code=409, detail=f"Location code '{body.code}' already exists")

    from app.services.barcode_service import render_qr_png
    loc = Location(**body.model_dump())
    session.add(loc)
    await session.flush()

    barcode_val = f"LOC:{loc.code.upper()}"
    qr_bytes = render_qr_png(barcode_val)
    bc = LocationBarcode(
        location_id=loc.id,
        barcode_value=barcode_val,
        barcode_type="qr",
        qr_image=qr_bytes,
    )
    session.add(bc)
    await session.flush()

    loc_with_area = await repo.get_with_area(loc.id)
    return LocationRead(
        **_model_dict(loc, {"barcodes"}),
        area_code=loc_with_area.area.code if loc_with_area and loc_with_area.area else "",
        area_name=loc_with_area.area.name if loc_with_area and loc_with_area.area else "",
        barcodes=[],
        item_count=0,
    )


@router.patch(
    "/{location_id}",
    response_model=LocationRead,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
)
async def update_location(
    location_id: int, body: LocationUpdate, session: DbSession, current_user: CurrentUser
) -> LocationRead:
    repo = LocationRepository(session)
    loc = await repo.get_with_area(location_id)
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    for f, v in body.model_dump(exclude_unset=True).items():
        setattr(loc, f, v)
    await session.flush()
    return LocationRead(
        **_model_dict(loc, {"area", "barcodes"}),
        area_code=loc.area.code if loc.area else "",
        area_name=loc.area.name if loc.area else "",
        barcodes=[],
        item_count=0,
    )


@router.get("/{location_id}", response_model=LocationRead)
async def get_location(location_id: int, session: DbSession, current_user: CurrentUser) -> LocationRead:
    repo = LocationRepository(session)
    loc = await repo.get_with_area(location_id)
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    return LocationRead(
        **_model_dict(loc, {"area", "barcodes"}),
        area_code=loc.area.code if loc.area else "",
        area_name=loc.area.name if loc.area else "",
        barcodes=[bc.__dict__ for bc in loc.barcodes],
        item_count=0,
    )
