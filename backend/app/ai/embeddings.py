"""
Google text-embedding-004 service for semantic search.

Used by rag_search_docs to compute cosine similarity between the user
query and stored DocChunk embeddings instead of keyword ILIKE matching.

Usage:
    from app.ai.embeddings import embed_text, cosine_similarity

    vec = await embed_text("hydrochloric acid storage")
    score = cosine_similarity(vec, stored_vec)
"""
from __future__ import annotations

import json
import math
import logging
from typing import Sequence

from app.core.config import settings

log = logging.getLogger(__name__)

EMBEDDING_MODEL = "models/text-embedding-004"
EMBEDDING_DIM = 768


async def embed_text(text: str) -> list[float] | None:
    """
    Generate a 768-dim embedding for `text` using Google text-embedding-004.
    Returns None if GEMINI_API_KEY is not set or the call fails.
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


async def embed_texts(texts: list[str]) -> list[list[float] | None]:
    """Embed multiple texts, returning a list of vectors (or None on failure)."""
    results = []
    for t in texts:
        results.append(await embed_text(t))
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
