"""add user profile fields and seed Eric Jones as superuser

Revision ID: 007_add_user_profile_fields
Revises: de43eb1fd68f
Create Date: 2026-04-30

Adds bio, linkedin_url, portfolio_url to users table.
Seeds Eric Jones (SEAR Lab director) as the system superuser.
"""
from alembic import op
import sqlalchemy as sa

revision = "007_add_user_profile_fields"
down_revision = "006_add_role_requests"
branch_labels = None
depends_on = None

ERIC_HASHED_PW = "$2b$12$.5uaz2MYgiKXj9H/GZuhTuMabVrZ1S523reVKvt2L1cgHG8fUjwyG"


def upgrade() -> None:
    # ── Add profile columns ────────────────────────────────────────────────
    op.add_column("users", sa.Column("bio", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("linkedin_url", sa.String(512), nullable=True))
    op.add_column("users", sa.Column("portfolio_url", sa.String(512), nullable=True))

    # ── Seed Eric Jones as superuser ───────────────────────────────────────
    op.execute(
        """
        INSERT INTO users (
            email, username, full_name, hashed_password,
            is_active, is_superuser, email_verified,
            avatar_url, bio, linkedin_url, portfolio_url,
            created_at, updated_at
        ) VALUES (
            'erick.jones@uta.edu',
            'Eric',
            'Eric Jones',
            '%(pw)s',
            true, true, true,
            '/eric-jones.png',
            'Assistant Professor, Industrial, Systems, and Manufacturing Engineering',
            'https://www.linkedin.com/in/erickjones2/',
            'https://www.erickjonesphd.com/',
            NOW(), NOW()
        )
        ON CONFLICT (email) DO UPDATE SET
            username        = EXCLUDED.username,
            full_name       = EXCLUDED.full_name,
            hashed_password = EXCLUDED.hashed_password,
            is_active       = true,
            is_superuser    = true,
            email_verified  = true,
            avatar_url      = EXCLUDED.avatar_url,
            bio             = EXCLUDED.bio,
            linkedin_url    = EXCLUDED.linkedin_url,
            portfolio_url   = EXCLUDED.portfolio_url;
        """
        % {"pw": ERIC_HASHED_PW}
    )

    # Assign admin role to Eric Jones
    op.execute(
        """
        INSERT INTO user_roles (user_id, role_id)
        SELECT u.id, r.id
        FROM users u, roles r
        WHERE u.email = 'erick.jones@uta.edu'
          AND r.name = 'admin'
        ON CONFLICT DO NOTHING;
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM users WHERE email = 'erick.jones@uta.edu';")
    op.drop_column("users", "portfolio_url")
    op.drop_column("users", "linkedin_url")
    op.drop_column("users", "bio")
