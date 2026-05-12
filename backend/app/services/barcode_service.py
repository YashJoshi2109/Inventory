"""
Barcode + QR code generation and printing label service.

SEAR Lab Standard Label Format (4" × 2" at 203 dpi):
  ┌─────────────────────────────────────────────────────┐
  │ ITEM NAME                              [QR  QR  QR] │
  │ Description subtitle                  [QR  QR  QR] │
  │ GTIN: 242041150003                    [QR  QR  QR] │
  │ Serial: SN-0001                       [QR  QR  QR] │
  │  ▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌             │
  │  242041150003                                       │
  └─────────────────────────────────────────────────────┘

Barcode (Code 128) encodes: GTIN-14 (00242041150003)
QR code encodes: GS1 Digital Link URL
  → https://rfid.uta.edu/01/00242041150003/21/SN-0001?desc=Item_Name

GTIN Strategy
=============
Company prefix (GCP):  0024204115  (10-digit SEAR Lab prefix)
Item reference:        {item_id:03d}  (3 digits, supports up to 999 items)
Check digit:           GS1 mod-10 algorithm
GTIN-14:               {GCP}{item_ref}{check}  (14 digits total)

Serial:                SN-{item_id:04d}

Scan resolution
===============
• GTIN-12/13/14 from Code 128  → normalize to GTIN-14 → look up in item_barcodes
• GS1 Digital Link URL         → extract GTIN-14 → look up in item_barcodes
• LOC:{code}                   → location lookup
• EPC serial (E28...)          → legacy fallback for existing items
• Direct SKU                   → last-resort fallback
"""
import io
import re
import urllib.parse
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

# ── SEAR Lab GS1 constants ────────────────────────────────────────────────────

# 10-digit GS1 Company Prefix assigned to SEAR Lab (matches lab's physical labels)
SEAR_LAB_GCP = "0024204115"

# GS1 Digital Link base URL (matches rfid.uta.edu standard)
GS1_DL_BASE = "https://rfid.uta.edu"

# Legacy EPC prefix kept for backward compatibility with existing items
EPC_PREFIX = "E28011122223333344440"


# ── GTIN helpers ──────────────────────────────────────────────────────────────

def _gtin14_check_digit(digits_13: str) -> int:
    """Compute GS1 check digit from first 13 digits of a GTIN-14."""
    total = sum(
        int(d) * (3 if i % 2 == 0 else 1)
        for i, d in enumerate(digits_13)
    )
    return (10 - (total % 10)) % 10


def gtin14_for_item(item_id: int) -> str:
    """Return the 14-digit GS1 GTIN for this item."""
    prefix_13 = f"{SEAR_LAB_GCP}{item_id:03d}"   # 10 + 3 = 13 digits
    check = _gtin14_check_digit(prefix_13)
    return f"{prefix_13}{check}"                   # 14 digits total


def gtin12_for_item(item_id: int) -> str:
    """Return the 12-digit display GTIN (strips 2 leading zeros from GTIN-14)."""
    return gtin14_for_item(item_id)[2:]            # GTIN-14 always starts with "00"


def serial_for_item(item_id: int) -> str:
    """Return the GS1 serial number for this item."""
    return f"SN-{item_id:04d}"


def gs1_digital_link_url(item_id: int, item_name: str = "") -> str:
    """
    Build a GS1 Digital Link URL for an item.
    Format: {base}/01/{gtin14}/21/{serial}?desc={name}
    """
    gtin14 = gtin14_for_item(item_id)
    serial = serial_for_item(item_id)
    desc = urllib.parse.quote(item_name.replace(" ", "_"), safe="")
    url = f"{GS1_DL_BASE}/01/{gtin14}/21/{serial}"
    if desc:
        url += f"?desc={desc}"
    return url


def parse_gs1_digital_link(value: str) -> str | None:
    """
    Extract the GTIN-14 from a GS1 Digital Link URL.
    Matches: {any_host}/01/{gtin}/21/{serial}?...
    Returns the 14-digit GTIN string, or None if not a GS1 URL.
    """
    m = re.search(r"/01/(\d{8,14})/", value)
    if m:
        raw = m.group(1)
        return raw.zfill(14)          # normalize to 14 digits
    return None


def normalize_gtin(value: str) -> str | None:
    """
    If value looks like a bare GTIN (all digits, 12–14 chars), return
    zero-padded to 14 digits. Returns None if it doesn't look like a GTIN.
    """
    if re.fullmatch(r"\d{12,14}", value):
        return value.zfill(14)
    return None


# ── Legacy EPC helpers (backward compat) ─────────────────────────────────────

def generate_epc_serial(item_id: int) -> str:
    """Generate EPC-style serial (legacy format for existing items)."""
    return f"{EPC_PREFIX}{item_id:03d}"


def generate_item_barcode_value(item_id: int, sku: str = "") -> str:
    """Primary barcode value = GTIN-14."""
    return gtin14_for_item(item_id)


def generate_location_barcode_value(location_code: str) -> str:
    """Primary barcode value for a location."""
    return f"LOC:{location_code.upper()}"


# ── Code 128 barcode rendering ────────────────────────────────────────────────

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
        "font_size": 0,
        "text_distance": 1.0,
        "quiet_zone": 2,
        "write_text": False,
    })
    return buf.getvalue()


# ── QR code rendering ─────────────────────────────────────────────────────────

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


# ── Label sheet PDF (SEAR Lab Standard) ──────────────────────────────────────

# Label dimensions: 4" × 2" thermal label, 2 columns per row
_LABEL_W = 4.0 * inch
_LABEL_H = 2.0 * inch
_COLS = 2
_PAGE_W, _PAGE_H = letter
_H_MARGIN = (_PAGE_W - _COLS * _LABEL_W) / 2
_V_MARGIN = 0.5 * inch
_ROWS_PER_PAGE = int((_PAGE_H - 2 * _V_MARGIN) / _LABEL_H)


def _draw_label(c: rl_canvas.Canvas, lbl: dict, x: float, y: float) -> None:
    """
    Draw one SEAR Lab Standard label at bottom-left (x, y).

    lbl keys:
        title          str   item name
        sku            str   item SKU
        barcode_value  str   GTIN-14 (used for Code128 barcode)
        gtin_display   str   GTIN-12 to print as text (optional)
        serial         str   serial number, e.g. SN-0001 (optional)
        description    str   short description line (optional)
        qr_blob        bytes pre-rendered QR PNG encoding GS1 URL (optional)
        qr_value       str   GS1 Digital Link URL (fallback if no qr_blob)
    """
    W = _LABEL_W
    H = _LABEL_H
    pad = 2 * mm

    # ── Border ──
    c.setStrokeColorRGB(0.75, 0.75, 0.75)
    c.setLineWidth(0.4)
    c.rect(x, y, W, H)

    # ── QR code (right zone: 2.9"–3.9" from label left) ──
    qr_size = 0.85 * inch
    qr_x = x + W - qr_size - pad
    qr_y = y + (H - qr_size) / 2   # vertically centered

    qr_value = lbl.get("qr_value") or lbl.get("barcode_value", "")
    qr_bytes = lbl.get("qr_blob") or render_qr_png(qr_value)
    qr_reader = ImageReader(io.BytesIO(qr_bytes))
    c.drawImage(qr_reader, qr_x, qr_y, width=qr_size, height=qr_size, preserveAspectRatio=True)

    # ── Text zone (left zone: up to 2.8" from label left) ──
    text_right = x + W - qr_size - 2 * pad   # keep clear of QR
    text_x = x + pad

    # Item name (bold, largest)
    name = lbl.get("title", "")[:32]
    c.setFont("Helvetica-Bold", 8.5)
    c.setFillColorRGB(0, 0, 0)
    c.drawString(text_x, y + H - pad - 9, name)

    # Description (smaller, italic-style)
    desc = lbl.get("description", "")
    if desc:
        c.setFont("Helvetica-Oblique", 6.5)
        c.setFillColorRGB(0.25, 0.25, 0.25)
        c.drawString(text_x, y + H - pad - 9 - 9, desc[:40])
        gtin_y_offset = 9 + 9 + 8
    else:
        gtin_y_offset = 9 + 9

    # GTIN line
    gtin_display = lbl.get("gtin_display") or lbl.get("barcode_value", "")[2:]  # strip 00 prefix
    c.setFont("Helvetica", 6.5)
    c.setFillColorRGB(0.1, 0.1, 0.1)
    c.drawString(text_x, y + H - pad - gtin_y_offset, f"GTIN: {gtin_display}")

    # Serial line
    serial = lbl.get("serial", "")
    if serial:
        c.setFont("Helvetica", 6.5)
        c.drawString(text_x, y + H - pad - gtin_y_offset - 8, f"Serial: {serial}")

    # EPC hex line (RFID tag identifier)
    epc_hex = lbl.get("epc_hex", "")
    if epc_hex and serial:
        c.setFont("Courier", 5.5)
        c.setFillColorRGB(0.35, 0.35, 0.35)
        c.drawString(text_x, y + H - pad - gtin_y_offset - 16, f"EPC: {epc_hex}")

    # ── Code 128 barcode (left zone, bottom portion) ──
    bc_h = 0.52 * inch
    bc_w = W - qr_size - 3 * pad    # stays in left zone
    bc_y = y + pad + 5 * mm         # above GTIN text

    bc_bytes = render_barcode_png(lbl["barcode_value"])
    bc_reader = ImageReader(io.BytesIO(bc_bytes))
    c.drawImage(bc_reader, text_x, bc_y, width=bc_w, height=bc_h,
                preserveAspectRatio=False, mask="auto")

    # ── GTIN display number (below barcode, centered in left zone) ──
    c.setFont("Courier", 6)
    c.setFillColorRGB(0.1, 0.1, 0.1)
    c.drawCentredString(text_x + bc_w / 2, y + pad, gtin_display)


def generate_label_sheet_pdf(labels: list[dict]) -> bytes:
    """
    Generates a PDF label sheet with 2×5 = 10 labels per page.

    SEAR Lab Standard format:
    - Left zone: item name, description, GTIN, Serial + Code 128 barcode (GTIN)
    - Right zone: QR code (GS1 Digital Link URL)

    Each label dict:
        title          str   item name
        sku            str   item SKU
        barcode_value  str   GTIN-14 (for Code128)
        gtin_display   str   GTIN-12 display text (optional, derived from barcode_value)
        serial         str   serial number (optional)
        description    str   short description (optional)
        qr_blob        bytes pre-rendered QR PNG (optional)
        qr_value       str   GS1 Digital Link URL (fallback if no qr_blob)
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

        if (idx + 1) % labels_per_page == 0 and (idx + 1) < len(labels):
            c.showPage()

    c.save()
    return buf.getvalue()
