"""010_sandbox_copilot_quota

Revision ID: f82f8485b034
Revises: 009_sandbox_energy_readings
Create Date: 2026-05-18 16:01:43.697855

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f82f8485b034'
down_revision: Union[str, None] = '009_sandbox_energy_readings'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('sandbox_copilot_msgs_used', sa.Integer(), server_default='0', nullable=False))


def downgrade() -> None:
    op.drop_column('users', 'sandbox_copilot_msgs_used')
