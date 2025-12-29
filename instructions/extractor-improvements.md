# Expansive Place Extraction & Resolution System (Deterministic)

## 1. Goals

### Primary

- Maximize correct `place_id` resolution from noisy social content (TikTok, Instagram).
- Expand recall without sacrificing precision.
- Avoid language-specific or transliteration modeling.
- Stay deterministic, debuggable, cacheable.

### Non-Goals

- No LLMs.
- No custom transliteration engines.
- No user confirmation loops (for now).

---

## 2. High-Level Architecture

The system is split into **two phases**:

```
Social URL
   ↓
Metadata Extraction
   ↓
Place-Like Phrase Extraction
   ↓
EXPANSIVE CANDIDATE GENERATION
   ↓
ENTITY RESOLUTION & SCORING
   ↓
Resolved Place (or Ambiguous)
```

Principle: **Google handles cross-language retrieval. We handle orchestration, expansion, and ranking.**

---

## 3. Inputs

### Required

- Social URL (TikTok / Instagram)

### Optional (Strong Signals)

- User device location at save time
- Current trip context (city / country)
- App language / locale

---

## 4. Metadata Extraction

### Sources

- oEmbed / OpenGraph
- Platform APIs (when available)

### Fields

- `title`
- `description`
- `caption`
- `hashtags`
- `tagged_location`
- `author_location`

---

## 5. Place-Like Phrase Extraction

### 5.1 Regex + Heuristics

- `@place`
- `at X`
- `in X`
- Hashtags resembling proper nouns
- Title-case phrases

### 5.2 Named Entity Recognition (NER)

- Library: **spaCy**
- Entity types: `FAC`, `LOC`, `GPE`, `ORG`
- Discard entities shorter than N characters (e.g., `< 4`)

### 5.3 Phrase Normalization

- Lowercase
- Strip punctuation and emojis
- Normalize whitespace
- Remove generic suffixes (`restaurant`, `cafe`, `hotel`, etc.)

---

## 6. Query Variant Expansion (Expansive Recall)

For each extracted phrase, generate multiple variants:

### Base

- Raw phrase
- Normalized phrase
- Phrase without generic suffixes

### Contextual (if available)

- `{phrase} {city}`
- `{phrase} {country}`
- `{phrase} near {city}`

Each variant is a separate retrieval attempt.

---

## 7. Geo Context & Priors

### 7.1 Geo Hint Resolution

- Geocode extracted city/country to:
  - Centroid
  - Bounding box
- Assign a confidence score to the hint.

### 7.2 Multi-Ring Search

| Ring | Radius    | When Used                  |
| ---: | --------- | -------------------------- |
|    1 | 0–5 km    | Strong geo hint            |
|    2 | 5–25 km   | Default                    |
|    3 | 25–100 km | Low confidence / ambiguous |

---

## 8. Expansive Candidate Generation

### 8.1 Google Generators

Use all, dedupe by `place_id`.

#### A. Places Autocomplete

- Partial / UI-style queries
- Geo-biased when possible

#### B. Find Place from Text

- Proper-noun phrases
- Strongest cross-language resolver

#### C. Places Text Search

- Caption-like queries
- Leverages Google semantic retrieval

#### D. Nearby Search (Conditional)

- Only with geo hints
- Generic names (e.g., “market”, “beach”)

### 8.2 Pool Management

- Track generator + query variant per candidate
- Cap raw pool size (e.g., 50)

---

## 9. Place Details Enrichment

Fetch for top candidates only.

### Fields

- `displayName`
- `types`
- `formattedAddress`
- `addressComponents`
- `location`
- `rating`
- `userRatingsTotal`

Cache by `place_id`.

---

## 10. Script-Aware Matching Strategy

### Script Detection

- Detect Unicode script of query and candidate name.

### Rules

- Same script → allow fuzzy matching.
- Different scripts → disable fuzzy matching.
  - Rely on geo, address, type, and generator confidence.

---

## 11. Deterministic Scoring Model

Composite score per candidate.

### 11.1 Name Similarity

- **rapidfuzz**:
  - `WRatio`
  - `token_set_ratio`
- Applied only when scripts match.

### 11.2 Geo Score

- Distance decay based on ring
- City/country component match bonus

### 11.3 Type Compatibility

- Caption keywords vs place types
- Penalize mismatches

### 11.4 Popularity (Tie-Breaker Only)

- `userRatingsTotal` (log-scaled)

### 11.5 Generator Confidence

Weight by source reliability:

- Find Place > Text Search > Autocomplete > Nearby

---

## 12. Expansion Control Logic

### Early Exit

- Top score ≥ threshold AND
- Margin over #2 ≥ delta

### Expansion Trigger

- Low confidence OR small margin:
  - Add query variants
  - Widen geo ring
  - Invoke additional generators

---

## 13. Output States

### Resolved

```json
{
  "place_id": "string",
  "confidence": 0.87,
  "source": "find_place"
}
```

### Ambiguous

```json
{
  "candidates": [],
  "confidence": 0.42,
  "reason": "multiple close matches"
}
```

---

## 14. FastAPI Implementation Notes

### Networking

- `httpx.AsyncClient` with keep-alive
- Semaphore-based concurrency limits

### Caching

- Redis:
  - `(query_variant + geo_hash)` → candidates
  - `place_id` → details

### Serialization

- Pydantic v2
- `orjson`

### Observability

- Log extracted phrases, generators used, candidate counts, final scores

---

## 15. Rationale

- Google already solved multilingual retrieval and transliteration.
- This system expands inputs, not models.
- Deterministic resolution using structured signals.
- High recall first, precision second.
