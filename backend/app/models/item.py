from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Integer, Numeric,
    String, Text, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ItemType(StrEnum):
    CONSUMABLE = "consumable"
    CHEMICAL = "chemical"
    EQUIPMENT = "equipment"
    SUPPLY = "supply"
    ASSET = "asset"


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    item_type: Mapped[str] = mapped_column(String(50), nullable=False, default=ItemType.CONSUMABLE)
    color: Mapped[str | None] = mapped_column(String(7))   # hex color for UI badges
    icon: Mapped[str | None] = mapped_column(String(50))   # lucide icon name
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    items: Mapped[list["Item"]] = relationship("Item", back_populates="category")


class Item(Base):
    """Inventory item master record."""

    __tablename__ = "items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sku: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))

    unit: Mapped[str] = mapped_column(String(30), default="pcs")    # pcs, mL, g, box …
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=0)
    sale_price: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=0)

    reorder_level: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    reorder_qty: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    lead_days: Mapped[int] = mapped_column(Integer, default=7)

    supplier: Mapped[str | None] = mapped_column(String(255))
    part_number: Mapped[str | None] = mapped_column(String(100))
    cas_number: Mapped[str | None] = mapped_column(String(50))       # for chemicals
    lot_number: Mapped[str | None] = mapped_column(String(100))
    expiry_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    hazard_class: Mapped[str | None] = mapped_column(String(100))    # GHS hazard
    storage_conditions: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_serialized: Mapped[bool] = mapped_column(Boolean, default=False)  # track individual units

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    category: Mapped["Category | None"] = relationship("Category", back_populates="items")
    barcodes: Mapped[list["ItemBarcode"]] = relationship(
        "ItemBarcode", back_populates="item", cascade="all, delete-orphan"
    )
    stock_levels: Mapped[list["StockLevel"]] = relationship(  # type: ignore[name-defined]
        "StockLevel", back_populates="item", cascade="all, delete-orphan"
    )
    events: Mapped[list["InventoryEvent"]] = relationship(  # type: ignore[name-defined]
        "InventoryEvent", back_populates="item"
    )


class ItemBarcode(Base):
    """One item can have multiple barcode representations (Code128, QR, RFID tag)."""

    __tablename__ = "item_barcodes"
    __table_args__ = (UniqueConstraint("barcode_value", name="uq_item_barcodes_value"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), nullable=False)
    barcode_type: Mapped[str] = mapped_column(String(20), default="code128")   # code128 | qr | rfid
    barcode_value: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=True)
    label_printed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    item: Mapped["Item"] = relationship("Item", back_populates="barcodes")


# deferred to avoid circular import
from app.models.transaction import StockLevel, InventoryEvent  # noqa: E402, F401
