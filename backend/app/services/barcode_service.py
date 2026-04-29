"""
Barcode + QR code generation and printing label service.

Label format (matches physical Zebra thermal labels):
  ┌─────────────────────────────────┐
  │ ITEM NAME              [QR QR]  │
  │ SKU: FE-ITEM-001       [QR QR]  │
  │  ▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌   │
  │  E280111222233344440034         │
  └─────────────────────────────────┘

EPC Serial Strategy
===================
Items:     E280111222233344440{item_id:03d}   e.g. E280111222233344440034
Locations: LOC:{location_code}

Both Code128 barcode AND QR code encode the EPC serial → scanner reads either.
Scan lookup: barcode_value exact match → item found.
SKU fallback: if no barcode record matches, try direct SKU match.
"""
import io
from pathlib import Path

import barcode as pybarcode
from barcode.writer import ImageWriter
import qrcode
from qrcode.image.svg import SvgFillImage
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import mm, inch
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.lib.utils import ImageReader

from app.core.config import settings


BARCODE_DIR = Path(settings.BARCODE_DIR)
BARCODE_DIR.mkdir(parents=True, exist_ok=True)

# Lab EPC company prefix (matches physical labels)
EPC_PREFIX = "E280111222233344440"


def generate_epc_serial(item_id: int) -> str:
    """Generate EPC-style serial: lab prefix + 3-digit item_id."""
    return f"{EPC_PREFIX}{item_id:03d}"


def generate_item_barcode_value(item_id: int, sku: str) -> str:
    """Primary barcode value = EPC serial.  SKU is the human-readable fallback."""
    return generate_epc_serial(item_id)


def generate_location_barcode_value(location_code: str) -> str:
    """Primary barcode value for a location."""
    return f"LOC:{location_code.upper()}"


def _safe_code128(value: str) -> str:
    """Remove chars not allowed in Code128 barcodes."""
    allowed = set(
        " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    )
    return "".join(c for c in value if c in allowed)


def render_barcode_png(value: str) -> bytes:
    """Returns PNG bytes for a Code128 barcode (no human-readable text below)."""
    clean = _safe_code128(value)
    CODE128 = pybarcode.get_barcode_class("code128")
    buf = io.BytesIO()
    CODE128(
        clean,
        writer=ImageWriter(),
    ).write(buf, options={
        "module_height": 12.0,
        "font_size": 0,       # hide text — serial is printed separately
        "text_distance": 1.0,
        "quiet_zone": 2,
        "write_text": False,
    })
    return buf.getvalue()


def render_qr_svg(value: str) -> bytes:
    """Returns SVG bytes for a QR code — used for location labels."""
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=6, border=2)
    qr.add_data(value)
    qr.make(fit=True)
    img = qr.make_image(image_factory=SvgFillImage)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue()


def render_qr_png(value: str) -> bytes:
    """Returns PNG bytes for a QR code."""
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=2)
    qr.add_data(value)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ── Label sheet PDF (matches physical Zebra thermal label format) ──────────────

# Label dimensions: 4" × 2" thermal label, 2 columns per row
_LABEL_W = 4.0 * inch
_LABEL_H = 2.0 * inch
_COLS = 2
_PAGE_W, _PAGE_H = letter  # 8.5" × 11"
_H_MARGIN = (_PAGE_W - _COLS * _LABEL_W) / 2   # ~0.25" each side
_V_MARGIN = 0.5 * inch
_ROWS_PER_PAGE = int((_PAGE_H - 2 * _V_MARGIN) / _LABEL_H)  # 5 rows = 10 labels/page


def _draw_label(c: rl_canvas.Canvas, lbl: dict, x: float, y: float) -> None:
    """
    Draw one label at bottom-left (x, y) in PDF coordinate space.
    lbl keys: title, sku, barcode_value, qr_blob (optional)
    """
    W = _LABEL_W
    H = _LABEL_H
    pad = 2 * mm

    # ── Border ──
    c.setStrokeColorRGB(0.75, 0.75, 0.75)
    c.setLineWidth(0.4)
    c.rect(x, y, W, H)

    # ── QR code (top-right) ──
    qr_size = 0.80 * inch
    qr_x = x + W - qr_size - pad
    qr_y = y + H - qr_size - pad

    qr_bytes = lbl.get("qr_blob") or render_qr_png(lbl["barcode_value"])
    qr_reader = ImageReader(io.BytesIO(qr_bytes))
    c.drawImage(qr_reader, qr_x, qr_y, width=qr_size, height=qr_size, preserveAspectRatio=True)

    # ── Item name (top-left, bold) ──
    name = lbl.get("title", "")[:28]
    c.setFont("Helvetica-Bold", 9)
    c.setFillColorRGB(0, 0, 0)
    c.drawString(x + pad, y + H - pad - 9, name)

    # ── SKU line ──
    sku = lbl.get("sku", lbl.get("barcode_value", ""))
    c.setFont("Helvetica", 7.5)
    c.setFillColorRGB(0.2, 0.2, 0.2)
    c.drawString(x + pad, y + H - pad - 9 - 10, f"SKU: {sku}")

    # ── Code128 barcode (center strip) ──
    bc_h = 0.55 * inch   # barcode image height
    bc_w = W - 2 * pad
    bc_y = y + pad + 5 * mm  # above serial text

    bc_bytes = render_barcode_png(lbl["barcode_value"])
    bc_reader = ImageReader(io.BytesIO(bc_bytes))
    c.drawImage(bc_reader, x + pad, bc_y, width=bc_w, height=bc_h,
                preserveAspectRatio=False, mask="auto")

    # ── EPC serial number (below barcode, monospace small) ──
    c.setFont("Courier", 6.5)
    c.setFillColorRGB(0.1, 0.1, 0.1)
    c.drawCentredString(x + W / 2, y + pad, lbl["barcode_value"])


def generate_label_sheet_pdf(labels: list[dict]) -> bytes:
    """
    Generates a PDF label sheet with 2×5 = 10 labels per page.
    Each label matches the physical Zebra thermal format:
    name+SKU top-left, QR top-right, Code128 barcode center, EPC serial below.

    Each label dict: {
        "title":         str,           # item name
        "sku":           str,           # item SKU
        "barcode_value": str,           # EPC serial (used for both QR and barcode)
        "qr_blob":       bytes | None,  # pre-rendered QR PNG (optional)
    }
    """
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=letter)

    labels_per_page = _COLS * _ROWS_PER_PAGE

    for idx, lbl in enumerate(labels):
        page_idx = idx % labels_per_page
        col = page_idx % _COLS
        row = page_idx // _COLS

        x = _H_MARGIN + col * _LABEL_W
        y = _PAGE_H - _V_MARGIN - (row + 1) * _LABEL_H

        _draw_label(c, lbl, x, y)

        # New page after filling current one
        if (idx + 1) % labels_per_page == 0 and (idx + 1) < len(labels):
            c.showPage()

    c.save()
    return buf.getvalue()
