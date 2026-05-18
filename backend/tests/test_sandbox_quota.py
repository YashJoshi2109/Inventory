import pytest

def test_user_model_has_sandbox_copilot_msgs_used():
    from app.models.user import User
    u = User.__table__.columns
    assert "sandbox_copilot_msgs_used" in u, "Column missing from User model"
    col = u["sandbox_copilot_msgs_used"]
    assert col.server_default is not None or col.default is not None

def test_sandbox_copilot_limit_constant():
    from app.core.config import settings
    assert settings.SANDBOX_COPILOT_LIMIT == 10

def test_sandbox_header_detection():
    from app.core.sandbox import is_sandbox_request
    from unittest.mock import MagicMock
    req_sandbox = MagicMock()
    req_sandbox.headers = {"X-Sandbox-Mode": "true"}
    assert is_sandbox_request(req_sandbox) is True

    req_normal = MagicMock()
    req_normal.headers = {}
    assert is_sandbox_request(req_normal) is False
