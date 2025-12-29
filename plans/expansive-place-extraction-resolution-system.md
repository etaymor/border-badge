# feat: Expansive Place Extraction & Resolution System

## Overview

Transform the existing place extraction system into a high-recall, deterministic resolution engine that maximizes correct `place_id` resolution from noisy social media content (TikTok, Instagram) while maintaining precision.

**Key Principle:** Google handles cross-language retrieval. We handle orchestration, expansion, and ranking.

### Current State
The project has a production-ready place extractor at `backend/app/services/place_extractor/` with:
- Google Places Autocomplete + Details API integration
- Regex-based candidate extraction
- Location hint biasing (city/country centroids)
- Confidence scoring with diacritics normalization
- Parallel candidate resolution (max 3 candidates)

### Target State
An expanded system that:
- Uses spaCy NER for entity extraction (FAC, LOC, GPE, ORG)
- Generates multiple query variants per extracted phrase
- Queries 4 Google Places generators in parallel (Autocomplete, Find Place, Text Search, Nearby)
- Applies script-aware fuzzy matching with rapidfuzz
- Uses multi-ring geo search (5km → 25km → 100km)
- Caches results in Redis

---

## Problem Statement / Motivation

**User Pain Point:** Social media posts often mention places in inconsistent ways:
- Transliterated names ("Ekspres" vs "Express")
- Partial names ("Tower" instead of "Tokyo Tower")
- Non-English text mixed with location tags
- Hashtags as place references (#shibuya #夜景)

**Current Limitations:**
1. Single query per candidate (no variant expansion)
2. Only Autocomplete API (misses semantic search capabilities)
3. Character-level fuzzy matching fails across scripts
4. Fixed 25km geo bias radius
5. No caching (repeated API calls for same queries)

**Business Impact:**
- ~30% of place extractions fail or return low-confidence results
- API costs scale linearly with submissions
- Cross-language content has significantly lower success rate

---

## Proposed Solution

### High-Level Architecture

```
Social URL
   ↓
Metadata Extraction (existing)
   ↓
┌─────────────────────────────────────┐
│ NEW: Place-Like Phrase Extraction   │
│ • spaCy NER (FAC, LOC, GPE, ORG)    │
│ • Regex + heuristics (existing)     │
│ • Phrase normalization              │
└─────────────────────────────────────┘
   ↓
┌─────────────────────────────────────┐
│ NEW: Query Variant Expansion        │
│ • Raw phrase                        │
│ • Normalized phrase                 │
│ • {phrase} {city/country}           │
│ • Without generic suffixes          │
└─────────────────────────────────────┘
   ↓
┌─────────────────────────────────────┐
│ NEW: Expansive Candidate Generation │
│ • Autocomplete (existing)           │
│ • Find Place from Text (NEW)        │
│ • Text Search (NEW)                 │
│ • Nearby Search (conditional, NEW)  │
│ • Dedupe by place_id                │
└─────────────────────────────────────┘
   ↓
┌─────────────────────────────────────┐
│ ENHANCED: Scoring & Resolution      │
│ • Script-aware fuzzy matching       │
│ • Multi-ring geo scoring            │
│ • Type compatibility                │
│ • Generator confidence weights      │
└─────────────────────────────────────┘
   ↓
Resolved Place (or Ambiguous)
```

---

## Technical Approach

### Phase 1: Foundation - spaCy NER Integration

**Goal:** Add NER-based entity extraction alongside existing regex patterns.

#### Tasks

1. **Add dependencies** (`backend/pyproject.toml`)
   ```toml
   spacy = "^3.7"
   rapidfuzz = "^3.6"
   ```

2. **Create NER service** (`backend/app/services/place_extractor/ner_service.py`)
   ```python
   import spacy
   from typing import TYPE_CHECKING

   if TYPE_CHECKING:
       from spacy.language import Language

   # Loaded at app startup via lifespan
   _nlp: "Language | None" = None

   def get_nlp() -> "Language":
       if _nlp is None:
           raise RuntimeError("spaCy model not loaded")
       return _nlp

   def extract_location_entities(text: str) -> list[dict]:
       """Extract location entities using spaCy NER."""
       nlp = get_nlp()
       doc = nlp(text)

       entities = []
       for ent in doc.ents:
           if ent.label_ in ("GPE", "LOC", "FAC", "ORG"):
               if len(ent.text) >= 4:  # Filter short entities
                   entities.append({
                       "text": ent.text,
                       "label": ent.label_,
                       "start": ent.start_char,
                       "end": ent.end_char,
                   })
       return entities
   ```

3. **Update app lifespan** (`backend/app/main.py`)
   ```python
   @asynccontextmanager
   async def lifespan(app: FastAPI) -> AsyncIterator[None]:
       # Load spaCy model at startup
       import spacy
       from app.services.place_extractor import ner_service
       ner_service._nlp = spacy.load(
           "en_core_web_sm",
           disable=["tagger", "parser", "lemmatizer"]  # NER only
       )
       yield
       ner_service._nlp = None
   ```

4. **Create setup script** (`backend/scripts/download_spacy_model.py`)
   ```python
   import subprocess
   subprocess.run(["python", "-m", "spacy", "download", "en_core_web_sm"])
   ```

#### Files to Create/Modify
| File | Action | Description |
|------|--------|-------------|
| `backend/pyproject.toml` | Modify | Add spacy, rapidfuzz dependencies |
| `backend/app/services/place_extractor/ner_service.py` | Create | NER extraction service |
| `backend/app/main.py` | Modify | Load spaCy model in lifespan |
| `backend/scripts/download_spacy_model.py` | Create | Model download script |

#### Success Criteria
- [ ] spaCy model loads successfully on app startup
- [ ] `extract_location_entities()` returns entities from test text
- [ ] Entity extraction completes in <100ms for typical captions

---

### Phase 2: Query Variant Expansion

**Goal:** Generate multiple search queries per extracted entity to increase recall.

#### Tasks

1. **Create variant generator** (`backend/app/services/place_extractor/query_variants.py`)
   ```python
   import re
   from dataclasses import dataclass

   GENERIC_SUFFIXES = {
       "restaurant", "cafe", "hotel", "bar", "shop",
       "store", "market", "beach", "park", "museum"
   }

   @dataclass
   class QueryVariant:
       query: str
       variant_type: str  # "raw", "normalized", "contextual", "stripped"

   def generate_variants(
       phrase: str,
       city: str | None = None,
       country: str | None = None,
   ) -> list[QueryVariant]:
       """Generate query variants for a phrase."""
       variants = []

       # Raw phrase
       variants.append(QueryVariant(phrase, "raw"))

       # Normalized (lowercase, strip punctuation)
       normalized = normalize_phrase(phrase)
       if normalized != phrase.lower():
           variants.append(QueryVariant(normalized, "normalized"))

       # Without generic suffixes
       stripped = remove_generic_suffixes(phrase)
       if stripped and stripped != phrase:
           variants.append(QueryVariant(stripped, "stripped"))

       # Contextual (with location)
       if city:
           variants.append(QueryVariant(f"{phrase} {city}", "contextual"))
       elif country:
           variants.append(QueryVariant(f"{phrase} {country}", "contextual"))

       return variants[:5]  # Max 5 variants per phrase

   def normalize_phrase(phrase: str) -> str:
       """Normalize phrase for search."""
       # Remove emojis and special chars
       cleaned = re.sub(r'[^\w\s]', ' ', phrase)
       # Normalize whitespace
       return ' '.join(cleaned.lower().split())

   def remove_generic_suffixes(phrase: str) -> str:
       """Remove generic place type suffixes."""
       words = phrase.lower().split()
       filtered = [w for w in words if w not in GENERIC_SUFFIXES]
       return ' '.join(filtered).strip()
   ```

2. **Update candidate extraction** (`backend/app/services/place_extractor/candidate_extraction.py`)
   - Integrate NER entities with existing regex extraction
   - Deduplicate overlapping entities
   - Generate variants for each unique entity

#### Files to Create/Modify
| File | Action | Description |
|------|--------|-------------|
| `backend/app/services/place_extractor/query_variants.py` | Create | Variant generation logic |
| `backend/app/services/place_extractor/candidate_extraction.py` | Modify | Integrate NER + variants |

#### Success Criteria
- [ ] Each entity generates 2-5 query variants
- [ ] Contextual variants include location when available
- [ ] Generic suffixes removed correctly (e.g., "Pizza Restaurant" → "Pizza")

---

### Phase 3: Expansive Candidate Generation

**Goal:** Query multiple Google Places APIs in parallel to maximize candidate pool.

#### Tasks

1. **Add new API methods** (`backend/app/services/place_extractor/google_places_client.py`)
   ```python
   async def find_place_from_text(
       query: str,
       location_bias: LocationHint | None = None,
   ) -> list[PlaceCandidate]:
       """Find Place from Text - best for proper noun queries."""
       url = "https://places.googleapis.com/v1/places:searchText"
       body = {
           "textQuery": query,
           "maxResultCount": 5,
       }
       if location_bias:
           body["locationBias"] = _make_location_bias(location_bias, radius=25000)
       # ... implementation

   async def text_search(
       query: str,
       location_bias: LocationHint | None = None,
   ) -> list[PlaceCandidate]:
       """Text Search - semantic retrieval for caption-like queries."""
       # Similar to find_place but with different ranking
       # ... implementation

   async def nearby_search(
       keyword: str,
       location: LocationHint,
       radius: int = 5000,
   ) -> list[PlaceCandidate]:
       """Nearby Search - location-first search for generic names."""
       # Only used when strong geo hint available
       # ... implementation
   ```

2. **Create parallel orchestrator** (`backend/app/services/place_extractor/parallel_resolver.py`)
   ```python
   import asyncio
   from typing import NamedTuple

   class CandidateWithSource(NamedTuple):
       candidate: PlaceCandidate
       generator: str  # "autocomplete", "find_place", "text_search", "nearby"
       query_variant: str

   async def resolve_candidates_parallel(
       variants: list[QueryVariant],
       location_hint: LocationHint | None = None,
   ) -> list[CandidateWithSource]:
       """Query all generators in parallel, dedupe by place_id."""

       tasks = []
       for variant in variants:
           tasks.append(_query_autocomplete(variant, location_hint))
           tasks.append(_query_find_place(variant, location_hint))
           tasks.append(_query_text_search(variant, location_hint))
           if location_hint and location_hint.has_coordinates:
               tasks.append(_query_nearby(variant, location_hint))

       results = await asyncio.gather(*tasks, return_exceptions=True)

       # Dedupe by place_id, track best source
       seen_place_ids = {}
       for result in results:
           if isinstance(result, Exception):
               continue
           for candidate in result.candidates:
               if candidate.place_id not in seen_place_ids:
                   seen_place_ids[candidate.place_id] = CandidateWithSource(
                       candidate=candidate,
                       generator=result.generator,
                       query_variant=result.query,
                   )

       return list(seen_place_ids.values())[:50]  # Cap at 50 candidates
   ```

3. **Add multi-ring geo search** (`backend/app/services/place_extractor/geo_search.py`)
   ```python
   SEARCH_RINGS = [
       {"radius": 5000, "confidence": "high"},    # 0-5km
       {"radius": 25000, "confidence": "medium"}, # 5-25km
       {"radius": 100000, "confidence": "low"},   # 25-100km
   ]

   async def multi_ring_search(
       query: str,
       center: tuple[float, float],
       min_candidates: int = 3,
   ) -> list[PlaceCandidate]:
       """Expand search radius until enough candidates found."""
       all_candidates = []

       for ring in SEARCH_RINGS:
           candidates = await nearby_search(
               keyword=query,
               location=LocationHint(lat=center[0], lng=center[1]),
               radius=ring["radius"],
           )
           all_candidates.extend(candidates)

           if len(all_candidates) >= min_candidates:
               break  # Early exit

       return dedupe_by_place_id(all_candidates)
   ```

#### Files to Create/Modify
| File | Action | Description |
|------|--------|-------------|
| `backend/app/services/place_extractor/google_places_client.py` | Modify | Add Find Place, Text Search, Nearby Search |
| `backend/app/services/place_extractor/parallel_resolver.py` | Create | Parallel query orchestration |
| `backend/app/services/place_extractor/geo_search.py` | Create | Multi-ring search logic |

#### Success Criteria
- [ ] All 4 generators query in parallel
- [ ] Results deduped by place_id
- [ ] Multi-ring search expands when needed
- [ ] Total resolution time <3s for typical queries

---

### Phase 4: Enhanced Scoring with rapidfuzz

**Goal:** Implement script-aware fuzzy matching and improved confidence scoring.

#### Tasks

1. **Add script detection** (`backend/app/services/place_extractor/script_utils.py`)
   ```python
   import unicodedata

   LATIN_SCRIPTS = {"LATIN"}
   CJK_SCRIPTS = {"CJK", "HIRAGANA", "KATAKANA", "HANGUL"}

   def detect_script(text: str) -> str:
       """Detect dominant Unicode script of text."""
       scripts = {}
       for char in text:
           if char.isalpha():
               script = unicodedata.name(char, "").split()[0]
               scripts[script] = scripts.get(script, 0) + 1

       if not scripts:
           return "UNKNOWN"
       return max(scripts, key=scripts.get)

   def scripts_compatible(text1: str, text2: str) -> bool:
       """Check if two texts use compatible scripts for fuzzy matching."""
       script1 = detect_script(text1)
       script2 = detect_script(text2)

       # Same script = compatible
       if script1 == script2:
           return True

       # Both Latin-based = compatible
       if script1 in LATIN_SCRIPTS and script2 in LATIN_SCRIPTS:
           return True

       return False
   ```

2. **Update scoring** (`backend/app/services/place_extractor/scoring.py`)
   ```python
   from rapidfuzz import fuzz, utils
   from .script_utils import scripts_compatible

   def calculate_fuzzy_score(query: str, place_name: str) -> float:
       """Calculate fuzzy match score with script awareness."""

       # Check script compatibility
       if not scripts_compatible(query, place_name):
           # Cross-script: only exact substring match
           if query.lower() in place_name.lower():
               return 0.7
           return 0.0

       # Same script: use rapidfuzz WRatio
       score = fuzz.WRatio(
           query,
           place_name,
           processor=utils.default_process
       ) / 100.0

       return score

   def calculate_composite_score(
       candidate: CandidateWithSource,
       query: str,
       location_hint: LocationHint | None,
   ) -> float:
       """Calculate composite confidence score."""

       # Component scores
       fuzzy_score = calculate_fuzzy_score(query, candidate.candidate.name)
       geo_score = calculate_geo_score(candidate.candidate, location_hint)
       type_score = calculate_type_score(candidate.candidate, query)
       generator_weight = GENERATOR_WEIGHTS.get(candidate.generator, 0.5)

       # Weighted combination
       composite = (
           fuzzy_score * 0.40 +
           geo_score * 0.30 +
           type_score * 0.15 +
           generator_weight * 0.15
       )

       return min(1.0, composite)

   GENERATOR_WEIGHTS = {
       "find_place": 0.9,
       "text_search": 0.8,
       "autocomplete": 0.7,
       "nearby": 0.6,
   }
   ```

3. **Add geo scoring** (`backend/app/services/place_extractor/scoring.py`)
   ```python
   from math import radians, sin, cos, sqrt, atan2

   def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
       """Calculate distance between two points in km."""
       R = 6371
       dlat = radians(lat2 - lat1)
       dlon = radians(lon2 - lon1)
       a = sin(dlat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon/2)**2
       return 2 * R * atan2(sqrt(a), sqrt(1-a))

   def calculate_geo_score(candidate: PlaceCandidate, hint: LocationHint | None) -> float:
       """Score based on distance from location hint."""
       if not hint or not hint.has_coordinates:
           return 0.5  # Neutral if no hint

       distance = haversine_km(
           hint.latitude, hint.longitude,
           candidate.latitude, candidate.longitude
       )

       # Distance decay
       if distance <= 5:
           return 1.0
       elif distance <= 25:
           return 0.8
       elif distance <= 100:
           return 0.5
       else:
           return 0.2
   ```

#### Files to Create/Modify
| File | Action | Description |
|------|--------|-------------|
| `backend/app/services/place_extractor/script_utils.py` | Create | Script detection utilities |
| `backend/app/services/place_extractor/scoring.py` | Modify | Add fuzzy + geo + composite scoring |

#### Success Criteria
- [ ] Script detection identifies Latin, CJK, Arabic, Cyrillic
- [ ] Fuzzy matching disabled for cross-script comparisons
- [ ] Composite score weights tuned via config
- [ ] Geo scoring applies distance decay correctly

---

### Phase 5: Redis Caching (Optional)

**Goal:** Cache query results and place details to reduce API costs.

> **Note:** Per Google Maps Terms of Service, only `place_id` can be cached indefinitely. Place details must be re-fetched. This phase caches query→place_id mappings.

#### Tasks

1. **Add Redis dependency** (`backend/pyproject.toml`)
   ```toml
   redis = "^5.0"
   ```

2. **Create cache service** (`backend/app/services/place_extractor/cache_service.py`)
   ```python
   import hashlib
   import json
   import redis.asyncio as aioredis

   _redis: aioredis.Redis | None = None

   QUERY_CACHE_TTL = 7 * 24 * 3600  # 7 days

   def _cache_key(query: str, geo_hash: str | None) -> str:
       """Generate cache key from query and geo context."""
       key_data = f"{query.lower()}:{geo_hash or 'none'}"
       return f"places:query:{hashlib.sha256(key_data.encode()).hexdigest()[:16]}"

   async def get_cached_place_ids(
       query: str,
       geo_hash: str | None = None,
   ) -> list[str] | None:
       """Get cached place_ids for a query."""
       if not _redis:
           return None

       key = _cache_key(query, geo_hash)
       cached = await _redis.get(key)
       return json.loads(cached) if cached else None

   async def cache_place_ids(
       query: str,
       place_ids: list[str],
       geo_hash: str | None = None,
   ) -> None:
       """Cache place_ids for a query."""
       if not _redis or not place_ids:
           return

       key = _cache_key(query, geo_hash)
       await _redis.set(key, json.dumps(place_ids), ex=QUERY_CACHE_TTL)
   ```

3. **Update config** (`backend/app/core/config.py`)
   ```python
   class Settings(BaseSettings):
       # ... existing fields
       redis_url: str | None = Field(default=None, repr=False)
   ```

4. **Update lifespan** (`backend/app/main.py`)
   ```python
   @asynccontextmanager
   async def lifespan(app: FastAPI) -> AsyncIterator[None]:
       # ... spaCy loading

       # Initialize Redis if configured
       if settings.redis_url:
           import redis.asyncio as aioredis
           from app.services.place_extractor import cache_service
           cache_service._redis = await aioredis.from_url(
               settings.redis_url,
               decode_responses=True
           )

       yield

       # Cleanup
       if cache_service._redis:
           await cache_service._redis.close()
   ```

#### Files to Create/Modify
| File | Action | Description |
|------|--------|-------------|
| `backend/pyproject.toml` | Modify | Add redis dependency |
| `backend/app/services/place_extractor/cache_service.py` | Create | Redis caching logic |
| `backend/app/core/config.py` | Modify | Add redis_url setting |
| `backend/app/main.py` | Modify | Initialize Redis in lifespan |
| `backend/.env.example` | Modify | Add REDIS_URL example |

#### Success Criteria
- [ ] Cache hits return place_ids within 5ms
- [ ] Cache misses don't block request
- [ ] TTL applied correctly (7 days)
- [ ] Works without Redis (graceful fallback)

---

## Acceptance Criteria

### Functional Requirements

- [ ] spaCy NER extracts GPE, LOC, FAC, ORG entities from captions
- [ ] Query variants generated: raw, normalized, contextual, stripped
- [ ] All 4 Google Places generators queried in parallel
- [ ] Results deduped by place_id
- [ ] Script-aware fuzzy matching (disabled for cross-script)
- [ ] Multi-ring geo search (5km → 25km → 100km)
- [ ] Composite scoring with fuzzy, geo, type, generator weights
- [ ] Redis caching for query→place_id mappings (optional)

### Non-Functional Requirements

- [ ] Total extraction time <5s for typical social posts
- [ ] spaCy model loads in <3s at startup
- [ ] Memory usage <500MB additional for spaCy model
- [ ] Graceful degradation when Redis unavailable
- [ ] All new code covered by unit tests

### Quality Gates

- [ ] `poetry run ruff check .` passes
- [ ] `poetry run ruff format --check .` passes
- [ ] `poetry run pytest` passes
- [ ] No new security vulnerabilities introduced

---

## Configuration Values

### Confidence Thresholds
| Threshold | Value | Behavior |
|-----------|-------|----------|
| High confidence | ≥0.80 | Auto-accept, return immediately |
| Medium confidence | 0.50-0.79 | Return with confidence score |
| Low confidence | <0.50 | Discard, log for analysis |

### Timeouts
| Component | Timeout | Notes |
|-----------|---------|-------|
| spaCy NER | 2s | Per caption |
| Each Places API call | 3s | Per generator |
| Total extraction | 10s | End-to-end |

### Resource Limits
| Limit | Value | Notes |
|-------|-------|-------|
| Max entities per post | 20 | After NER + regex |
| Max query variants | 50 | Total across all entities |
| Max candidates | 100 | Before scoring |
| Max parallel API calls | 12 | Semaphore limit |

### Scoring Weights
| Component | Weight | Notes |
|-----------|--------|-------|
| Fuzzy match | 0.40 | Script-aware |
| Geo score | 0.30 | Distance decay |
| Type compatibility | 0.15 | Category match |
| Generator confidence | 0.15 | Source reliability |

---

## Error Handling

### Google Places API Failures

| Error | Response | Action |
|-------|----------|--------|
| 429 Rate Limit | Retry with backoff | 3 attempts, exponential |
| 500+ Server Error | Skip generator | Proceed with others |
| Timeout | Skip generator | Log warning |
| Invalid API Key | Fail request | Alert admin |
| Quota Exceeded | Fail request | Alert admin |

### Minimum Generator Success
- Proceed if ≥1 generator returns candidates
- Log warning if <3 generators succeed
- Return partial results with metadata

---

## Dependencies & Prerequisites

### New Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| spacy | ^3.7 | NER entity extraction |
| rapidfuzz | ^3.6 | Fuzzy string matching |
| redis | ^5.0 | Caching (optional) |

### spaCy Model
- Model: `en_core_web_sm` (12MB)
- Download: `python -m spacy download en_core_web_sm`
- Load at startup via lifespan

### Environment Variables
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| REDIS_URL | No | None | Redis connection URL |
| PLACE_EXTRACTION_MIN_CONFIDENCE | No | 0.5 | Minimum confidence threshold |

---

## Risk Analysis & Mitigation

### High Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Google Places API cost increase | Budget overrun | Monitor API calls, cache aggressively, set alerts |
| spaCy model OOM on small instances | App crash | Use `en_core_web_sm`, monitor memory |
| Cross-script matching failures | Poor UX for international users | Extensive testing with CJK, Arabic, Cyrillic |

### Medium Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Redis connection failures | Slower requests | Graceful fallback, don't block on cache |
| NER false positives | Wasted API calls | Filter short entities, validate entity types |
| Scoring weights suboptimal | Lower precision | A/B test, tune based on user feedback |

---

## Testing Strategy

### Unit Tests

```python
# tests/services/place_extractor/test_ner_service.py
def test_extract_location_entities():
    text = "Best coffee in Tokyo near Tokyo Tower"
    entities = extract_location_entities(text)
    assert len(entities) == 2
    assert {"Tokyo", "Tokyo Tower"} == {e["text"] for e in entities}

# tests/services/place_extractor/test_query_variants.py
def test_generate_variants():
    variants = generate_variants("Pizza Restaurant", city="Brooklyn")
    assert any(v.query == "Pizza Restaurant" for v in variants)
    assert any(v.query == "Pizza Restaurant Brooklyn" for v in variants)
    assert any(v.query == "Pizza" for v in variants)  # Stripped

# tests/services/place_extractor/test_script_utils.py
def test_scripts_compatible():
    assert scripts_compatible("Tokyo", "Tokyo Tower") == True
    assert scripts_compatible("Tokyo", "東京") == False
    assert scripts_compatible("café", "cafe") == True
```

### Integration Tests

```python
# tests/services/place_extractor/test_parallel_resolver.py
@pytest.mark.asyncio
async def test_resolve_candidates_parallel():
    variants = [QueryVariant("Tokyo Tower", "raw")]
    hint = LocationHint(name="Tokyo", latitude=35.6762, longitude=139.6503)

    candidates = await resolve_candidates_parallel(variants, hint)

    assert len(candidates) > 0
    assert all(c.candidate.place_id for c in candidates)
```

---

## Rollout Plan

### Phase 1: Feature Flag (Week 1)
- Deploy with feature flag disabled
- Enable for internal testing accounts
- Monitor error rates and latencies

### Phase 2: Gradual Rollout (Week 2)
- Enable for 10% of requests
- Compare precision/recall vs. old system
- Tune scoring weights based on data

### Phase 3: Full Rollout (Week 3)
- Enable for 100% of requests
- Remove old extraction code path
- Document learnings

---

## References

### Internal References
- Current place extractor: `backend/app/services/place_extractor/`
- Existing scoring logic: `backend/app/services/place_extractor/scoring.py:70-131`
- Location hints: `backend/app/services/place_extractor/location_hints.py`
- Google Places client: `backend/app/services/place_extractor/google_places_client.py`
- Algorithm documentation: `docs/place-extraction-algorithm.md`

### External References
- [Google Places Text Search (New)](https://developers.google.com/maps/documentation/places/web-service/text-search)
- [spaCy NER Documentation](https://spacy.io/usage/linguistic-features#named-entities)
- [RapidFuzz GitHub](https://github.com/rapidfuzz/RapidFuzz)
- [Google Maps ToS - Caching](https://cloud.google.com/maps-platform/terms/maps-service-terms)

---

## MVP Implementation

### `backend/app/services/place_extractor/ner_service.py`

```python
"""NER-based entity extraction for place names."""

from __future__ import annotations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from spacy.language import Language

_nlp: "Language | None" = None


def get_nlp() -> "Language":
    """Get the loaded spaCy model."""
    if _nlp is None:
        raise RuntimeError("spaCy model not loaded - check app lifespan")
    return _nlp


def extract_location_entities(text: str, min_length: int = 4) -> list[dict]:
    """
    Extract location-related entities using spaCy NER.

    Args:
        text: Input text to analyze
        min_length: Minimum entity length to include

    Returns:
        List of entities with text, label, start, end positions
    """
    nlp = get_nlp()
    doc = nlp(text)

    entities = []
    for ent in doc.ents:
        if ent.label_ in ("GPE", "LOC", "FAC", "ORG"):
            if len(ent.text) >= min_length:
                entities.append({
                    "text": ent.text,
                    "label": ent.label_,
                    "start": ent.start_char,
                    "end": ent.end_char,
                })

    return entities
```

### `backend/app/services/place_extractor/query_variants.py`

```python
"""Query variant generation for expansive place search."""

from __future__ import annotations
import re
from dataclasses import dataclass

GENERIC_SUFFIXES = frozenset({
    "restaurant", "cafe", "coffee", "hotel", "bar", "pub",
    "shop", "store", "market", "beach", "park", "museum",
    "gallery", "center", "centre", "station", "airport",
})


@dataclass
class QueryVariant:
    """A search query variant with metadata."""
    query: str
    variant_type: str  # "raw", "normalized", "contextual", "stripped"


def generate_variants(
    phrase: str,
    city: str | None = None,
    country: str | None = None,
    max_variants: int = 5,
) -> list[QueryVariant]:
    """
    Generate query variants for a phrase.

    Args:
        phrase: The extracted place phrase
        city: Optional city context
        country: Optional country context
        max_variants: Maximum variants to return

    Returns:
        List of query variants
    """
    variants = []

    # Raw phrase (always included)
    variants.append(QueryVariant(phrase, "raw"))

    # Normalized (lowercase, stripped punctuation/emojis)
    normalized = normalize_phrase(phrase)
    if normalized and normalized != phrase.lower():
        variants.append(QueryVariant(normalized, "normalized"))

    # Without generic suffixes
    stripped = remove_generic_suffixes(phrase)
    if stripped and stripped.lower() != phrase.lower():
        variants.append(QueryVariant(stripped, "stripped"))

    # Contextual (with location)
    if city:
        variants.append(QueryVariant(f"{phrase} {city}", "contextual"))
    elif country:
        variants.append(QueryVariant(f"{phrase} {country}", "contextual"))

    return variants[:max_variants]


def normalize_phrase(phrase: str) -> str:
    """Normalize phrase for search (lowercase, no special chars)."""
    # Remove emojis and non-word characters (keep alphanumeric + spaces)
    cleaned = re.sub(r"[^\w\s]", " ", phrase, flags=re.UNICODE)
    # Normalize whitespace
    return " ".join(cleaned.lower().split())


def remove_generic_suffixes(phrase: str) -> str:
    """Remove generic place type suffixes from phrase."""
    words = phrase.split()
    filtered = [w for w in words if w.lower() not in GENERIC_SUFFIXES]
    return " ".join(filtered).strip()
```

### `backend/app/services/place_extractor/script_utils.py`

```python
"""Unicode script detection utilities for cross-script matching."""

from __future__ import annotations
import unicodedata

LATIN_LIKE = {"LATIN", "COMMON"}
CJK_SCRIPTS = {"CJK", "HIRAGANA", "KATAKANA", "HANGUL", "HAN"}


def detect_script(text: str) -> str:
    """
    Detect the dominant Unicode script of text.

    Returns the most common script name (e.g., "LATIN", "CJK", "ARABIC").
    """
    scripts: dict[str, int] = {}

    for char in text:
        if char.isalpha():
            try:
                name = unicodedata.name(char, "")
                # Extract script from Unicode name (first word usually)
                script = name.split()[0] if name else "UNKNOWN"
                scripts[script] = scripts.get(script, 0) + 1
            except ValueError:
                continue

    if not scripts:
        return "UNKNOWN"

    return max(scripts, key=scripts.get)


def scripts_compatible(text1: str, text2: str) -> bool:
    """
    Check if two texts use compatible scripts for fuzzy matching.

    Cross-script comparisons (e.g., Latin vs CJK) should not use
    character-level fuzzy matching as it produces meaningless scores.
    """
    script1 = detect_script(text1)
    script2 = detect_script(text2)

    # Same script = compatible
    if script1 == script2:
        return True

    # Both Latin-like = compatible
    if script1 in LATIN_LIKE and script2 in LATIN_LIKE:
        return True

    # Different scripts = not compatible for fuzzy matching
    return False
```

---

*Plan generated: 2025-12-29*
