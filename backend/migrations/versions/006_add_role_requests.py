"""add_role_requests_table

Revision ID: 006_add_role_requests
Revises: 005_add_passkey_transports
Create Date: 2026-03-31 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "006_add_role_requests"
down_revision = "005_add_passkey_transports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "role_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("requested_role", sa.String(length=50), nullable=False, server_default="manager"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column(
            "reviewed_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_role_requests"),
    )
    op.create_index("ix_role_requests_user_id", "role_requests", ["user_id"])
    op.create_index("ix_role_requests_status", "role_requests", ["status"])


def downgrade() -> None:
    op.drop_index("ix_role_requests_status", table_name="role_requests")
    op.drop_index("ix_role_requests_user_id", table_name="role_requests")
    op.drop_table("role_requests")
