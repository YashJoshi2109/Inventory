from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import Field, model_validator

from app.schemas.common import OrmBase


class StockInRequest(OrmBase):
    """Scan workflow: stock-in."""
    item_id: int
    location_id: int
    quantity: Decimal = Field(gt=0)
    unit_cost: Decimal | None = None
    reference: str | None = None
    notes: str | None = None
    scan_session_id: str | None = None
    source: str = "scan"


class StockOutRequest(OrmBase):
    """Scan workflow: stock-out."""
    item_id: int
    location_id: int
    quantity: Decimal = Field(gt=0)
    reason: str | None = None
    reference: str | None = None
    borrower: str | None = None
    notes: str | None = None
    scan_session_id: str | None = None
    source: str = "scan"
    override_negative: bool = False  # requires MANAGER+ role


class TransferRequest(OrmBase):
    """Move item from one location to another."""
    item_id: int
    from_location_id: int
    to_location_id: int
    quantity: Decimal = Field(gt=0)
    reference: str | None = None
    notes: str | None = None
    scan_session_id: str | None = None

    @model_validator(mode="after")
    def locations_differ(self) -> "TransferRequest":
        if self.from_location_id == self.to_location_id:
            raise ValueError("Source and destination locations must differ")
        return self


class AdjustmentRequest(OrmBase):
    """Cycle count / manual correction."""
    item_id: int
    location_id: int
    new_quantity: Decimal = Field(ge=0)
    reason: str
    notes: str | None = None


class ScanLookupRequest(OrmBase):
    """Decode a scanned barcode and return its context."""
    barcode_value: str


class BarcodeScanApplyRequest(OrmBase):
    """Apply stock operation directly from scanned barcodes."""
    item_barcode: str = Field(min_length=1)
    rack_barcode: str = Field(min_length=1)
    event_type: Literal["stock_in", "stock_out", "transfer"] = "stock_out"
    destination_rack_barcode: str | None = None
    quantity: Decimal = Field(gt=0)
    reason: str | None = None
    reference: str | None = None
    borrower: str | None = None
    notes: str | None = None
    override_negative: bool = False
    scan_session_id: str | None = None
    source: str = "scan"

    @model_validator(mode="after")
    def validate_transfer_destination(self) -> "BarcodeScanApplyRequest":
        if self.event_type == "transfer" and not self.destination_rack_barcode:
            raise ValueError("destination_rack_barcode is required for transfer")
        return self


class InventoryEventRead(OrmBase):
    id: int
    occurred_at: datetime
    event_kind: str
    item_id: int
    item_sku: str
    item_name: str
    from_location_id: int | None = None
    from_location_code: str | None = None
    to_location_id: int | None = None
    to_location_code: str | None = None
    quantity: Decimal
    reference: str | None = None
    borrower: str | None = None
    notes: str | None = None
    reason: str | None = None
    actor_username: str | None = None
    source: str


class AlertRead(OrmBase):
    id: int
    item_id: int | None = None
    item_sku: str | None = None
    item_name: str | None = None
    alert_type: str
    severity: str
    message: str
    is_resolved: bool
    created_at: datetime


class DashboardStats(OrmBase):
    total_items: int
    total_skus: int
    items_low_stock: int
    items_out_of_stock: int
    total_inventory_value: Decimal
    transactions_today: int
    transactions_this_week: int
    active_alerts: int
    category_breakdown: list[dict]
    recent_activity: list[InventoryEventRead]
    top_consumed: list[dict]


class EmailServiceStatusRead(OrmBase):
    """Email provider summary for the portal (no secrets)."""

    active_provider: str | None = None
    brevo_configured: bool = False
    resend_configured: bool = False
    smtp_configured: bool = False
    daily_limit_hint: int | None = None
    brevo_credits_remaining: int | None = None
    note: str = ""
