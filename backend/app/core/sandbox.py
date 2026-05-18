from __future__ import annotations
from typing import TYPE_CHECKING

from fastapi import Request
from sqlalchemy import ColumnElement

if TYPE_CHECKING:
    from app.models.user import User

# Sentinel: normal mode passes 0 → repos filter WHERE owner_id IS NULL
# Sandbox mode passes user.id (>0) → repos filter WHERE owner_id = user.id
# Background/admin tasks pass None → no owner filter at all
REAL_DATA: int = 0


def is_sandbox_request(request: Request) -> bool:
    return request.headers.get("X-Sandbox-Mode", "").lower() == "true"


def sandbox_owner_id(request: Request, current_user: "User") -> int:
    """Return current_user.id (sandbox) or 0 (real data) based on request header."""
    return current_user.id if is_sandbox_request(request) else REAL_DATA


def owner_filter(col: ColumnElement, owner_id: int | None) -> ColumnElement | None:
    """Build a WHERE clause for owner scoping.

    owner_id=None  → no filter (background tasks / admin)
    owner_id=0     → WHERE col IS NULL  (normal mode, real data)
    owner_id>0     → WHERE col = owner_id  (sandbox mode)
    """
    if owner_id is None:
        return None
    if owner_id == 0:
        return col.is_(None)
    return col == owner_id


def owns(record_owner_id: int | None, request_owner_id: int | None) -> bool:
    """Check if a request has access to a specific record.

    request_owner_id=None → admin/background: full access
    request_owner_id=0    → normal mode: can only access real records (owner_id IS NULL)
    request_owner_id>0    → sandbox mode: can only access own records
    """
    if request_owner_id is None:
        return True
    if request_owner_id == 0:
        return record_owner_id is None
    return record_owner_id == request_owner_id
