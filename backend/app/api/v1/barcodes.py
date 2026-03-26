from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.api.v1.auth import CurrentUser
from app.core.database import DbSession
from app.core.notifications import send_item_qr_email
from app.repositories.item_repo import ItemRepository
from app.repositories.location_repo import LocationRepository
from app.services.barcode_service import (
    generate_label_sheet_pdf,
    render_qr_png,
    render_qr_svg,
)
from app.schemas.common import MessageResponse

router = APIRouter(prefix="/barcodes", tags=["barcodes"])


@router.get("/item/{item_id}/qr/png")
async def item_qr_png(item_id: int, session: DbSession, current_user: CurrentUser) -> Response:
    repo = ItemRepository(session)
    item = await repo.get_with_details(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    primary = next((b for b in item.barcodes if b.is_primary), None)
    if primary and primary.qr_image:
        return Response(content=primary.qr_image, media_type="image/png")
    png_bytes = render_qr_png(item.sku)
    return Response(content=png_bytes, media_type="image/png")


@router.post("/item/{item_id}/qr/send-email", response_model=MessageResponse)
async def item_qr_send_email(item_id: int, session: DbSession, current_user: CurrentUser) -> MessageResponse:
    repo = ItemRepository(session)
    item = await repo.get_with_details(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if not current_user.email:
        return MessageResponse(message="Your account has no email configured.", success=False)

    primary = next((b for b in item.barcodes if b.is_primary), None)
    if primary and primary.qr_image:
        png_bytes = primary.qr_image
    else:
        png_bytes = render_qr_png(item.sku)

    ok, email_msg = await send_item_qr_email(
        to_email=current_user.email,
        item_sku=item.sku,
        item_name=item.name,
        qr_png=png_bytes,
    )
    if ok:
        return MessageResponse(message=email_msg, success=True)
    return MessageResponse(message=email_msg, success=False)


@router.get("/item/{item_id}/png")
async def item_barcode_png(item_id: int, session: DbSession, current_user: CurrentUser) -> Response:
    """Alias for QR PNG — we use QR-only workflow."""
    return await item_qr_png(item_id, session, current_user)


@router.get("/location/{location_id}/qr/png")
async def location_qr_png(location_id: int, session: DbSession, current_user: CurrentUser) -> Response:
    repo = LocationRepository(session)
    loc = await repo.get_by_id(location_id)
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    # Load barcodes relationship
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.models.location import Location
    result = await session.execute(
        select(Location).where(Location.id == location_id).options(selectinload(Location.barcodes))
    )
    loc_full = result.scalar_one_or_none()
    if loc_full and loc_full.barcodes:
        primary = loc_full.barcodes[0]
        if primary.qr_image:
            return Response(content=primary.qr_image, media_type="image/png")
    png_bytes = render_qr_png(f"LOC:{loc.code.upper()}")
    return Response(content=png_bytes, media_type="image/png")


@router.get("/location/{location_id}/qr/svg")
async def location_qr_svg(location_id: int, session: DbSession, current_user: CurrentUser) -> Response:
    repo = LocationRepository(session)
    loc = await repo.get_by_id(location_id)
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    svg_bytes = render_qr_svg(f"LOC:{loc.code.upper()}")
    return Response(content=svg_bytes, media_type="image/svg+xml")


@router.post("/labels/print")
async def print_label_sheet(
    item_ids: list[int],
    session: DbSession,
    current_user: CurrentUser,
) -> Response:
    """Generate an Avery 5160 compatible PDF label sheet for the given item IDs."""
    repo = ItemRepository(session)
    labels = []
    for item_id in item_ids[:30]:
        item = await repo.get_with_details(item_id)
        if item:
            primary = next((b for b in item.barcodes if b.is_primary), None)
            qr_blob = primary.qr_image if primary else None
            labels.append({
                "title": item.name[:30],
                "barcode_value": primary.barcode_value if primary else item.sku,
                "subtitle": f"{item.sku} | {item.category.name if item.category else ''}",
                "qr_blob": qr_blob,
            })

    pdf_bytes = generate_label_sheet_pdf(labels)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=labels.pdf"},
    )
