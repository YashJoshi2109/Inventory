"""add_otp_and_email_verification_fields

Revision ID: 003_add_otp_fields
Revises: de43eb1fd68f_add_chat_and_knowledge_tables
Create Date: 2026-03-28 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '003_add_otp_fields'
down_revision = 'de43eb1fd68f'
branch_labels = None
depends_on = None


def upgrade():
    """Add OTP and email verification fields to users table."""
    op.add_column('users', sa.Column('email_verified', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('users', sa.Column('otp_code', sa.String(length=6), nullable=True))
    op.add_column('users', sa.Column('otp_expires_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    """Remove OTP and email verification fields."""
    op.drop_column('users', 'otp_expires_at')
    op.drop_column('users', 'otp_code')
    op.drop_column('users', 'email_verified')
