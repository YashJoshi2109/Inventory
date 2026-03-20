from datetime import datetime
from decimal import Decimal

from pydantic import Field, field_validator

from app.schemas.common import OrmBase


class CategoryRead(OrmBase):
    id: int
    name: str
    item_type: str
    color: str | None = None
    icon: str | None = None


class CategoryCreate(OrmBase):
    name: str = Field(min_length=1, max_length=100)
    item_type: str = "consumable"
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    icon: str | None = None
    description: str | None = None


class ItemBarcodeRead(OrmBase):
    id: int
    barcode_type: str
    barcode_value: str
    is_primary: bool
    label_printed: bool


class ItemCreate(OrmBase):
    sku: str = Field(min_length=3, max_length=50, pattern=r"^[A-Za-z0-9\-_]+$")
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    category_id: int | None = None
    unit: str = "pcs"
    unit_cost: Decimal = Decimal("0")
    sale_price: Decimal = Decimal("0")
    reorder_level: Decimal = Decimal("0")
    reorder_qty: Decimal = Decimal("0")
    lead_days: int = 7
    supplier: str | None = None
    part_number: str | None = None
    cas_number: str | None = None
    lot_number: str | None = None
    expiry_date: datetime | None = None
    hazard_class: str | None = None
    storage_conditions: str | None = None
    notes: str | None = None

    @field_validator("sku")
    @classmethod
    def sku_upper(cls, v: str) -> str:
        return v.upper()


class ItemUpdate(OrmBase):
    name: str | None = None
    description: str | None = None
    category_id: int | None = None
    unit: str | None = None
    unit_cost: Decimal | None = None
    sale_price: Decimal | None = None
    reorder_level: Decimal | None = None
    reorder_qty: Decimal | None = None
    lead_days: int | None = None
    supplier: str | None = None
    part_number: str | None = None
    cas_number: str | None = None
    lot_number: str | None = None
    expiry_date: datetime | None = None
    hazard_class: str | None = None
    storage_conditions: str | None = None
    notes: str | None = None
    is_active: bool | None = None


class ItemRead(OrmBase):
    id: int
    sku: str
    name: str
    description: str | None = None
    category: CategoryRead | None = None
    unit: str
    unit_cost: Decimal
    sale_price: Decimal
    reorder_level: Decimal
    reorder_qty: Decimal
    lead_days: int
    supplier: str | None = None
    part_number: str | None = None
    cas_number: str | None = None
    hazard_class: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    barcodes: list[ItemBarcodeRead] = []
    total_quantity: Decimal = Decimal("0")   # computed from stock_levels
    status: str = "OK"                       # OK | LOW | OUT
    # Set only on POST /items create — avoids a second request for QR preview
    qr_png_base64: str | None = None


class ItemSummary(OrmBase):
    """Lightweight list item for table/search views."""
    id: int
    sku: str
    name: str
    unit: str
    category_name: str | None = None
    total_quantity: Decimal
    reorder_level: Decimal
    status: str
    unit_cost: Decimal


class StockLevelRead(OrmBase):
    id: int
    item_id: int
    location_id: int
    location_code: str
    location_name: str
    quantity: Decimal
    last_event_at: datetime
