"""
Scan resolution service.

Decodes a raw barcode/QR string and resolves it to an Item or Location.

Resolution order
================
1. Location  — "LOC:{code}" prefix or raw location barcode
2. GS1 Digital Link URL  — https://rfid.uta.edu/01/{gtin14}/21/{serial}?desc=...
3. GTIN (bare digits, 12-14 chars)  — normalize to GTIN-14 and look up
4. Item barcode registry  — exact barcode_value match (GTIN-14 or legacy EPC)
5. Direct SKU match  — human-typed or legacy barcodes
6. JSON QR payload  — {"sku":..., "epc":...} from legacy labels (pipe-separated or JSON)
"""
import re
from dataclasses import dataclass
from enum import StrEnum

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.item_repo import ItemRepository
from app.repositories.location_repo import LocationRepository
from app.services.barcode_service import (
    parse_gs1_digital_link,
    normalize_gtin,
    SEAR_LAB_GCP,
    decode_sgtin96_epc,
    decode_sgln96_epc,
    gln13_for_location,
)


class ScanResultType(StrEnum):
    ITEM = "item"
    LOCATION = "location"
    UNKNOWN = "unknown"


@dataclass
class ScanResult:
    result_type: ScanResultType
    id: int | None
    code: str
    name: str
    details: dict


class ScanService:
    def __init__(self, session: AsyncSession) -> None:
        self._item_repo = ItemRepository(session)
        self._loc_repo = LocationRepository(session)

    async def _item_result(self, item) -> ScanResult:
        total_qty = await self._item_repo.get_total_quantity(item.id)
        return ScanResult(
            result_type=ScanResultType.ITEM,
            id=item.id,
            code=item.sku,
            name=item.name,
            details={
                "unit": item.unit,
                "category": item.category.name if item.category else "",
                "total_quantity": float(total_qty),
                "reorder_level": float(item.reorder_level),
                "unit_cost": float(item.unit_cost),
            },
        )

    async def resolve(self, barcode_value: str) -> ScanResult:
        clean = barcode_value.strip()

        # ── 1. Location barcode ───────────────────────────────────────────────
        if clean.upper().startswith("LOC:"):
            loc_code = clean[4:].strip()
            location = await self._loc_repo.get_by_code(loc_code)
            if location:
                return ScanResult(
                    result_type=ScanResultType.LOCATION,
                    id=location.id,
                    code=location.code,
                    name=location.name,
                    details={
                        "area_name": location.area.name if location.area else "",
                        "area_code": location.area.code if location.area else "",
                    },
                )

        # ── 1b. SGLN-96 EPC hex → location_id (RFID reader output) ─────────────
        loc_id = decode_sgln96_epc(clean)
        if loc_id is not None:
            location = await self._loc_repo.get_by_id(loc_id)
            if location:
                return ScanResult(
                    result_type=ScanResultType.LOCATION,
                    id=location.id,
                    code=location.code,
                    name=location.name,
                    details={"area_name": location.area.name if location.area else ""},
                )

        # ── 1c. GS1 Digital Link URL for location: {host}/414/{gln13} ─────────
        if clean.startswith("http"):
            m = __import__("re").search(r"/414/(\d{13})", clean)
            if m:
                gln13 = m.group(1)
                # Reverse SEAR Lab GLN → location_id (GCP is first 10 digits, loc_ref next 2)
                if gln13[:len(SEAR_LAB_GCP)] == SEAR_LAB_GCP:
                    try:
                        loc_id_from_gln = int(gln13[len(SEAR_LAB_GCP):len(SEAR_LAB_GCP) + 2])
                        location = await self._loc_repo.get_by_id(loc_id_from_gln)
                        if location:
                            return ScanResult(
                                result_type=ScanResultType.LOCATION,
                                id=location.id,
                                code=location.code,
                                name=location.name,
                                details={"area_name": location.area.name if location.area else ""},
                            )
                    except (ValueError, IndexError):
                        pass

        # ── 1d. Raw location barcode lookup (stored barcode_value in DB) ───────
        location = await self._loc_repo.get_by_barcode(clean)
        if location:
            return ScanResult(
                result_type=ScanResultType.LOCATION,
                id=location.id,
                code=location.code,
                name=location.name,
                details={"area_name": location.area.name if location.area else ""},
            )

        # ── 2. GS1 Digital Link URL ───────────────────────────────────────────
        # Matches: https://{host}/01/{gtin}/21/{serial}?desc=...
        if clean.startswith("http"):
            gtin14 = parse_gs1_digital_link(clean)
            if gtin14:
                item = await self._item_repo.get_by_barcode(gtin14)
                if item:
                    return await self._item_result(item)
                # Also try GTIN-12 (drop leading 00)
                if gtin14.startswith("00"):
                    item = await self._item_repo.get_by_barcode(gtin14[2:])
                    if item:
                        return await self._item_result(item)

        # ── 3. Bare GTIN (12–14 all-digit string) ────────────────────────────
        gtin14 = normalize_gtin(clean)
        if gtin14:
            item = await self._item_repo.get_by_barcode(gtin14)
            if item:
                return await self._item_result(item)
            # Also try without leading 00 for items stored as GTIN-12
            if gtin14.startswith("00"):
                item = await self._item_repo.get_by_barcode(gtin14[2:])
                if item:
                    return await self._item_result(item)

        # ── 3b. SGTIN-96 EPC hex (proper GS1 RFID EPC, 24 hex chars) ────────────
        decoded_id = decode_sgtin96_epc(clean)
        if decoded_id is not None:
            item = await self._item_repo.get_by_id(decoded_id)
            if item:
                return await self._item_result(item)

        # ── 3c. Reverse SEAR Lab GTIN-14 → item_id (labels not yet in DB) ──────
        # Generated labels use gtin14_for_item(id) but may not be stored in item_barcodes yet.
        # Try both gtin14 (normalized to 14 digits) AND clean (raw scan) because ZXing may
        # decode a 14-digit Code128 as EAN-13 (13 digits), causing zfill(14) to prepend an extra
        # zero and break the GCP prefix comparison.
        for _candidate in filter(None, {gtin14, clean if clean.isdigit() else None}):
            if _candidate[:len(SEAR_LAB_GCP)] == SEAR_LAB_GCP:
                try:
                    derived_id = int(_candidate[len(SEAR_LAB_GCP):len(SEAR_LAB_GCP) + 3])
                    if derived_id > 0:
                        item = await self._item_repo.get_by_id(derived_id)
                        if item:
                            return await self._item_result(item)
                except (ValueError, IndexError):
                    pass

        # ── 4. Exact barcode registry match (GTIN-14 or legacy EPC) ──────────
        item = await self._item_repo.get_by_barcode(clean)
        if item:
            return await self._item_result(item)

        # ── 5. Direct SKU match ───────────────────────────────────────────────
        item = await self._item_repo.get_by_sku(clean)
        if item:
            total_qty = await self._item_repo.get_total_quantity(item.id)
            return ScanResult(
                result_type=ScanResultType.ITEM,
                id=item.id,
                code=item.sku,
                name=item.name,
                details={
                    "unit": item.unit,
                    "total_quantity": float(total_qty),
                    "unit_cost": float(item.unit_cost),
                },
            )

        # ── 6. Legacy formats ─────────────────────────────────────────────────
        # JSON payload: {"sku":"...", "epc":"..."}
        if clean.startswith("{"):
            try:
                import json as _json
                payload = _json.loads(clean)
                probe = payload.get("epc") or payload.get("sku")
                if probe:
                    item = await self._item_repo.get_by_barcode(probe)
                    if not item:
                        item = await self._item_repo.get_by_sku(probe)
                    if item:
                        return await self._item_result(item)
            except Exception:
                pass

        # Pipe-separated "bad label" format: "SKU: X | EPC: Y | Name: Z"
        if "|" in clean:
            for part in clean.split("|"):
                part = part.strip()
                if part.upper().startswith("SKU:"):
                    sku_val = part[4:].strip()
                    item = await self._item_repo.get_by_sku(sku_val)
                    if item:
                        return await self._item_result(item)
                elif part.upper().startswith("EPC:"):
                    epc_val = part[4:].strip()
                    item = await self._item_repo.get_by_barcode(epc_val)
                    if item:
                        return await self._item_result(item)

        return ScanResult(
            result_type=ScanResultType.UNKNOWN,
            id=None,
            code=clean,
            name="Unknown",
            details={},
        )
