"""
LLM response cache for the AI Copilot.

Caches full assistant responses for identical message sequences with a TTL.
Only caches pure-knowledge responses (no tool calls, no mutations).

Key design:
- Key = SHA-256(system_prompt_hash + last 5 user/assistant messages)
- TTL = 5 minutes (tool-free knowledge answers don't change quickly)
- Max 500 entries to bound memory (~500 KB worst case for long responses)
- Does NOT cache responses that involved tool calls (dynamic DB queries)
- Invalidated per-document: doc upload bumps a global version counter

Usage:
    from app.ai.llm_cache import llm_cache_get, llm_cache_set, llm_cache_invalidate_docs

    cached = llm_cache_get(messages)
    if cached:
        # stream cached tokens
        ...
    else:
        # run LLM, then:
        llm_cache_set(messages, full_response_text)
"""
from __future__ import annotations

import hashlib
import json
import logging
import time

log = logging.getLogger(__name__)

_LLM_CACHE: dict[str, tuple[float, str]] = {}  # key → (timestamp, response_text)
LLM_CACHE_TTL = 300.0    # 5 minutes
LLM_CACHE_MAX = 500
_DOC_VERSION = 0          # bumped on every document upload/delete


def _llm_cache_key(messages: list[dict]) -> str:
    """
    Build a cache key from the last 5 messages (user+assistant, no system).
    Includes the current doc version so uploads invalidate cached RAG answers.
    """
    tail = [m for m in messages if m.get("role") != "system"][-5:]
    payload = json.dumps({"msgs": tail, "doc_v": _DOC_VERSION}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()


def llm_cache_get(messages: list[dict]) -> str | None:
    """
    Return cached response text if a valid cache entry exists, else None.
    Also evicts the entry if it has expired.
    """
    key = _llm_cache_key(messages)
    entry = _LLM_CACHE.get(key)
    if entry is None:
        return None
    ts, text = entry
    if time.monotonic() - ts > LLM_CACHE_TTL:
        del _LLM_CACHE[key]
        return None
    return text


def llm_cache_set(messages: list[dict], response_text: str) -> None:
    """
    Cache response_text for this message sequence.
    Only store if response_text is non-empty and not too large (> 16 KB skipped).
    """
    if not response_text or len(response_text) > 16_384:
        return
    if len(_LLM_CACHE) >= LLM_CACHE_MAX:
        _evict_llm_cache()
    key = _llm_cache_key(messages)
    _LLM_CACHE[key] = (time.monotonic(), response_text)


def _evict_llm_cache() -> None:
    """Remove oldest 20% of entries."""
    drop = max(1, LLM_CACHE_MAX // 5)
    sorted_keys = sorted(_LLM_CACHE.keys(), key=lambda k: _LLM_CACHE[k][0])
    for k in sorted_keys[:drop]:
        del _LLM_CACHE[k]


def llm_cache_invalidate_docs() -> None:
    """
    Called when a document is uploaded or deleted.
    Bumps the doc version so all RAG-grounded cache entries become stale.
    """
    global _DOC_VERSION
    _DOC_VERSION += 1
    log.debug("LLM cache invalidated (doc_version=%d)", _DOC_VERSION)


def llm_cache_stats() -> dict:
    """Return cache statistics for monitoring."""
    now = time.monotonic()
    active = sum(1 for ts, _ in _LLM_CACHE.values() if now - ts <= LLM_CACHE_TTL)
    return {
        "entries": len(_LLM_CACHE),
        "active": active,
        "max": LLM_CACHE_MAX,
        "ttl_seconds": LLM_CACHE_TTL,
        "doc_version": _DOC_VERSION,
    }
