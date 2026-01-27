"""NER-based place entity extraction using spaCy."""

from __future__ import annotations

import asyncio
import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from spacy.language import Language

logger = logging.getLogger(__name__)
_nlp: Language | None = None

# Dedicated thread pool for CPU-intensive NER (not shared with I/O)
_ner_executor: ThreadPoolExecutor | None = None
_ner_executor_lock = threading.Lock()


def _get_executor() -> ThreadPoolExecutor:
    global _ner_executor
    if _ner_executor is None:
        with _ner_executor_lock:
            if _ner_executor is None:
                _ner_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ner")
    return _ner_executor


def shutdown_executor() -> None:
    """Shut down the NER thread pool executor gracefully."""
    if _ner_executor is not None:
        _ner_executor.shutdown(wait=True)
        logger.info("NER thread pool executor shut down")


PLACE_LABELS = frozenset({"FAC", "LOC", "GPE", "ORG"})

# Module-level constant (avoid dict recreation per call)
_TYPE_KEYWORDS: dict[str, list[str]] = {
    "restaurant": [
        "restaurant",
        "ristorante",
        "trattoria",
        "bistro",
        "grill",
        "diner",
    ],
    "cafe": ["cafe", "café", "coffee", "bakery", "patisserie"],
    "bar": ["bar", "pub", "tavern", "lounge", "cocktail"],
    "lodging": ["hotel", "hostel", "inn", "resort", "lodge"],
    "museum": ["museum", "gallery"],
    "tourist_attraction": [
        "temple",
        "cathedral",
        "church",
        "mosque",
        "palace",
        "castle",
        "ruins",
        "monument",
        "tower",
        "fortress",
    ],
    "park": ["park", "garden", "botanical"],
}

# Pre-compile word-boundary patterns for type inference
_TYPE_PATTERNS: dict[str, re.Pattern[str]] = {
    place_type: re.compile(
        r"\b(?:" + "|".join(re.escape(kw) for kw in keywords) + r")\b",
        re.IGNORECASE,
    )
    for place_type, keywords in _TYPE_KEYWORDS.items()
}

# Short keywords (e.g. "bar") that cause false positives like "Bar Harbor"
# must appear at the start of the entity name to count.
# "bar" is ambiguous (e.g. "Bar Harbor") — only match at start of entity
_SHORT_KEYWORDS = {"bar"}


@dataclass(frozen=True)
class NEREntity:
    """A named entity extracted by spaCy NER."""

    text: str
    label: str
    place_type: str | None


def load_model() -> None:
    """Load spaCy model. Call via run_in_executor at startup."""
    global _nlp
    import spacy

    _nlp = spacy.load("en_core_web_sm", disable=["lemmatizer"])
    logger.info("spaCy NER model loaded")


def is_loaded() -> bool:
    """Check if the spaCy model has been loaded."""
    return _nlp is not None


async def extract_ner_entities(text: str) -> list[NEREntity]:
    """Extract place-like entities from text via spaCy NER.

    Runs NER in thread pool to avoid blocking the event loop.
    """
    if not _nlp or not text:
        return []

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_get_executor(), _extract_sync, text[:2000])


def _extract_sync(text: str) -> list[NEREntity]:
    """Synchronous NER extraction (runs in thread pool)."""
    if _nlp is None:
        raise RuntimeError("spaCy model not loaded — call load_model() first")
    doc = _nlp(text)
    entities = []
    for ent in doc.ents:
        if ent.label_ in PLACE_LABELS and len(ent.text.strip()) >= 3:
            entities.append(
                NEREntity(
                    text=ent.text.strip(),
                    label=ent.label_,
                    place_type=_infer_place_type(ent.text, ent.label_),
                )
            )
    return entities


def _infer_place_type(text: str, label: str) -> str | None:
    """Infer Google Places includedType from entity text and NER label.

    Uses word boundary matching to avoid false positives like
    "Bar Harbor" → bar or "Lodge at Vail" → lodging.
    """
    if len(text) > 100:
        text = text[:100]
    for place_type, pattern in _TYPE_PATTERNS.items():
        match = pattern.search(text)
        if match:
            matched_word = match.group(0).lower()
            # Short ambiguous words (e.g. "bar") require position 0 AND
            # must not be followed by another capitalized word (proper noun)
            if matched_word in _SHORT_KEYWORDS:
                if match.start() != 0:
                    continue
                rest = text[match.end() :].lstrip()
                if rest and rest[0].isupper():
                    continue
            return place_type
    if label == "FAC":
        return "tourist_attraction"
    return None
