from app.core.config import settings
from app.models.user import User


def sandbox_owner_id(current_user: User) -> int | None:
    """Return current_user.id if SANDBOX_MODE is active, else None.

    Pass the return value as `owner_id` to repository methods.
    Repos skip the filter when owner_id is None (prod behaviour unchanged).
    """
    return current_user.id if settings.SANDBOX_MODE else None
