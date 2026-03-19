"""
Excel / CSV import pipeline.

Supports the existing Lab_Inventory_Barcode_System.xlsx template
and generic CSV files.

Migration flow:
  1. Upload file → create ImportJob (status=processing)
  2. Parse items from Items_Master sheet
  3. For each row: upsert Category → upsert Item → generate barcode
  4. Parse transactions from Transactions sheet → create InventoryEvents
  5. Update StockLevel materialised view
  6. Mark ImportJob complete

The legacy Excel format maps:
  SKU           → items.sku
  Description   → items.name
  Category      → categories.name
  Unit Cost     → items.unit_cost
  Reorder Level → items.reorder_level
  Lead Time     → items.lead_days
  Loc1/2/3 Bin  → locations (auto-created if needed)
  Barcode Text  → item_barcodes.barcode_value
"""
import io
import json
import logging
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import Category, Item, ItemBarcode
from app.models.location import Area, Location, LocationBarcode
from app.models.transaction import ImportJob, InventoryEvent, StockLevel, EventKind
from app.repositories.item_repo import ItemRepository, CategoryRepository
from app.repositories.location_repo import AreaRepository, LocationRepository
from app.repositories.transaction_repo import StockLevelRepository

logger = logging.getLogger(__name__)

LEGACY_CATEGORY_COLOR_MAP = {
    "Reagents": "#6366f1",
    "Consumables": "#10b981",
    "Equipment": "#f59e0b",
    "Chemicals": "#ef4444",
    "Supplies": "#3b82f6",
    "Other": "#6b7280",
}


class ImportService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._item_repo = ItemRepository(session)
        self._cat_repo = CategoryRepository(session)
        self._area_repo = AreaRepository(session)
        self._loc_repo = LocationRepository(session)
        self._stock_repo = StockLevelRepository(session)

    async def import_excel(self, file_bytes: bytes, filename: str, actor_id: int) -> ImportJob:
        job = ImportJob(filename=filename, status="processing", actor_id=actor_id)
        self._session.add(job)
        await self._session.flush()

        errors: list[str] = []
        imported = skipped = error_count = 0

        try:
            xls = pd.ExcelFile(io.BytesIO(file_bytes))
            sheet_names = xls.sheet_names

            if "Items_Master" in sheet_names:
                df_items = pd.read_excel(xls, sheet_name="Items_Master", header=0)
                df_items.columns = [str(c).strip() for c in df_items.columns]
                df_items = df_items.dropna(subset=["SKU"])

                default_area = await self._get_or_create_default_area()

                for idx, row in df_items.iterrows():
                    try:
                        cat_name = str(row.get("Category", "Other")).strip() or "Other"
                        category = await self._get_or_create_category(cat_name)

                        sku = str(row["SKU"]).strip().upper()
                        existing = await self._item_repo.get_by_sku(sku)

                        unit_cost = self._safe_decimal(row.get("Unit Cost"))
                        reorder = self._safe_decimal(row.get("Reorder Level"))
                        lead = self._safe_int(row.get("Lead Time (days)"), 7)

                        if existing:
                            # Update fields but preserve existing stock
                            existing.name = str(row.get("Description", existing.name)).strip()
                            existing.unit_cost = unit_cost
                            existing.reorder_level = reorder
                            existing.lead_days = lead
                            skipped += 1
                        else:
                            item = Item(
                                sku=sku,
                                name=str(row.get("Description", sku)).strip(),
                                category_id=category.id,
                                unit_cost=unit_cost,
                                reorder_level=reorder,
                                reorder_qty=reorder * 2,
                                lead_days=lead,
                            )
                            self._session.add(item)
                            await self._session.flush()

                            # Register primary barcode
                            barcode_text = str(row.get("Barcode Text (SKU)", sku)).strip()
                            bc = ItemBarcode(
                                item_id=item.id,
                                barcode_type="code128",
                                barcode_value=barcode_text,
                                is_primary=True,
                            )
                            self._session.add(bc)

                            # Create locations from bin columns
                            for loc_col in ["Loc1 Bin", "Loc2 Bin", "Loc3 Bin"]:
                                bin_val = str(row.get(loc_col, "")).strip()
                                if bin_val and bin_val.lower() != "nan":
                                    loc = await self._get_or_create_location(default_area, bin_val)
                                    # Seed stock level at 0 (transactions will update it)
                                    existing_sl = await self._stock_repo.get_by_item_location(item.id, loc.id)
                                    if not existing_sl:
                                        sl = StockLevel(item_id=item.id, location_id=loc.id, quantity=Decimal("0"))
                                        self._session.add(sl)

                            imported += 1

                    except Exception as e:
                        error_count += 1
                        errors.append(f"Row {idx}: {e}")
                        logger.warning("Import error row %s: %s", idx, e)

                await self._session.flush()

            # Import transactions if present
            if "Transactions" in sheet_names:
                df_txn = pd.read_excel(xls, sheet_name="Transactions", header=0)
                df_txn.columns = [str(c).strip() for c in df_txn.columns]
                df_txn = df_txn.dropna(subset=["SKU"])

                default_area = await self._get_or_create_default_area()
                default_loc = await self._get_or_create_location(default_area, "IMPORT-DEFAULT")

                for idx, row in df_txn.iterrows():
                    try:
                        sku = str(row["SKU"]).strip().upper()
                        item = await self._item_repo.get_by_sku(sku)
                        if not item:
                            continue

                        txn_type = str(row.get("Type (IN/OUT)", "")).strip().upper()
                        qty = self._safe_decimal(row.get("Qty") or row.get("In Qty") or row.get("Out Qty"))
                        if qty <= 0:
                            continue

                        event_kind = EventKind.STOCK_IN if txn_type == "IN" else EventKind.STOCK_OUT
                        delta = qty if event_kind == EventKind.STOCK_IN else -qty

                        event = InventoryEvent(
                            event_kind=event_kind,
                            item_id=item.id,
                            to_location_id=default_loc.id if event_kind == EventKind.STOCK_IN else None,
                            from_location_id=default_loc.id if event_kind == EventKind.STOCK_OUT else None,
                            quantity=qty,
                            unit_cost_snapshot=item.unit_cost,
                            notes=str(row.get("Notes", "Legacy import")).strip(),
                            actor_id=actor_id,
                            source="import",
                        )
                        self._session.add(event)
                        await self._stock_repo.upsert(item.id, default_loc.id, delta)
                        imported += 1

                    except Exception as e:
                        error_count += 1
                        errors.append(f"Transaction row {idx}: {e}")

                await self._session.flush()

        except Exception as e:
            job.status = "failed"
            job.errors = json.dumps([str(e)])
            await self._session.flush()
            raise

        job.status = "done"
        job.total_rows = imported + skipped + error_count
        job.imported_rows = imported
        job.skipped_rows = skipped
        job.error_rows = error_count
        job.errors = json.dumps(errors[:100]) if errors else None
        job.completed_at = datetime.now(timezone.utc)
        await self._session.flush()
        return job

    async def _get_or_create_category(self, name: str) -> Category:
        cat = await self._cat_repo.get_by_name(name)
        if not cat:
            cat = Category(
                name=name,
                item_type="consumable",
                color=LEGACY_CATEGORY_COLOR_MAP.get(name, "#6b7280"),
            )
            self._session.add(cat)
            await self._session.flush()
        return cat

    async def _get_or_create_default_area(self) -> Area:
        area = await self._area_repo.get_by_code("LEGACY")
        if not area:
            area = Area(code="LEGACY", name="Legacy Import Area", description="Auto-created during import")
            self._session.add(area)
            await self._session.flush()
        return area

    async def _get_or_create_location(self, area: Area, bin_name: str) -> Location:
        code = bin_name.upper().replace(" ", "-")[:50]
        loc = await self._loc_repo.get_by_code(code)
        if not loc:
            loc = Location(area_id=area.id, code=code, name=bin_name, bin_label=bin_name)
            self._session.add(loc)
            await self._session.flush()
            # Attach barcode
            lbc = LocationBarcode(
                location_id=loc.id,
                barcode_value=f"LOC:{code}",
                barcode_type="qr",
            )
            self._session.add(lbc)
            await self._session.flush()
        return loc

    @staticmethod
    def _safe_decimal(val: object, default: str = "0") -> Decimal:
        try:
            return Decimal(str(val)).quantize(Decimal("0.0001"))
        except (InvalidOperation, TypeError):
            return Decimal(default)

    @staticmethod
    def _safe_int(val: object, default: int = 0) -> int:
        try:
            return int(float(str(val)))
        except (ValueError, TypeError):
            return default
