"""
Barcode + QR code generation and printing label service.

Barcode ID Strategy
===================
Items  : SIER-{CAT_PREFIX}-{6-digit-seq}   e.g. SIER-CHM-000001
         Where CAT_PREFIX is first 3 chars of category code
Locations: SIER-LOC-{AREA_CODE}-{BIN}     e.g. SIER-LOC-LABA-S01B03

Phase 1: Code128 barcodes on plain paper (printable via browser PDF)
Phase 2: Pluggable: swap barcode_type = "rfid" without schema changes
"""
import io
import os
import textwrap
from pathlib import Path

import barcode as pybарcode
from barcode.writer import ImageWriter
import qrcode
from qrcode.image.svg import SvgFillImage
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph
from reportlab.lib.styles import getSampleStyleSheet

from app.core.config import settings


BARCODE_DIR = Path(settings.BARCODE_DIR)
BARCODE_DIR.mkdir(parents=True, exist_ok=True)


def _safe_code128(value: str) -> str:
    """Remove chars not allowed in Code128 barcodes."""
    allowed = set(" !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~" + "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")
    return "".join(c for c in value if c in allowed)


def generate_item_barcode_value(sku: str) -> str:
    """Primary barcode value for an item = the SKU itself (uppercase)."""
    return sku.upper()


def generate_location_barcode_value(location_code: str) -> str:
    """Primary barcode value for a location."""
    return f"LOC:{location_code.upper()}"


def render_barcode_png(value: str, filename: str | None = None) -> bytes:
    """Returns PNG bytes for a Code128 barcode."""
    clean = _safe_code128(value)
    CODE128 = pybarcode.get_barcode_class("code128")
    buf = io.BytesIO()
    CODE128(clean, writer=ImageWriter()).write(buf, options={"module_height": 15.0, "font_size": 8, "quiet_zone": 4})
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


def generate_label_sheet_pdf(labels: list[dict]) -> bytes:
    """
    Generates an Avery 5160-compatible 3x10 label sheet PDF with QR codes.
    Each label dict: { "title": str, "barcode_value": str, "subtitle": str }
    Returns PDF bytes suitable for direct browser print.
    """
    from reportlab.platypus import Image as RLImage

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        rightMargin=5 * mm,
        leftMargin=5 * mm,
        topMargin=13 * mm,
        bottomMargin=13 * mm,
    )
    styles = getSampleStyleSheet()
    normal = styles["Normal"]
    normal.fontSize = 7
    normal.leading = 9

    label_width = 66.7 * mm
    label_height = 25.4 * mm
    cols = 3

    cells = []
    for i in range(0, len(labels), cols):
        row_labels = labels[i : i + cols]
        row = []
        for lbl in row_labels:
            qr_png = lbl.get("qr_blob") or render_qr_png(lbl["barcode_value"])
            qr_img = RLImage(io.BytesIO(qr_png), width=18 * mm, height=18 * mm)
            title_p = Paragraph(f"<b>{lbl['title'][:30]}</b>", normal)
            sub_p = Paragraph(lbl.get("subtitle", "")[:40], normal)
            text_col = Table([[title_p], [sub_p]], colWidths=[label_width - 24 * mm])
            text_col.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 1 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]))
            inner = Table([[qr_img, text_col]], colWidths=[20 * mm, label_width - 24 * mm])
            inner.setStyle(TableStyle([
                ("ALIGN", (0, 0), (0, 0), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 1 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 1 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]))
            row.append(inner)
        while len(row) < cols:
            row.append("")
        cells.append(row)

    table = Table(cells, colWidths=[label_width] * cols)
    table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.25, colors.grey),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.grey),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWHEIGHT", (0, 0), (-1, -1), label_height),
    ]))
    doc.build([table])
    return buf.getvalue()
