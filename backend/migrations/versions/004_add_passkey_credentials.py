"""add_passkey_credentials_table

Revision ID: 004_add_passkey_credentials
Revises: 003_add_otp_fields
Create Date: 2026-03-29 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = '004_add_passkey_credentials'
down_revision = '003_add_otp_fields'
branch_labels = None
depends_on = None


def upgrade():
    """Create passkey_credentials table for WebAuthn / biometric login."""
    op.create_table(
        'passkey_credentials',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('credential_id', sa.String(length=1024), unique=True, nullable=False),
        sa.Column('public_key', sa.Text(), nullable=False),
        sa.Column('sign_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('device_name', sa.String(length=255), nullable=True),
        sa.Column('aaguid', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_passkey_credentials_user_id', 'passkey_credentials', ['user_id'])
    op.create_index('ix_passkey_credentials_credential_id', 'passkey_credentials', ['credential_id'], unique=True)


def downgrade():
    op.drop_index('ix_passkey_credentials_credential_id', table_name='passkey_credentials')
    op.drop_index('ix_passkey_credentials_user_id', table_name='passkey_credentials')
    op.drop_table('passkey_credentials')
