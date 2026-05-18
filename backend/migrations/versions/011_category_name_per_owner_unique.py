"""011_cat_name_owner_uniq

Revision ID: 011_cat_name_owner_uniq
Revises: f82f8485b034
Create Date: 2026-05-18

Drop the global unique constraint on categories.name and replace it with:
  - A partial unique index for real data (owner_id IS NULL)
  - No constraint for sandbox-owned categories (owner_id IS NOT NULL)
This allows sandbox users to have categories with the same names as real ones.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "011_cat_name_owner_uniq"
down_revision: Union[str, None] = "f82f8485b034"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop the global unique constraint on name
    op.drop_constraint("uq_categories_name", "categories", type_="unique")
    # Add partial unique index: only enforce uniqueness among real (unowned) categories
    op.execute(
        "CREATE UNIQUE INDEX uq_categories_name_real ON categories (name) WHERE owner_id IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_categories_name_real")
    op.create_unique_constraint("uq_categories_name", "categories", ["name"])
