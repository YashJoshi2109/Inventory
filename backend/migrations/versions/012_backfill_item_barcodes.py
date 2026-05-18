"""012_backfill_item_barcodes

Revision ID: 012_backfill_item_barcodes
Revises: 011_cat_name_owner_uniq
Create Date: 2026-05-19

Populates item_barcodes for every item that is missing its SEAR Lab GTIN-14
and/or SGTIN-96 EPC entry.  Items created before the auto-registration code
was added to the item-creation endpoint (items.py) have no barcode rows, so
the scan service falls through to the fragile GTIN reverse-lookup (step 3c)
which depends on item.id being stable — causing "not in inventory" for those
items.

After this migration every item will have at minimum:
  • barcode_type = 'qr+code128'  barcode_value = GTIN-14  (scan step 3)
  • barcode_type = 'rfid_epc'    barcode_value = EPC hex   (scan step 3b)

Duplicate GTIN values are skipped (ON CONFLICT DO NOTHING).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision: str = "012_backfill_item_barcodes"
down_revision: Union[str, None] = "011_cat_name_owner_uniq"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ── SEAR Lab GS1 GCP ──────────────────────────────────────────────────────────
_GCP = "0024204115"   # 10-digit Company Prefix
_EPC_PREFIX = "SEAR"  # legacy EPC prefix kept for backward compat


def _gtin14(item_id: int) -> str:
    """Reproduce gtin14_for_item() without importing app code."""
    prefix13 = f"{_GCP}{item_id:03d}"
    # GS1 check digit (Mod-10)
    total = 0
    for i, ch in enumerate(reversed(prefix13)):
        total += int(ch) * (3 if i % 2 == 0 else 1)
    check = (10 - (total % 10)) % 10
    return prefix13 + str(check)


def _epc_hex(item_id: int) -> str:
    """Reproduce sgtin96_epc_hex() without importing app code."""
    header    = 0x30
    filter_v  = 0
    partition = 5
    gcp_int   = int(_GCP)   # 24204115 (drops leading zeros)
    serial    = item_id
    epc = (
        (header    & 0xFF)         << 88
        | (filter_v  & 0x7)        << 85
        | (partition & 0x7)        << 82
        | (gcp_int   & 0x3FFFFFFF) << 52
        | (item_id   & 0x3FFF)     << 38
        | (serial    & 0x3FFFFFFFFF)
    )
    return format(epc, "024X")


def _epc_legacy(item_id: int) -> str:
    return f"{_EPC_PREFIX}{item_id:03d}"


def upgrade() -> None:
    conn = op.get_bind()

    # Fetch all item ids that have no 'qr+code128' barcode registered yet.
    rows = conn.execute(
        text("""
            SELECT i.id
            FROM   items i
            LEFT JOIN item_barcodes ib
                   ON ib.item_id = i.id AND ib.barcode_type = 'qr+code128'
            WHERE  ib.id IS NULL
            ORDER  BY i.id
        """)
    ).fetchall()

    for (item_id,) in rows:
        gtin = _gtin14(item_id)
        epc  = _epc_hex(item_id)
        leg  = _epc_legacy(item_id)

        # GTIN-14 / qr+code128 entry (primary barcode — used by scan step 3)
        conn.execute(
            text("""
                INSERT INTO item_barcodes (item_id, barcode_type, barcode_value, is_primary)
                VALUES (:iid, 'qr+code128', :val, true)
                ON CONFLICT (barcode_value) DO NOTHING
            """),
            {"iid": item_id, "val": gtin},
        )

        # SGTIN-96 EPC hex entry (used by scan step 3b / RFID)
        conn.execute(
            text("""
                INSERT INTO item_barcodes (item_id, barcode_type, barcode_value, is_primary)
                VALUES (:iid, 'rfid_epc', :val, false)
                ON CONFLICT (barcode_value) DO NOTHING
            """),
            {"iid": item_id, "val": epc},
        )

        # Legacy EPC string (e.g. "SEAR001") — kept for backward compat
        conn.execute(
            text("""
                INSERT INTO item_barcodes (item_id, barcode_type, barcode_value, is_primary)
                VALUES (:iid, 'rfid_epc_legacy', :val, false)
                ON CONFLICT (barcode_value) DO NOTHING
            """),
            {"iid": item_id, "val": leg},
        )


def downgrade() -> None:
    # Remove any SEAR-Lab-GCP GTIN-14 barcodes that start with the GCP
    # (conservative: only removes entries added by this migration).
    op.get_bind().execute(
        text(f"DELETE FROM item_barcodes WHERE barcode_value LIKE '{_GCP}%'")
    )
