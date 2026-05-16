from fastapi import Request
from app.models.user import User


def is_sandbox_request(request: Request) -> bool:
    return request.headers.get("X-Sandbox-Mode", "").lower() == "true"


def sandbox_owner_id(request: Request, current_user: User) -> int | None:
    """Return current_user.id when the request carries X-Sandbox-Mode: true.

    Pass the return value as `owner_id` to repository methods.
    Repos skip the filter when owner_id is None (normal behaviour unchanged).
    """
    return current_user.id if is_sandbox_request(request) else None
