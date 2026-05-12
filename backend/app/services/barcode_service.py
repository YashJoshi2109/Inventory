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


# ── SGTIN-96 EPC (GS1-standard RFID) ─────────────────────────────────────────
#
# SGTIN-96 bit layout (96 bits = 24 hex chars):
#   [95:88]  Header        = 0x30   (8 bits)
#   [87:85]  Filter        = 0      (3 bits — "All Others")
#   [84:82]  Partition     = 5      (3 bits — 10-digit GCP, 3-digit item ref)
#   [81:52]  Company Prefix= GCP    (30 bits)
#   [51:38]  Item Reference= item_id(14 bits — supports up to 16,383 items)
#   [37:0]   Serial Number = item_id(38 bits — reuse item_id as unique serial)

_SGTIN96_HEADER    = 0x30
_SGTIN96_FILTER    = 0       # All Others
_SGTIN96_PARTITION = 5       # 10-digit GCP / 3-digit item ref
_GCP_INT           = int(SEAR_LAB_GCP)   # 24204115


def sgtin96_epc_hex(item_id: int, serial: int | None = None) -> str:
    """
    Generate a GS1-standard SGTIN-96 EPC hex string (24 uppercase hex chars).
    Used for RFID tag programming and label display.
    """
    s = serial if serial is not None else item_id
    epc = (
        (_SGTIN96_HEADER    & 0xFF)               << 88
        | (_SGTIN96_FILTER  & 0x7)                << 85
        | (_SGTIN96_PARTITION & 0x7)              << 82
        | (_GCP_INT         & 0x3FFFFFFF)         << 52
        | (item_id          & 0x3FFF)             << 38
        | (s                & 0x3FFFFFFFFF)
    )
    return format(epc, "024X")


def decode_sgtin96_epc(hex_str: str) -> int | None:
    """
    Reverse a SGTIN-96 EPC hex string back to item_id.
    Returns None if the string is not a SEAR Lab SGTIN-96.
    """
    if len(hex_str) != 24:
        return None
    try:
        epc = int(hex_str, 16)
    except ValueError:
        return None
    if (epc >> 88) & 0xFF != _SGTIN96_HEADER:
        return None
    if (epc >> 82) & 0x7 != _SGTIN96_PARTITION:
        return None
    if (epc >> 52) & 0x3FFFFFFF != _GCP_INT:
        return None
    return int((epc >> 38) & 0x3FFF)


# ── SGLN-96 EPC (GS1-standard RFID for locations) ────────────────────────────
#
# SGLN-96 bit layout (96 bits = 24 hex chars):
#   [95:88]  Header           = 0x32   (8 bits — SGLN-96 marker)
#   [87:85]  Filter           = 0      (3 bits)
#   [84:82]  Partition        = 5      (3 bits — 10-digit GCP)
#   [81:52]  Company Prefix   = GCP    (30 bits)
#   [51:39]  Location Ref     = loc_id (13 bits — supports up to 8,191 locations)
#   [38:0]   Extension        = 0      (39 bits — 0 = base GLN, no extension)

_SGLN96_HEADER    = 0x32
_SGLN96_PARTITION = 5


def sgln96_epc_hex(location_id: int) -> str:
    """Generate a GS1-standard SGLN-96 EPC hex string for a location (24 hex chars)."""
    epc = (
        (_SGLN96_HEADER    & 0xFF)           << 88
        | (_SGLN96_PARTITION & 0x7)          << 82
        | (_GCP_INT         & 0x3FFFFFFF)    << 52
        | (location_id      & 0x1FFF)        << 39
        # extension bits [38:0] = 0
    )
    return format(epc, "024X")


def decode_sgln96_epc(hex_str: str) -> int | None:
    """Reverse SGLN-96 EPC hex → location_id. Returns None if not SEAR Lab SGLN-96."""
    if len(hex_str) != 24:
        return None
    try:
        epc = int(hex_str, 16)
    except ValueError:
        return None
    if (epc >> 88) & 0xFF != _SGLN96_HEADER:
        return None
    if (epc >> 82) & 0x7 != _SGLN96_PARTITION:
        return None
    if (epc >> 52) & 0x3FFFFFFF != _GCP_INT:
        return None
    return int((epc >> 39) & 0x1FFF)


# ── GLN helpers (location "GTIN" equivalent) ─────────────────────────────────

def _gln13_check_digit(digits_12: str) -> int:
    """GS1 check digit for 12-digit GLN prefix."""
    total = sum(int(d) * (3 if i % 2 != 0 else 1) for i, d in enumerate(digits_12))
    return (10 - (total % 10)) % 10


def gln13_for_location(location_id: int) -> str:
    """Return 13-digit GLN for a location (GCP + 2-digit loc ref + check)."""
    prefix_12 = f"{SEAR_LAB_GCP}{location_id:02d}"  # 10 + 2 = 12 digits
    check = _gln13_check_digit(prefix_12)
    return f"{prefix_12}{check}"


def gs1_location_url(location_id: int, location_code: str = "") -> str:
    """GS1 Digital Link URL for a location: {base}/414/{gln13}."""
    gln = gln13_for_location(location_id)
    url = f"{GS1_DL_BASE}/414/{gln}"
    if location_code:
        import urllib.parse as _up
        url += f"?loc={_up.quote(location_code.upper())}"
    return url


# ── Legacy EPC helpers (backward compat) ─────────────────────────────────────

def generate_epc_serial(item_id: int) -> str:
    """Legacy EPC format — kept for backward compat with existing items."""
    return f"{EPC_PREFIX}{item_id:03d}"


def generate_item_barcode_value(item_id: int, sku: str = "") -> str:
    """Primary barcode value = GTIN-14."""
    return gtin14_for_item(item_id)


def generate_location_barcode_value(location_code: str) -> str:
    """Primary barcode value for a location."""
    return f"LOC:{location_code.upper()}"


# ── Zebra ZPL label generation (4" × 2" @ 203 DPI = 812 × 420 dots) ─────────
#
# RFID: EPC memory bank write uses ^RFW,H with:
#   PC word  = 3000h  (96-bit EPC, 6 sixteen-bit words)
#   EPC data = 24 uppercase hex chars from sgtin96_epc_hex / sgln96_epc_hex
#
# Code128 barcode encodes GTIN-14; ZPL ^BC auto-selects Code128C for digits.
# QR code  encodes GS1 Digital Link URL; magnification 4 = ~140 × 140 dots.
#
# Paste generated ZPL into https://labelary.com/viewer.html to preview.
# Send to printer via Zebra Setup Utilities → Open Communication → Send.

_ZPL_DPI    = 203
_ZPL_WIDTH  = 812   # 4.00 inches × 203
_ZPL_HEIGHT = 420   # 2.07 inches × 203


def generate_item_label_zpl(
    item_id: int,
    name: str,
    sku: str,
) -> str:
    """
    Return ZPL II code for one 4" × 2" Zebra label with:
      • RFID EPC write (SGTIN-96, EPC bank)
      • Code128 barcode (GTIN-14)
      • GS1 QR code (GS1 Digital Link URL)
      • Text block: name, SKU, GTIN-12, serial, EPC hex
    """
    gtin14  = gtin14_for_item(item_id)
    gtin12  = gtin12_for_item(item_id)
    serial  = serial_for_item(item_id)
    epc_hex = sgtin96_epc_hex(item_id)
    # Simplified GS1 URL (no desc= param) keeps ZPL field short
    gs1_url = f"{GS1_DL_BASE}/01/{gtin14}/21/{serial}"

    # Truncate name to fit left text block (~30 chars at 28-dot font, 615-dot wide)
    name_short = name[:30] if len(name) > 30 else name
    # EPC split into two 12-char halves for readability
    epc_a, epc_b = epc_hex[:12], epc_hex[12:]

    zpl = f"""\
^XA
^PW{_ZPL_WIDTH}
^LL{_ZPL_HEIGHT}
^CI28
^MMT

^RFW,H^FD3000{epc_hex}^FS

^FO20,10^A0N,28,28^FD{name_short}^FS
^FO20,44^A0N,19,19^FD{sku}^FS
^FO20,69^A0N,18,18^FDGTIN: {gtin12}^FS
^FO20,93^A0N,18,18^FDSerial: {serial}^FS
^FO20,117^A0N,14,14^FDEPC: {epc_a}^FS
^FO20,133^A0N,14,14^FD      {epc_b}^FS

^FO638,8
^BQN,2,4
^FDQA,{gs1_url}^FS

^FO15,175
^BY2,3,70
^BCN,70,N,N
^FD{gtin14}^FS

^FO15,280^A0N,15,15^FDSEAR Lab \B7 University of Texas at Arlington^FS
^FO720,280^A0N,15,15^FD{serial}^FS

^XZ"""
    return zpl


def generate_location_label_zpl(
    location_id: int,
    code: str,
    name: str,
) -> str:
    """
    Return ZPL II code for one 4" × 2" Zebra location label with:
      • RFID EPC write (SGLN-96, EPC bank)
      • Code128 barcode (LOC:CODE)
      • GS1 QR code (GS1 location URL /414/{gln13})
      • Text block: name, code, GLN-13, EPC hex
    """
    gln13   = gln13_for_location(location_id)
    epc_hex = sgln96_epc_hex(location_id)
    code128_val = f"LOC:{code.upper()}"
    gs1_url = gs1_location_url(location_id, code)
    name_short = name[:30] if len(name) > 30 else name
    epc_a, epc_b = epc_hex[:12], epc_hex[12:]

    zpl = f"""\
^XA
^PW{_ZPL_WIDTH}
^LL{_ZPL_HEIGHT}
^CI28
^MMT

^RFW,H^FD3000{epc_hex}^FS

^FO20,10^A0N,28,28^FD{name_short}^FS
^FO20,44^A0N,20,20^FD{code.upper()}^FS
^FO20,70^A0N,18,18^FDGLN-13: {gln13}^FS
^FO20,94^A0N,18,18^FDEPC: {epc_a}^FS
^FO20,114^A0N,14,14^FD      {epc_b}^FS

^FO638,8
^BQN,2,4
^FDQA,{gs1_url}^FS

^FO15,155
^BY2,3,80
^BCN,80,N,N
^FD{code128_val}^FS

^FO15,272^A0N,15,15^FDSEAR Lab \B7 University of Texas at Arlington^FS
^FO680,272^A0N,15,15^FD{code.upper()}^FS

^XZ"""
    return zpl


def generate_bulk_items_zpl(items: list[dict]) -> str:
    """
    Return multi-label ZPL for a list of item dicts with keys:
      id, name, sku
    Labels are separated by ^XZ...^XA (continuous feed).
    """
    return "\n".join(
        generate_item_label_zpl(lbl["id"], lbl["name"], lbl["sku"])
        for lbl in items
    )


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


def _draw_location_label(c: rl_canvas.Canvas, lbl: dict, x: float, y: float) -> None:
    """
    Draw one SEAR Lab location label (4" × 2") at bottom-left (x, y).

    lbl keys:
        title        str   location name
        code         str   location code (e.g. A2)
        barcode_value str  Code128 value (e.g. LOC:A2)
        gln_display  str   GLN-13 string
        epc_hex      str   SGLN-96 EPC hex (optional)
        qr_value     str   GS1 location URL (fallback)
        qr_blob      bytes pre-rendered QR PNG (optional)
    """
    W = _LABEL_W
    H = _LABEL_H
    pad = 2 * mm

    c.setStrokeColorRGB(0.75, 0.75, 0.75)
    c.setLineWidth(0.4)
    c.rect(x, y, W, H)

    # QR code (right zone)
    qr_size = 0.85 * inch
    qr_x = x + W - qr_size - pad
    qr_y = y + (H - qr_size) / 2
    qr_bytes = lbl.get("qr_blob") or render_qr_png(lbl.get("qr_value", lbl["barcode_value"]))
    c.drawImage(ImageReader(io.BytesIO(qr_bytes)), qr_x, qr_y, width=qr_size, height=qr_size, preserveAspectRatio=True)

    text_x = x + pad

    # Location name (bold)
    c.setFont("Helvetica-Bold", 8.5)
    c.setFillColorRGB(0, 0, 0)
    c.drawString(text_x, y + H - pad - 9, lbl.get("title", "")[:32])

    # Code (monospace)
    c.setFont("Courier-Bold", 8)
    c.setFillColorRGB(0.1, 0.1, 0.1)
    c.drawString(text_x, y + H - pad - 9 - 9, lbl.get("barcode_value", ""))

    # GLN-13
    c.setFont("Helvetica", 6.5)
    c.setFillColorRGB(0.25, 0.25, 0.25)
    c.drawString(text_x, y + H - pad - 9 - 9 - 8, f"GLN-13: {lbl.get('gln_display', '')}")

    # EPC hex
    epc = lbl.get("epc_hex", "")
    if epc:
        c.setFont("Courier", 5.5)
        c.setFillColorRGB(0.35, 0.35, 0.35)
        c.drawString(text_x, y + H - pad - 9 - 9 - 16, f"EPC: {epc}")

    # Code128 barcode (LOC:CODE)
    bc_h = 0.52 * inch
    bc_w = W - qr_size - 3 * pad
    bc_y = y + pad + 5 * mm
    bc_bytes = render_barcode_png(lbl["barcode_value"])
    c.drawImage(ImageReader(io.BytesIO(bc_bytes)), text_x, bc_y, width=bc_w, height=bc_h,
                preserveAspectRatio=False, mask="auto")

    c.setFont("Courier", 6)
    c.setFillColorRGB(0.1, 0.1, 0.1)
    c.drawCentredString(text_x + bc_w / 2, y + pad, lbl["barcode_value"])


def generate_location_label_sheet_pdf(labels: list[dict]) -> bytes:
    """
    Generates a 2-column label sheet for locations (same Avery 5160 layout as items).

    Each label dict:
        title        str   location name
        code         str   location code
        barcode_value str  Code128 value (LOC:CODE)
        gln_display  str   GLN-13
        epc_hex      str   SGLN-96 EPC hex (optional)
        qr_value     str   GS1 location URL
        qr_blob      bytes pre-rendered QR PNG (optional)
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
        _draw_location_label(c, lbl, x, y)
        if (idx + 1) % labels_per_page == 0 and (idx + 1) < len(labels):
            c.showPage()
    c.save()
    return buf.getvalue()


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
