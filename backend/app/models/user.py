from datetime import datetime, timezone
from enum import StrEnum

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class RoleName(StrEnum):
    ADMIN = "admin"
    MANAGER = "manager"
    OPERATOR = "operator"
    VIEWER = "viewer"


class RoleRequestStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    permissions: Mapped[str | None] = mapped_column(Text)  # JSON list of permission strings

    users: Mapped[list["UserRole"]] = relationship("UserRole", back_populates="role")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(512))
    bio: Mapped[str | None] = mapped_column(Text)
    linkedin_url: Mapped[str | None] = mapped_column(String(512))
    portfolio_url: Mapped[str | None] = mapped_column(String(512))
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    otp_code: Mapped[str | None] = mapped_column(String(6))
    otp_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sandbox_seeded: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    roles: Mapped[list["UserRole"]] = relationship("UserRole", back_populates="user")
    passkeys: Mapped[list["PasskeyCredential"]] = relationship(
        "PasskeyCredential", back_populates="user", cascade="all, delete-orphan"
    )
    inventory_events: Mapped[list["InventoryEvent"]] = relationship(  # type: ignore[name-defined]
        "InventoryEvent", back_populates="actor", foreign_keys="InventoryEvent.actor_id"
    )
    role_requests: Mapped[list["RoleRequest"]] = relationship(
        "RoleRequest", foreign_keys="RoleRequest.user_id", back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def role_names(self) -> list[str]:
        return [ur.role.name for ur in self.roles if ur.role]


class UserRole(Base):
    __tablename__ = "user_roles"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True)
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship("User", back_populates="roles")
    role: Mapped["Role"] = relationship("Role", back_populates="users")


class PasskeyCredential(Base):
    """Stores WebAuthn / passkey credentials for biometric login (Face ID, Touch ID, FIDO2 keys)."""
    __tablename__ = "passkey_credentials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # base64url-encoded credential ID from the authenticator
    credential_id: Mapped[str] = mapped_column(String(1024), unique=True, nullable=False, index=True)
    # CBOR-encoded public key bytes stored as hex
    public_key: Mapped[str] = mapped_column(Text, nullable=False)
    sign_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Comma-separated transports reported by authenticator: "internal", "usb", "nfc", "ble", "hybrid"
    # "internal" = platform (Touch ID / Face ID / Windows Hello)
    transports: Mapped[str | None] = mapped_column(String(255))
    # Human-readable device name (e.g. "iPhone Face ID", "Windows Hello")
    device_name: Mapped[str | None] = mapped_column(String(255))
    # AAGUID for device type identification
    aaguid: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped["User"] = relationship("User", back_populates="passkeys")


class RoleRequest(Base):
    """
    Tracks user requests to be granted the Manager role.
    When a user registers with role='manager' or requests an upgrade,
    their account is assigned Viewer and a pending RoleRequest is created.
    An existing Manager/Admin must approve before the Manager role is granted.
    """

    __tablename__ = "role_requests"
    __table_args__ = (
        Index("ix_role_requests_user_id", "user_id"),
        Index("ix_role_requests_status", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    requested_role: Mapped[str] = mapped_column(String(50), nullable=False, default="manager")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    # Optional reason the user provides for needing the role
    message: Mapped[str | None] = mapped_column(Text)
    # Who reviewed the request
    reviewed_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Note from the reviewer (e.g. reason for rejection)
    review_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id], back_populates="role_requests")
    reviewer: Mapped["User | None"] = relationship("User", foreign_keys=[reviewed_by])


# Deferred import to avoid circular references
from app.models.transaction import InventoryEvent  # noqa: E402, F401
