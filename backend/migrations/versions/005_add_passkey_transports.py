"""add_passkey_transports_column

Revision ID: 005_add_passkey_transports
Revises: 004_add_passkey_credentials
Create Date: 2026-03-29 00:01:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = '005_add_passkey_transports'
down_revision = '004_add_passkey_credentials'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('passkey_credentials', sa.Column('transports', sa.String(length=255), nullable=True))


def downgrade():
    op.drop_column('passkey_credentials', 'transports')
