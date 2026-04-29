from datetime import datetime
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.api.v1.auth import CurrentUser, require_roles
from app.core.database import DbSession
from app.core.notifications import send_item_qr_email
from app.models.user import RoleName
from app.repositories.item_repo import ItemRepository
from app.repositories.location_repo import LocationRepository
from app.repositories.transaction_repo import StockLevelRepository
from app.services.barcode_service import (
    generate_label_sheet_pdf,
    generate_epc_serial,
    render_qr_png,
    render_qr_svg,
)
from app.schemas.common import MessageResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/barcodes", tags=["barcodes"])

# Safety cap — Avery 5160 is 30 labels/sheet, so 2000 items = ~67 pages.
# Anything larger would strain reportlab and the browser's PDF viewer.
_BULK_PRINT_MAX_ITEMS = 2000


@router.get("/item/{item_id}/qr/png")
async def item_qr_png(item_id: int, session: DbSession, current_user: CurrentUser) -> Response:
    repo = ItemRepository(session)
    item = await repo.get_with_details(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    primary = next((b for b in item.barcodes if b.is_primary), None)
    if primary and primary.qr_image:
        return Response(content=primary.qr_image, media_type="image/png")
    # Fallback: generate QR from EPC serial (or barcode_value, or EPC from item_id)
    barcode_value = (primary.barcode_value if primary else None) or generate_epc_serial(item.id)
    png_bytes = render_qr_png(barcode_value)
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


def _item_to_label(item) -> dict:
    """Build a label dict from an Item ORM instance with loaded barcodes + category."""
    primary = next((b for b in item.barcodes if b.is_primary), None)
    # Use stored EPC barcode_value; fall back to generating one from item_id
    barcode_value = (
        primary.barcode_value
        if primary and primary.barcode_value
        else generate_epc_serial(item.id)
    )
    return {
        "title": item.name,
        "sku": item.sku,
        "barcode_value": barcode_value,
        "qr_blob": primary.qr_image if primary else None,
    }


@router.post("/labels/print")
async def print_label_sheet(
    item_ids: list[int],
    session: DbSession,
    current_user: CurrentUser,
) -> Response:
    """Generate an Avery 5160 compatible PDF label sheet for the given item IDs."""
    repo = ItemRepository(session)
    labels = []
    for item_id in item_ids[:500]:
        item = await repo.get_with_details(item_id)
        if item:
            labels.append(_item_to_label(item))

    pdf_bytes = generate_label_sheet_pdf(labels)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=labels.pdf"},
    )


@router.get(
    "/labels/print-bulk",
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER, RoleName.OPERATOR))],
)
async def print_bulk_labels(
    session: DbSession,
    current_user: CurrentUser,
    q: str | None = Query(default=None, description="Search query — same as /items"),
    category_id: int | None = Query(default=None),
    status: str | None = Query(default=None, description="OK, LOW, or OUT"),
    limit: int = Query(default=_BULK_PRINT_MAX_ITEMS, ge=1, le=_BULK_PRINT_MAX_ITEMS),
) -> Response:
    """
    Generate a bulk Avery 5160 PDF for every active item matching the filters.

    Mirrors the filter semantics of ``GET /items`` so the Inventory tab's current
    view is what gets printed. Status filtering (LOW/OUT/OK) happens in Python
    after the DB query since stock totals aren't in a single column.
    """
    repo = ItemRepository(session)
    stock_repo = StockLevelRepository(session)

    # Pull up to _BULK_PRINT_MAX_ITEMS matching items — barcodes + category eager-loaded.
    items, total = await repo.search(
        query=q,
        category_id=category_id,
        is_active=True,
        skip=0,
        limit=limit,
    )

    status_wanted = status.upper() if status else None
    labels: list[dict] = []

    if status_wanted:
        # Batch-fetch all totals in one query when filtering by status
        item_ids = [item.id for item in items]
        stock_totals = await stock_repo.get_totals_for_items(item_ids)
    else:
        stock_totals = {}

    for item in items:
        if status_wanted:
            from decimal import Decimal
            total_qty = stock_totals.get(item.id, Decimal("0"))
            item_status = (
                "OUT" if total_qty <= 0
                else ("LOW" if total_qty <= item.reorder_level else "OK")
            )
            if item_status != status_wanted:
                continue
        labels.append(_item_to_label(item))

    if not labels:
        raise HTTPException(
            status_code=404,
            detail="No items match the current filters — nothing to print.",
        )

    logger.info(
        "Bulk label print: user=%s labels=%d matched=%d filters=q=%r cat=%r status=%r",
        current_user.id, len(labels), total, q, category_id, status,
    )

    pdf_bytes = generate_label_sheet_pdf(labels)
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    filename = f"sear-labels-bulk-{stamp}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "X-Labels-Count": str(len(labels)),
            "X-Items-Matched": str(total),
        },
    )
