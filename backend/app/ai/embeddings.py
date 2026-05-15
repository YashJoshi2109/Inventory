"""
Google text-embedding-004 service with in-memory caching.

Embedding cache: keyed by SHA-256(text), stored in a bounded LRU-like
dict. Prevents redundant API calls when the same text is re-embedded
(e.g. re-uploads, repeated queries, duplicate chunks).

Usage:
    from app.ai.embeddings import embed_text, embed_text_cached, cosine_similarity

    vec = await embed_text_cached("hydrochloric acid storage")
    score = cosine_similarity(vec, stored_vec)
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
from typing import Sequence

from app.core.config import settings

log = logging.getLogger(__name__)

EMBEDDING_MODEL = "models/text-embedding-004"
EMBEDDING_DIM = 768

# ── In-memory embedding cache ─────────────────────────────────────────────────
# Bounded to MAX_CACHE_SIZE entries (each ~3 KB for 768-dim float list).
# 10_000 entries ≈ 30 MB — acceptable for Cloud Run with 512 MB RAM.
_EMBED_CACHE: dict[str, list[float]] = {}
MAX_EMBED_CACHE_SIZE = 10_000


def _embed_cache_key(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


def _evict_embed_cache() -> None:
    """Drop oldest 10% of entries when cache is full."""
    drop = MAX_EMBED_CACHE_SIZE // 10
    for k in list(_EMBED_CACHE.keys())[:drop]:
        del _EMBED_CACHE[k]


async def embed_text(text: str) -> list[float] | None:
    """
    Generate a 768-dim embedding for `text` using Google text-embedding-004.
    Returns None if GEMINI_API_KEY is not set or the call fails.
    Does NOT use the cache — use embed_text_cached() for cached access.
    """
    if not settings.GEMINI_API_KEY:
        return None
    try:
        from google import genai

        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        resp = await client.aio.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=text,
        )
        return list(resp.embeddings[0].values)
    except Exception as exc:
        log.warning("embed_text failed: %s", exc)
        return None


async def embed_text_cached(text: str) -> list[float] | None:
    """
    Cached wrapper around embed_text(). Checks the in-memory cache first;
    stores the result after a cache miss. Thread-safe for single-process use.
    """
    key = _embed_cache_key(text)
    cached = _EMBED_CACHE.get(key)
    if cached is not None:
        return cached

    vec = await embed_text(text)
    if vec is not None:
        if len(_EMBED_CACHE) >= MAX_EMBED_CACHE_SIZE:
            _evict_embed_cache()
        _EMBED_CACHE[key] = vec
    return vec


async def embed_texts(texts: list[str]) -> list[list[float] | None]:
    """Embed multiple texts with caching, returning a list of vectors (or None on failure)."""
    results = []
    for t in texts:
        results.append(await embed_text_cached(t))
    return results


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    """Compute cosine similarity between two equal-length vectors."""
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def vec_to_json(vec: list[float]) -> str:
    return json.dumps(vec)


def vec_from_json(s: str) -> list[float]:
    return json.loads(s)


def cache_stats() -> dict:
    """Return embedding cache statistics for monitoring."""
    return {
        "size": len(_EMBED_CACHE),
        "max_size": MAX_EMBED_CACHE_SIZE,
        "fill_pct": round(len(_EMBED_CACHE) / MAX_EMBED_CACHE_SIZE * 100, 1),
    }
