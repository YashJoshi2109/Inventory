"""
Intelligent Search & Natural Language Inventory Lookup.

Phase 1: TF-IDF similarity search over item corpus.
  - Handles typos, partial matches, synonym mapping
  - Fast in-process, no external API needed
  - Re-indexes on demand (triggered by item create/update events)

Phase 2 (RAG-ready): OpenAI / local LLM embedding store.
  - Drop-in replacement: swap TFIDFSearchEngine for EmbeddingSearchEngine
  - Corpus extended with SOPs, manuals, safety data sheets

Architecture note: The SearchIndex is kept in memory. For production with
> 100k items, replace with PostgreSQL full-text search (pg_trgm + tsvector)
or a dedicated vector store (Qdrant / pgvector).
"""
import logging
import re
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

logger = logging.getLogger(__name__)


@dataclass
class SearchHit:
    item_id: int
    sku: str
    name: str
    score: float
    highlight: str = ""


@dataclass
class SearchIndex:
    item_ids: list[int] = field(default_factory=list)
    corpus: list[str] = field(default_factory=list)
    vectorizer: TfidfVectorizer | None = None
    matrix: Any = None  # scipy sparse matrix
    is_built: bool = False


_SYNONYM_MAP = {
    "ethanol": ["alcohol", "etoh", "eth"],
    "centrifuge": ["centrifugation", "spin"],
    "pipette": ["pipet", "pipettor"],
    "falcon tube": ["conical tube", "50ml tube", "15ml tube"],
    "eppendorf": ["microcentrifuge tube", "1.5ml tube", "2ml tube"],
    "gloves": ["nitrile gloves", "latex gloves"],
    "tip": ["pipette tip", "filter tip"],
    "buffer": ["pbs", "tbs", "hepes"],
}

_STOP_WORDS = {"the", "a", "an", "and", "or", "for", "in", "of", "to", "with", "is", "are"}


def _preprocess(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^\w\s\-]", " ", text)
    tokens = text.split()
    expanded = []
    for t in tokens:
        if t not in _STOP_WORDS:
            expanded.append(t)
            for canonical, synonyms in _SYNONYM_MAP.items():
                if t in synonyms:
                    expanded.append(canonical.replace(" ", "_"))
    return " ".join(expanded)


def build_index(items: list[dict]) -> SearchIndex:
    """
    items: [{"id": int, "sku": str, "name": str, "description": str, "category": str, ...}]
    """
    idx = SearchIndex()

    for item in items:
        text = " ".join(filter(None, [
            item.get("sku", ""),
            item.get("name", ""),
            item.get("description", ""),
            item.get("category", ""),
            item.get("supplier", ""),
            item.get("cas_number", ""),
            item.get("part_number", ""),
        ]))
        idx.item_ids.append(item["id"])
        idx.corpus.append(_preprocess(text))

    if idx.corpus:
        idx.vectorizer = TfidfVectorizer(
            ngram_range=(1, 2),
            min_df=1,
            max_features=50_000,
        )
        idx.matrix = idx.vectorizer.fit_transform(idx.corpus)
        idx.is_built = True
        logger.info("SearchIndex built: %d items", len(idx.item_ids))

    return idx


def search(query: str, index: SearchIndex, top_k: int = 10) -> list[SearchHit]:
    if not index.is_built or index.vectorizer is None or index.matrix is None:
        return []

    q_vec = index.vectorizer.transform([_preprocess(query)])
    scores = cosine_similarity(q_vec, index.matrix).flatten()
    top_indices = scores.argsort()[::-1][:top_k]

    hits = []
    for i in top_indices:
        if scores[i] > 0.01:
            hits.append(SearchHit(
                item_id=index.item_ids[i],
                sku="",     # caller joins with DB record
                name="",
                score=round(float(scores[i]), 4),
            ))
    return hits


# Global index — updated by event subscriber on item mutations
_global_index: SearchIndex = SearchIndex()


def get_global_index() -> SearchIndex:
    return _global_index


def rebuild_global_index(items: list[dict]) -> None:
    global _global_index
    _global_index = build_index(items)


def global_search(query: str, top_k: int = 10) -> list[SearchHit]:
    return search(query, _global_index, top_k=top_k)
