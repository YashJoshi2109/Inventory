"""
Transaction and audit models.

InventoryEvent and AuditLog are append-only event ledger tables.
Performance on Supabase / plain PostgreSQL is achieved via:
  - BRIN indexes on occurred_at (tiny, perfect for time-ordered inserts)
  - Composite B-tree indexes on (item_id, occurred_at) for time-series queries
  - Partial index on last 90 days for dashboard queries
See migration 001 for full indexing strategy.
"""
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Integer, Numeric,
    String, Text, func, Index,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class EventKind(StrEnum):
    STOCK_IN = "STOCK_IN"
    STOCK_OUT = "STOCK_OUT"
    TRANSFER = "TRANSFER"
    ADJUSTMENT = "ADJUSTMENT"
    CYCLE_COUNT = "CYCLE_COUNT"
    IMPORT = "IMPORT"


class AlertSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class InventoryEvent(Base):
    """
    Immutable ledger of every inventory movement.

    Design principles:
    - Never update or delete rows; adjustments create new ADJUSTMENT events.
    - Double-entry: TRANSFER debits from_location and credits to_location.
    - quantity_delta is always positive; direction is encoded in event_kind.
    """

    __tablename__ = "inventory_events"
    __table_args__ = (
        Index("ix_inventory_events_item_time", "item_id", "occurred_at"),
        Index("ix_inventory_events_location_time", "to_location_id", "occurred_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    event_kind: Mapped[str] = mapped_column(String(20), nullable=False, index=True)

    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="RESTRICT"), nullable=False)
    from_location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id", ondelete="SET NULL"))
    to_location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id", ondelete="SET NULL"))

    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    unit_cost_snapshot: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))  # cost at time of event

    # Context
    reference: Mapped[str | None] = mapped_column(String(200))   # experiment/project/PO number
    borrower: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    reason: Mapped[str | None] = mapped_column(String(200))      # for OUT / ADJUSTMENT
    requires_override: Mapped[bool] = mapped_column(Boolean, default=False)
    override_approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    # Source tracing
    source: Mapped[str] = mapped_column(String(30), default="manual")  # manual | scan | import | api
    scan_session_id: Mapped[str | None] = mapped_column(String(100))   # groups scan workflow events

    item: Mapped["Item"] = relationship("Item", back_populates="events", foreign_keys=[item_id])  # type: ignore[name-defined]
    from_location: Mapped["Location | None"] = relationship(  # type: ignore[name-defined]
        "Location", back_populates="outbound_events", foreign_keys=[from_location_id]
    )
    to_location: Mapped["Location | None"] = relationship(  # type: ignore[name-defined]
        "Location", back_populates="inbound_events", foreign_keys=[to_location_id]
    )
    actor: Mapped["User | None"] = relationship(  # type: ignore[name-defined]
        "User", back_populates="inventory_events", foreign_keys=[actor_id]
    )


class StockLevel(Base):
    """
    Materialised view of current stock per (item, location).
    Updated transactionally alongside InventoryEvent inserts via the service layer.
    Avoids expensive SUM() aggregates on the events table for every request.
    """

    __tablename__ = "stock_levels"
    __table_args__ = (
        Index("ix_stock_levels_item_location", "item_id", "location_id", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), nullable=False)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=0, nullable=False)
    last_event_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    item: Mapped["Item"] = relationship("Item", back_populates="stock_levels")  # type: ignore[name-defined]
    location: Mapped["Location"] = relationship("Location", back_populates="stock_levels")  # type: ignore[name-defined]


class AuditLog(Base):
    """
    System-wide audit trail — append-only, indexed with BRIN on occurred_at.
    Records every mutation with before/after snapshots.
    """

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    actor_id: Mapped[int | None] = mapped_column(Integer)
    actor_username: Mapped[str | None] = mapped_column(String(100))
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(100))
    before_snapshot: Mapped[str | None] = mapped_column(Text)   # JSON
    after_snapshot: Mapped[str | None] = mapped_column(Text)    # JSON
    ip_address: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(String(500))


class ImportJob(Base):
    __tablename__ = "import_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="pending")  # pending|processing|done|failed
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    imported_rows: Mapped[int] = mapped_column(Integer, default=0)
    skipped_rows: Mapped[int] = mapped_column(Integer, default=0)
    error_rows: Mapped[int] = mapped_column(Integer, default=0)
    errors: Mapped[str | None] = mapped_column(Text)   # JSON array of error messages
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    item_id: Mapped[int | None] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"))
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id", ondelete="SET NULL"))
    alert_type: Mapped[str] = mapped_column(String(50), nullable=False)   # low_stock | anomaly | expiry
    severity: Mapped[str] = mapped_column(String(20), default=AlertSeverity.WARNING)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    extra_data: Mapped[str | None] = mapped_column(Text)   # JSON
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    resolved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


from app.models.item import Item  # noqa: E402, F401
from app.models.location import Location  # noqa: E402, F401
from app.models.user import User  # noqa: E402, F401
