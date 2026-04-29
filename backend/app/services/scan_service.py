"""
Scan resolution service.

Decodes a raw barcode string and resolves it to an Item or Location,
returning enough context for the frontend scan workflow to proceed.
"""
from dataclasses import dataclass
from enum import StrEnum

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.item_repo import ItemRepository
from app.repositories.location_repo import LocationRepository


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

    async def resolve(self, barcode_value: str) -> ScanResult:
        """
        Resolution order:
        1. Location barcode  (prefix LOC: or direct location code)
        2. Item barcode      (EPC serial or registered barcode_value)
        3. JSON QR payload   ({"sku":..., "epc":...} from printed labels)
        4. Direct SKU match  (human-typed or legacy barcodes)
        """
        clean = barcode_value.strip()

        # Handle JSON QR payloads ({"sku":"...", "epc":"..."})
        if clean.startswith("{"):
            try:
                import json as _json
                payload = _json.loads(clean)
                # Try EPC first, then SKU from payload
                if "epc" in payload:
                    clean = payload["epc"]
                elif "sku" in payload:
                    clean = payload["sku"]
            except Exception:
                pass  # not JSON, continue with original value

        # Location barcode (QR contains "LOC:{code}")
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

        # Try location by raw barcode value
        location = await self._loc_repo.get_by_barcode(clean)
        if location:
            return ScanResult(
                result_type=ScanResultType.LOCATION,
                id=location.id,
                code=location.code,
                name=location.name,
                details={"area_name": location.area.name if location.area else ""},
            )

        # Try item by barcode registry
        item = await self._item_repo.get_by_barcode(clean)
        if item:
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

        # Try direct SKU match
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

        return ScanResult(
            result_type=ScanResultType.UNKNOWN,
            id=None,
            code=clean,
            name="Unknown",
            details={},
        )
