from datetime import datetime
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

from app.api.v1.auth import CurrentUser, require_roles
from app.core.database import DbSession
from app.core.notifications import send_item_qr_email
from app.models.user import RoleName
from app.repositories.item_repo import ItemRepository
from app.repositories.location_repo import LocationRepository
from app.repositories.transaction_repo import StockLevelRepository
from app.services.barcode_service import (
    generate_label_sheet_pdf,
    generate_location_label_sheet_pdf,
    generate_item_label_zpl,
    generate_location_label_zpl,
    generate_bulk_items_zpl,
    sgtin96_epc_hex,
    sgln96_epc_hex,
    gln13_for_location,
    gs1_location_url,
    gtin14_for_item,
    gtin12_for_item,
    serial_for_item,
    gs1_digital_link_url,
    render_barcode_png,
    render_qr_png,
    render_qr_svg,
)
from app.schemas.common import MessageResponse


class ItemBarcodeMeta(BaseModel):
    gtin14: str
    gtin12: str
    serial: str
    epc_hex: str
    gs1_url: str


class LocationBarcodeMeta(BaseModel):
    gln13: str
    epc_hex: str
    code128_value: str
    gs1_url: str

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
    # Fallback: generate QR from GS1 Digital Link URL (SEAR Lab standard)
    gs1_url = gs1_digital_link_url(item.id, item.name)
    png_bytes = render_qr_png(gs1_url)
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


@router.get("/item/{item_id}/zpl")
async def item_label_zpl(item_id: int, session: DbSession, current_user: CurrentUser) -> Response:
    """ZPL II label for one item — 4\" × 2\" @ 203 DPI with RFID EPC (SGTIN-96) embedding."""
    repo = ItemRepository(session)
    item = await repo.get_with_details(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    zpl = generate_item_label_zpl(item_id, item.name, item.sku)
    return Response(
        content=zpl,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{item.sku}-label.zpl"'},
    )


@router.get("/location/{location_id}/zpl")
async def location_label_zpl(location_id: int, session: DbSession, current_user: CurrentUser) -> Response:
    """ZPL II label for one location — 4\" × 2\" @ 203 DPI with RFID EPC (SGLN-96) embedding."""
    repo = LocationRepository(session)
    loc = await repo.get_by_id(location_id)
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    zpl = generate_location_label_zpl(location_id, loc.code, loc.name)
    return Response(
        content=zpl,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="LOC-{loc.code}-label.zpl"'},
    )


@router.post("/labels/zpl")
async def bulk_items_zpl(
    item_ids: list[int],
    session: DbSession,
    current_user: CurrentUser,
) -> Response:
    """ZPL II multi-label file for a batch of items — paste into Zebra Setup Utilities or labelary.com."""
    repo = ItemRepository(session)
    items = []
    for item_id in item_ids[:500]:
        item = await repo.get_with_details(item_id)
        if item:
            items.append({"id": item.id, "name": item.name, "sku": item.sku})
    if not items:
        raise HTTPException(status_code=404, detail="No items found")
    zpl = generate_bulk_items_zpl(items)
    return Response(
        content=zpl,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="sear-labels-bulk.zpl"'},
    )


@router.get("/item/{item_id}/meta", response_model=ItemBarcodeMeta)
async def item_barcode_meta(item_id: int, session: DbSession, current_user: CurrentUser) -> ItemBarcodeMeta:
    """Barcode identifiers for an item — GTIN-14, serial, EPC hex (SGTIN-96), GS1 URL."""
    return ItemBarcodeMeta(
        gtin14=gtin14_for_item(item_id),
        gtin12=gtin12_for_item(item_id),
        serial=serial_for_item(item_id),
        epc_hex=sgtin96_epc_hex(item_id),
        gs1_url=gs1_digital_link_url(item_id, ""),
    )


@router.get("/item/{item_id}/png")
async def item_barcode_png(item_id: int, session: DbSession, current_user: CurrentUser) -> Response:
    """Code 128 barcode PNG for this item (encodes GTIN-14)."""
    repo = ItemRepository(session)
    item = await repo.get_with_details(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    primary = next((b for b in item.barcodes if b.is_primary), None)
    stored_bv = primary.barcode_value if primary and primary.barcode_value else None
    if stored_bv and stored_bv.startswith("E28"):
        stored_bv = None
    barcode_value = stored_bv or gtin14_for_item(item_id)
    png_bytes = render_barcode_png(barcode_value)
    return Response(content=png_bytes, media_type="image/png")


@router.get("/location/{location_id}/meta", response_model=LocationBarcodeMeta)
async def location_barcode_meta(location_id: int, session: DbSession, current_user: CurrentUser) -> LocationBarcodeMeta:
    """Barcode identifiers for a location — GLN-13, EPC hex (SGLN-96), Code128 value, GS1 URL."""
    repo = LocationRepository(session)
    loc = await repo.get_by_id(location_id)
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    return LocationBarcodeMeta(
        gln13=gln13_for_location(location_id),
        epc_hex=sgln96_epc_hex(location_id),
        code128_value=f"LOC:{loc.code.upper()}",
        gs1_url=gs1_location_url(location_id, loc.code),
    )


@router.get("/location/{location_id}/qr/png")
async def location_qr_png(location_id: int, session: DbSession, current_user: CurrentUser) -> Response:
    """Code 128 barcode PNG for this location (encodes LOC:{code}) — used for label downloads."""
    repo = LocationRepository(session)
    loc = await repo.get_by_id(location_id)
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    barcode_value = f"LOC:{loc.code.upper()}"
    png_bytes = render_barcode_png(barcode_value)
    return Response(content=png_bytes, media_type="image/png")


@router.get("/location/{location_id}/barcode/png")
async def location_barcode_png(location_id: int, session: DbSession, current_user: CurrentUser) -> Response:
    """Explicit Code 128 barcode PNG endpoint (same as /qr/png, named for clarity)."""
    return await location_qr_png(location_id, session, current_user)


@router.get("/location/{location_id}/gs1-qr/png")
async def location_gs1_qr_png(location_id: int, session: DbSession, current_user: CurrentUser) -> Response:
    """QR code encoding the GS1 Digital Link URL for this location (414/{gln13})."""
    repo = LocationRepository(session)
    loc = await repo.get_by_id(location_id)
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    gs1_url = gs1_location_url(location_id, loc.code)
    png_bytes = render_qr_png(gs1_url)
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
    """Build a SEAR Lab Standard label dict from an Item ORM instance."""
    primary = next((b for b in item.barcodes if b.is_primary), None)
    # Use stored GTIN-14 barcode_value; fall back to generating from item_id
    stored_bv = primary.barcode_value if primary and primary.barcode_value else None
    # Detect legacy EPC values (start with E28) and regenerate GTIN for new labels
    if stored_bv and stored_bv.startswith("E28"):
        stored_bv = None   # force GTIN generation
    barcode_value = stored_bv or gtin14_for_item(item.id)
    gtin12 = gtin12_for_item(item.id)
    serial = serial_for_item(item.id)
    gs1_url = gs1_digital_link_url(item.id, item.name)
    # Use stored QR only if it was generated with GTIN/GS1 (not legacy EPC)
    qr_blob = primary.qr_image if primary and stored_bv else None
    return {
        "title": item.name,
        "sku": item.sku,
        "barcode_value": barcode_value,
        "gtin_display": gtin12,
        "serial": serial,
        "epc_hex": sgtin96_epc_hex(item.id),
        "description": (item.description or "")[:40] if item.description else "",
        "qr_blob": qr_blob,
        "qr_value": gs1_url,
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


def _location_to_label(loc) -> dict:
    """Build a SEAR Lab location label dict from a Location ORM instance."""
    barcode_value = f"LOC:{loc.code.upper()}"
    gln = gln13_for_location(loc.id)
    epc = sgln96_epc_hex(loc.id)
    gs1_url = gs1_location_url(loc.id, loc.code)
    return {
        "title": loc.name,
        "code": loc.code,
        "barcode_value": barcode_value,
        "gln_display": gln,
        "epc_hex": epc,
        "qr_value": gs1_url,
        "qr_blob": None,
    }


@router.post("/location-labels/print")
async def print_location_label_sheet(
    location_ids: list[int],
    session: DbSession,
    current_user: CurrentUser,
) -> Response:
    """Generate an Avery 5160 compatible PDF label sheet for the given location IDs."""
    repo = LocationRepository(session)
    labels = []
    for loc_id in location_ids[:500]:
        loc = await repo.get_by_id(loc_id)
        if loc:
            labels.append(_location_to_label(loc))
    if not labels:
        raise HTTPException(status_code=404, detail="No locations found")
    pdf_bytes = generate_location_label_sheet_pdf(labels)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=location-labels.pdf"},
    )


@router.get(
    "/location-labels/print-bulk",
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER, RoleName.OPERATOR))],
)
async def print_bulk_location_labels(
    session: DbSession,
    current_user: CurrentUser,
    area_id: int | None = Query(default=None, description="Filter by area — omit for all locations"),
) -> Response:
    """Generate a bulk Avery 5160 PDF for every active location (optionally filtered by area)."""
    repo = LocationRepository(session)
    locations = await repo.get_all_with_area(area_id=area_id)
    if not locations:
        raise HTTPException(status_code=404, detail="No locations found for the given filters.")
    labels = [_location_to_label(loc) for loc in locations]
    pdf_bytes = generate_location_label_sheet_pdf(labels)
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    filename = f"sear-location-labels-{stamp}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "X-Labels-Count": str(len(labels)),
        },
    )
