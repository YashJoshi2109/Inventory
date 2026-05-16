"""add sandbox owner_id and sandbox_seeded

Revision ID: 008_sandbox_owner
Revises: 007_add_user_profile_fields
Create Date: 2026-05-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '008_sandbox_owner'
down_revision: Union[str, None] = '007_add_user_profile_fields'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('sandbox_seeded', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('categories', sa.Column('owner_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_categories_owner_id_users', 'categories', 'users', ['owner_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_categories_owner_id', 'categories', ['owner_id'])
    op.add_column('items', sa.Column('owner_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_items_owner_id_users', 'items', 'users', ['owner_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_items_owner_id', 'items', ['owner_id'])
    op.add_column('areas', sa.Column('owner_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_areas_owner_id_users', 'areas', 'users', ['owner_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_areas_owner_id', 'areas', ['owner_id'])
    op.add_column('locations', sa.Column('owner_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_locations_owner_id_users', 'locations', 'users', ['owner_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_locations_owner_id', 'locations', ['owner_id'])


def downgrade() -> None:
    op.drop_index('ix_locations_owner_id', 'locations')
    op.drop_constraint('fk_locations_owner_id_users', 'locations', type_='foreignkey')
    op.drop_column('locations', 'owner_id')
    op.drop_index('ix_areas_owner_id', 'areas')
    op.drop_constraint('fk_areas_owner_id_users', 'areas', type_='foreignkey')
    op.drop_column('areas', 'owner_id')
    op.drop_index('ix_items_owner_id', 'items')
    op.drop_constraint('fk_items_owner_id_users', 'items', type_='foreignkey')
    op.drop_column('items', 'owner_id')
    op.drop_index('ix_categories_owner_id', 'categories')
    op.drop_constraint('fk_categories_owner_id_users', 'categories', type_='foreignkey')
    op.drop_column('categories', 'owner_id')
    op.drop_column('users', 'sandbox_seeded')
