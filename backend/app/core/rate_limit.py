"""
Lightweight in-memory rate limiter — streaming-safe.

Uses a sliding-window counter per IP. Works correctly with StreamingResponse /
SSE because it only counts REQUESTS (never buffers response bodies).

Limits (configurable via settings):
  - Chat messages: 30 / minute / IP
  - All API calls: 300 / minute / IP (generous default for lab tools)
"""
from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


class SlidingWindowRateLimiter:
    """Thread-safe (asyncio) sliding-window rate counter."""

    def __init__(self, limit: int, window_seconds: int) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def is_allowed(self, key: str) -> tuple[bool, int]:
        """Returns (allowed, retry_after_seconds)."""
        now = time.monotonic()
        cutoff = now - self.window
        bucket = self._hits[key]
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= self.limit:
            retry_after = int(self.window - (now - bucket[0])) + 1
            return False, retry_after
        bucket.append(now)
        return True, 0

    def status(self, key: str) -> dict[str, int]:
        """
        Read-only status for UI/monitoring.

        Does not add a hit; only evicts expired hits from the sliding window.
        """
        now = time.monotonic()
        cutoff = now - self.window
        bucket = self._hits[key]
        while bucket and bucket[0] < cutoff:
            bucket.popleft()

        used = len(bucket)
        remaining = max(0, self.limit - used)
        if remaining > 0:
            retry_after = 0
        elif used > 0:
            retry_after = int(self.window - (now - bucket[0])) + 1
        else:
            retry_after = 0

        return {
            "limit": self.limit,
            "window_seconds": self.window,
            "used": used,
            "remaining": remaining,
            "retry_after_seconds": retry_after,
        }


# Shared instances
_chat_limiter   = SlidingWindowRateLimiter(limit=30,  window_seconds=60)
_global_limiter = SlidingWindowRateLimiter(limit=300, window_seconds=60)

# Vision AI: keyed on user_id string — 15 scans / user / hour, 50 / user / day
_vision_hourly_limiter = SlidingWindowRateLimiter(limit=15, window_seconds=3600)
_vision_daily_limiter  = SlidingWindowRateLimiter(limit=50, window_seconds=86400)


def check_vision_quota(user_id: int) -> tuple[bool, int, int, int]:
    """
    Check whether a user can make a vision scan.

    Returns (allowed, retry_after_seconds, scans_remaining, scans_limit).
    Checks hourly limit first (tighter), then daily.
    """
    key = f"v:{user_id}"
    hourly_ok, hourly_retry = _vision_hourly_limiter.is_allowed(key)
    if not hourly_ok:
        # Don't burn the daily slot either
        remaining = 0
        return False, hourly_retry, 0, 15

    daily_ok, daily_retry = _vision_daily_limiter.is_allowed(key)
    if not daily_ok:
        remaining = 0
        return False, daily_retry, 0, 50

    h_status = _vision_hourly_limiter.status(key)
    return True, 0, h_status["remaining"], 15


def vision_quota_status(user_id: int) -> dict:
    """Read-only quota info for a user (does NOT consume a slot)."""
    key = f"v:{user_id}"
    h = _vision_hourly_limiter.status(key)
    d = _vision_daily_limiter.status(key)
    return {
        "scans_remaining_hour":  h["remaining"],
        "scans_limit_hour":      h["limit"],
        "scans_remaining_day":   d["remaining"],
        "scans_limit_day":       d["limit"],
        "retry_after_seconds":   max(h["retry_after_seconds"], d["retry_after_seconds"]),
        "quota_ok":              h["remaining"] > 0 and d["remaining"] > 0,
    }


def _get_client_ip(request: Request) -> str:
    """Extract real IP, respecting Render/Vercel reverse-proxy headers."""
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Request-level rate limiting — never reads or buffers the response body.
    Compatible with StreamingResponse and SSE.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path
        ip = _get_client_ip(request)

        # Tighter limit on the streaming chat endpoint
        if "/chat/sessions/" in path and path.endswith("/messages") and request.method == "POST":
            allowed, retry = _chat_limiter.is_allowed(ip)
            if not allowed:
                return JSONResponse(
                    status_code=429,
                    content={"detail": f"Too many chat requests. Retry after {retry}s."},
                    headers={"Retry-After": str(retry)},
                )

        # Broad API limit
        if path.startswith("/api/"):
            allowed, retry = _global_limiter.is_allowed(ip)
            if not allowed:
                return JSONResponse(
                    status_code=429,
                    content={"detail": f"Too many requests. Retry after {retry}s."},
                    headers={"Retry-After": str(retry)},
                )

        return await call_next(request)
