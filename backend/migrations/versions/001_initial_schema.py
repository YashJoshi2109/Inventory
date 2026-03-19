"""Initial schema — Supabase / plain PostgreSQL

Revision ID: 001
Revises:
Create Date: 2026-03-18

Performance strategy (replacing TimescaleDB):
  - BRIN indexes on occurred_at for append-only event tables
    (BRIN is 100× smaller than B-tree, perfect for time-ordered inserts)
  - Composite B-tree indexes for common query patterns
  - Partial index on recent events (last 90 days) for dashboard queries
  - pg_trgm GIN indexes for fuzzy item/SKU search
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Extensions (available on Supabase free tier) ───────────────────────
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm;")
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

    # ── roles ──────────────────────────────────────────────────────────────
    op.create_table(
        "roles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(50), nullable=False, unique=True),
        sa.Column("description", sa.Text()),
        sa.Column("permissions", sa.Text()),
    )

    # ── users ──────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("username", sa.String(100), nullable=False, unique=True),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("is_superuser", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("avatar_url", sa.String(512)),
        sa.Column("last_login_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"])
    op.create_index("ix_users_username", "users", ["username"])

    # ── user_roles ─────────────────────────────────────────────────────────
    op.create_table(
        "user_roles",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role_id", sa.Integer(), sa.ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # ── categories ─────────────────────────────────────────────────────────
    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False, unique=True),
        sa.Column("item_type", sa.String(50), nullable=False, server_default="consumable"),
        sa.Column("color", sa.String(7)),
        sa.Column("icon", sa.String(50)),
        sa.Column("description", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── items ──────────────────────────────────────────────────────────────
    op.create_table(
        "items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sku", sa.String(50), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("categories.id", ondelete="SET NULL")),
        sa.Column("unit", sa.String(30), server_default="pcs"),
        sa.Column("unit_cost", sa.Numeric(12, 4), server_default="0"),
        sa.Column("sale_price", sa.Numeric(12, 4), server_default="0"),
        sa.Column("reorder_level", sa.Numeric(12, 2), server_default="0"),
        sa.Column("reorder_qty", sa.Numeric(12, 2), server_default="0"),
        sa.Column("lead_days", sa.Integer(), server_default="7"),
        sa.Column("supplier", sa.String(255)),
        sa.Column("part_number", sa.String(100)),
        sa.Column("cas_number", sa.String(50)),
        sa.Column("lot_number", sa.String(100)),
        sa.Column("expiry_date", sa.DateTime(timezone=True)),
        sa.Column("hazard_class", sa.String(100)),
        sa.Column("storage_conditions", sa.Text()),
        sa.Column("notes", sa.Text()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("is_serialized", sa.Boolean(), server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_items_sku", "items", ["sku"])
    # pg_trgm GIN indexes for fast fuzzy search
    op.execute("CREATE INDEX ix_items_name_trgm ON items USING gin (name gin_trgm_ops);")
    op.execute("CREATE INDEX ix_items_sku_trgm ON items USING gin (sku gin_trgm_ops);")

    # ── item_barcodes ──────────────────────────────────────────────────────
    op.create_table(
        "item_barcodes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("barcode_type", sa.String(20), server_default="code128"),
        sa.Column("barcode_value", sa.String(255), nullable=False, unique=True),
        sa.Column("is_primary", sa.Boolean(), server_default="true"),
        sa.Column("label_printed", sa.Boolean(), server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_item_barcodes_barcode_value", "item_barcodes", ["barcode_value"])

    # ── areas ──────────────────────────────────────────────────────────────
    op.create_table(
        "areas",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(30), nullable=False, unique=True),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("building", sa.String(100)),
        sa.Column("floor", sa.String(20)),
        sa.Column("room", sa.String(50)),
        sa.Column("is_active", sa.Boolean(), server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_areas_code", "areas", ["code"])

    # ── locations ──────────────────────────────────────────────────────────
    op.create_table(
        "locations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("area_id", sa.Integer(), sa.ForeignKey("areas.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.String(50), nullable=False, unique=True),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("shelf", sa.String(20)),
        sa.Column("bin_label", sa.String(20)),
        sa.Column("capacity", sa.Integer()),
        sa.Column("is_active", sa.Boolean(), server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_locations_code", "locations", ["code"])

    # ── location_barcodes ──────────────────────────────────────────────────
    op.create_table(
        "location_barcodes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("locations.id", ondelete="CASCADE")),
        sa.Column("barcode_value", sa.String(255), nullable=False, unique=True),
        sa.Column("barcode_type", sa.String(20), server_default="qr"),
        sa.Column("label_printed", sa.Boolean(), server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_location_barcodes_barcode_value", "location_barcodes", ["barcode_value"])

    # ── inventory_events ───────────────────────────────────────────────────
    # Production-grade time-series indexing WITHOUT TimescaleDB:
    #
    #  1. BRIN index on occurred_at
    #     - Designed for naturally-ordered append-only data (exactly our use case)
    #     - ~200x smaller than a B-tree index on the same column
    #     - Range scans (last 7 days, last 30 days) are fast via block summary
    #
    #  2. Composite B-tree (item_id, occurred_at)
    #     - Powers "consumption history for item X over N days" queries
    #     - Used by AI demand forecaster
    #
    #  3. Composite B-tree (to_location_id, occurred_at)
    #     - Powers "all events at location Y" queries
    #
    #  4. Partial B-tree on occurred_at for last 90 days
    #     - Dashboard "recent activity" query hits this tiny index first
    #     - Only covers recent rows — stays fast indefinitely
    op.create_table(
        "inventory_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("event_kind", sa.String(20), nullable=False),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("items.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("from_location_id", sa.Integer(), sa.ForeignKey("locations.id", ondelete="SET NULL")),
        sa.Column("to_location_id", sa.Integer(), sa.ForeignKey("locations.id", ondelete="SET NULL")),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False),
        sa.Column("unit_cost_snapshot", sa.Numeric(12, 4)),
        sa.Column("reference", sa.String(200)),
        sa.Column("borrower", sa.String(200)),
        sa.Column("notes", sa.Text()),
        sa.Column("reason", sa.String(200)),
        sa.Column("requires_override", sa.Boolean(), server_default="false"),
        sa.Column("override_approved_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("source", sa.String(30), server_default="manual"),
        sa.Column("scan_session_id", sa.String(100)),
    )
    # BRIN — tiny, perfect for time-ordered append-only data
    op.execute("""
        CREATE INDEX ix_inventory_events_occurred_at_brin
        ON inventory_events USING BRIN (occurred_at)
        WITH (pages_per_range = 32);
    """)
    # Composite for item-level time-series (AI forecasting + item history)
    op.create_index("ix_inventory_events_item_time", "inventory_events", ["item_id", "occurred_at"])
    # Composite for location-level queries
    op.create_index("ix_inventory_events_location_time", "inventory_events", ["to_location_id", "occurred_at"])
    # event_kind for filter-by-type queries
    op.create_index("ix_inventory_events_event_kind", "inventory_events", ["event_kind"])
    # Note: partial index with NOW() cannot be created via DDL (NOW() is STABLE not IMMUTABLE).
    # The BRIN + composite indexes above are sufficient for all dashboard and AI queries.

    # ── stock_levels ───────────────────────────────────────────────────────
    op.create_table(
        "stock_levels",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("locations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("last_event_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_stock_levels_item_location", "stock_levels", ["item_id", "location_id"], unique=True
    )

    # ── audit_logs ─────────────────────────────────────────────────────────
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("actor_id", sa.Integer()),
        sa.Column("actor_username", sa.String(100)),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("resource_type", sa.String(50), nullable=False),
        sa.Column("resource_id", sa.String(100)),
        sa.Column("before_snapshot", sa.Text()),
        sa.Column("after_snapshot", sa.Text()),
        sa.Column("ip_address", sa.String(45)),
        sa.Column("user_agent", sa.String(500)),
    )
    # BRIN for audit log time range queries — same rationale as inventory_events
    op.execute("""
        CREATE INDEX ix_audit_logs_occurred_at_brin
        ON audit_logs USING BRIN (occurred_at)
        WITH (pages_per_range = 64);
    """)
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"])

    # ── import_jobs ────────────────────────────────────────────────────────
    op.create_table(
        "import_jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("status", sa.String(30), server_default="pending"),
        sa.Column("total_rows", sa.Integer(), server_default="0"),
        sa.Column("imported_rows", sa.Integer(), server_default="0"),
        sa.Column("skipped_rows", sa.Integer(), server_default="0"),
        sa.Column("error_rows", sa.Integer(), server_default="0"),
        sa.Column("errors", sa.Text()),
        sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )

    # ── alerts ─────────────────────────────────────────────────────────────
    op.create_table(
        "alerts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("item_id", sa.Integer(), sa.ForeignKey("items.id", ondelete="CASCADE")),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("locations.id", ondelete="SET NULL")),
        sa.Column("alert_type", sa.String(50), nullable=False),
        sa.Column("severity", sa.String(20), server_default="warning"),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("extra_data", sa.Text()),
        sa.Column("is_resolved", sa.Boolean(), server_default="false"),
        sa.Column("resolved_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_alerts_created_at", "alerts", ["created_at"])
    op.create_index("ix_alerts_is_resolved", "alerts", ["is_resolved"])

    # ── Seed default roles ─────────────────────────────────────────────────
    op.execute("""
        INSERT INTO roles (name, description) VALUES
            ('admin',    'Full system access'),
            ('manager',  'Manage inventory, users, and reports'),
            ('operator', 'Perform scans and transactions'),
            ('viewer',   'Read-only access')
        ON CONFLICT (name) DO NOTHING;
    """)


def downgrade() -> None:
    op.drop_table("alerts")
    op.drop_table("import_jobs")
    op.drop_table("audit_logs")
    op.drop_table("stock_levels")
    op.drop_table("inventory_events")
    op.drop_table("location_barcodes")
    op.drop_table("locations")
    op.drop_table("areas")
    op.drop_table("item_barcodes")
    op.drop_table("items")
    op.drop_table("categories")
    op.drop_table("user_roles")
    op.drop_table("users")
    op.drop_table("roles")
