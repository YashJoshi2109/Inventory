from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Area(Base):
    """Physical area of the lab (Lab A, Cold Room, Chemical Storage, etc.)."""

    __tablename__ = "areas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    building: Mapped[str | None] = mapped_column(String(100))
    floor: Mapped[str | None] = mapped_column(String(20))
    room: Mapped[str | None] = mapped_column(String(50))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    locations: Mapped[list["Location"]] = relationship(
        "Location", back_populates="area", cascade="all, delete-orphan"
    )


class Location(Base):
    """Specific bin / shelf / rack within an area.

    Hierarchy: Area → Location (bin/shelf).
    Example: Area=LAB-A → Location=LAB-A-S01-B03  (shelf 1, bin 3)
    """

    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("areas.id", ondelete="CASCADE"), nullable=False)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    shelf: Mapped[str | None] = mapped_column(String(20))
    bin_label: Mapped[str | None] = mapped_column(String(20))
    capacity: Mapped[int | None] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    area: Mapped["Area"] = relationship("Area", back_populates="locations")
    barcodes: Mapped[list["LocationBarcode"]] = relationship(
        "LocationBarcode", back_populates="location", cascade="all, delete-orphan"
    )
    stock_levels: Mapped[list["StockLevel"]] = relationship(  # type: ignore[name-defined]
        "StockLevel", back_populates="location"
    )
    inbound_events: Mapped[list["InventoryEvent"]] = relationship(  # type: ignore[name-defined]
        "InventoryEvent", back_populates="to_location", foreign_keys="InventoryEvent.to_location_id"
    )
    outbound_events: Mapped[list["InventoryEvent"]] = relationship(  # type: ignore[name-defined]
        "InventoryEvent", back_populates="from_location", foreign_keys="InventoryEvent.from_location_id"
    )


class LocationBarcode(Base):
    __tablename__ = "location_barcodes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"))
    barcode_value: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    barcode_type: Mapped[str] = mapped_column(String(20), default="qr")
    qr_image: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    label_printed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    location: Mapped["Location"] = relationship("Location", back_populates="barcodes")


from app.models.transaction import StockLevel, InventoryEvent  # noqa: E402, F401
