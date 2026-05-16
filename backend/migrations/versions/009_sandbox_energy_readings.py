"""add owner_id to energy_readings for sandbox per-user isolation

Revision ID: 009_sandbox_energy_readings
Revises: 008_sandbox_owner
Create Date: 2026-05-16

Idempotent: creates the table if it doesn't exist (fresh sandbox DB),
then adds owner_id if missing (existing dev/prod DB).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision: str = '009_sandbox_energy_readings'
down_revision: Union[str, None] = '008_sandbox_owner'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create the table if it doesn't exist (fresh sandbox DB install)
    op.execute(text("""
        CREATE TABLE IF NOT EXISTS energy_readings (
            id BIGSERIAL PRIMARY KEY,
            timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ac_device_name TEXT,
            ac_power_mode TEXT,
            ac_operation_mode TEXT,
            ac_run_state TEXT,
            ac_current_temp_c DOUBLE PRECISION,
            ac_target_temp_c DOUBLE PRECISION,
            ac_current_temp_f DOUBLE PRECISION,
            ac_target_temp_f DOUBLE PRECISION,
            ac_fan_speed TEXT,
            ac_recommendation TEXT,
            ac_consumption_w DOUBLE PRECISION DEFAULT 0,
            hwh_set_point_f DOUBLE PRECISION,
            hwh_mode TEXT,
            hwh_mode_name TEXT,
            hwh_running BOOLEAN DEFAULT false,
            hwh_tank_health DOUBLE PRECISION,
            hwh_compressor_health DOUBLE PRECISION,
            hwh_todays_energy_kwh DOUBLE PRECISION,
            hwh_connected BOOLEAN DEFAULT true,
            hwh_recommendation TEXT,
            hwh_consumption_w DOUBLE PRECISION DEFAULT 0,
            solar_current_power_w DOUBLE PRECISION DEFAULT 0,
            solar_energy_lifetime_wh DOUBLE PRECISION,
            solar_system_status TEXT,
            total_consumption_w DOUBLE PRECISION DEFAULT 0,
            net_balance_w DOUBLE PRECISION DEFAULT 0,
            overall_recommendation TEXT,
            recommendation_reason TEXT
        )
    """))
    # Add owner_id if not already present (idempotent for existing DBs)
    op.execute(text("""
        ALTER TABLE energy_readings
        ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE
    """))
    op.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_energy_readings_owner_id ON energy_readings(owner_id)
    """))
    op.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_energy_readings_timestamp ON energy_readings(timestamp DESC)
    """))


def downgrade() -> None:
    op.execute(text("DROP INDEX IF EXISTS ix_energy_readings_owner_id"))
    op.execute(text("ALTER TABLE energy_readings DROP COLUMN IF EXISTS owner_id"))
