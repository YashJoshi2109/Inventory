from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.api.v1.auth import CurrentUser
from app.core.database import DbSession
from app.repositories.item_repo import ItemRepository
from app.repositories.location_repo import LocationRepository
from app.services.barcode_service import (
    generate_label_sheet_pdf,
    render_barcode_png,
    render_qr_png,
    render_qr_svg,
)

router = APIRouter(prefix="/barcodes", tags=["barcodes"])


@router.get("/item/{item_id}/png")
async def item_barcode_png(item_id: int, session: DbSession, current_user: CurrentUser) -> Response:
    repo = ItemRepository(session)
    item = await repo.get_with_details(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    primary = next((b for b in item.barcodes if b.is_primary), None)
    value = primary.barcode_value if primary else item.sku
    png_bytes = render_barcode_png(value)
    return Response(content=png_bytes, media_type="image/png")


@router.get("/item/{item_id}/qr/png")
async def item_qr_png(item_id: int, session: DbSession, current_user: CurrentUser) -> Response:
    repo = ItemRepository(session)
    item = await repo.get_by_id(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    png_bytes = render_qr_png(item.sku)
    return Response(content=png_bytes, media_type="image/png")


@router.get("/location/{location_id}/qr/svg")
async def location_qr_svg(location_id: int, session: DbSession, current_user: CurrentUser) -> Response:
    repo = LocationRepository(session)
    loc = await repo.get_by_id(location_id)
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    svg_bytes = render_qr_svg(f"LOC:{loc.code.upper()}")
    return Response(content=svg_bytes, media_type="image/svg+xml")


@router.get("/location/{location_id}/qr/png")
async def location_qr_png(location_id: int, session: DbSession, current_user: CurrentUser) -> Response:
    repo = LocationRepository(session)
    loc = await repo.get_by_id(location_id)
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    png_bytes = render_qr_png(f"LOC:{loc.code.upper()}")
    return Response(content=png_bytes, media_type="image/png")


@router.post("/labels/print")
async def print_label_sheet(
    item_ids: list[int],
    session: DbSession,
    current_user: CurrentUser,
) -> Response:
    """Generate an Avery 5160 compatible PDF label sheet for the given item IDs."""
    repo = ItemRepository(session)
    labels = []
    for item_id in item_ids[:30]:  # Max 30 labels per sheet
        item = await repo.get_with_details(item_id)
        if item:
            primary = next((b for b in item.barcodes if b.is_primary), None)
            labels.append({
                "title": item.name[:30],
                "barcode_value": primary.barcode_value if primary else item.sku,
                "subtitle": f"{item.sku} | {item.category.name if item.category else ''}",
            })

    pdf_bytes = generate_label_sheet_pdf(labels)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=labels.pdf"},
    )
