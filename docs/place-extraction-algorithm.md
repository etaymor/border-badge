# Place Extraction Algorithm

This document describes how Border Badge extracts place information from social media links (Instagram, TikTok, YouTube, etc.).

## Overview

When a user shares a social media URL, we attempt to:
1. Fetch metadata (title, caption, location tags) via oEmbed
2. Extract candidate place names from the text
3. Search Google Places API for each candidate
4. Score and rank results to find the best match
5. Return the place if confidence exceeds threshold

## Pipeline Steps

### 1. oEmbed Metadata Fetching

We fetch the post's metadata using platform-specific oEmbed endpoints:

| Platform  | Data Available |
|-----------|----------------|
| Instagram | Title (caption preview), thumbnail |
| TikTok    | Title, author, thumbnail |
| YouTube   | Title, author, thumbnail |

**File:** `app/services/oembed_adapters.py`

### 2. Location Hint Extraction

Before searching for places, we extract location hints from the text to bias Google Places searches toward the correct region.

**Sources of location hints:**
- Instagram location tags (extracted from title patterns like `"Photo by X on Instagram: "Caption" • City"`)
- Explicit city/country mentions in text
- Hashtags containing location names

**Example:**
```
Title: "Amazing sunset views • Tirana"
Location hint: tirana (AL, 41.3275, 19.8187)
```

**File:** `app/services/place_extractor/location_hints.py`

### 3. Candidate Extraction

We parse the title/caption to find potential place name candidates using regex patterns:

**Patterns matched:**
- Capitalized phrases (2-5 words): `"Dajti Express"`, `"Blue Eye Spring"`
- Text after "at" or "@": `"dinner at La Piazza"`
- Quoted text: `"the famous 'Bunk'Art' museum"`

**Filtering:**
- Remove common non-place phrases ("Follow me", "Link in bio", etc.)
- Remove pure hashtags and mentions
- Limit to 10 candidates to avoid API overuse

**File:** `app/services/place_extractor/extractor.py` (`_extract_candidates`)

### 4. Google Places Search

For each candidate, we query the Google Places Autocomplete API:

```
POST https://places.googleapis.com/v1/places:autocomplete
{
  "input": "Dajti Express",
  "locationBias": {
    "circle": {
      "center": {"latitude": 41.3275, "longitude": 19.8187},
      "radius": 25000
    }
  }
}
```

**Location bias:** If we have a location hint, we bias results within 25km of that location.

**File:** `app/services/place_extractor/google_places_client.py`

### 5. Confidence Scoring

Each place result is scored based on text matching between the query and the returned place name.

#### Text Matching Rules

| Match Type | Base Confidence | Example |
|------------|-----------------|---------|
| Exact match | 0.95 | `"Blue Mosque"` → `"Blue Mosque"` |
| Substring match | 0.75 | `"Hagia Sophia"` → `"Hagia Sophia Museum"` |
| Word overlap | 0.2 + 0.55 × (overlap/total) | `"Dajti Express"` → `"Dajti Ekspres"` |
| No overlap | 0.1 | `"Restaurant"` → `"Tirana Hotel"` |

#### Normalization

Before comparison, text is normalized:
- Lowercased
- Diacritics removed (NFD decomposition): `"Köl-Suu"` → `"kol-suu"`
- Dashes converted to spaces for word matching

#### First Result Boost

Google's first result gets +0.1 confidence bonus (their ranking is usually accurate).

**File:** `app/services/place_extractor/scoring.py` (`calculate_confidence`)

### 6. Result Ranking

When multiple candidates return results, we rank them using a composite score:

```
score = confidence
      + 0.2 if country matches location hint
      - 0.3 if country mismatches location hint
      + 0.1 if high-value place type
      - 0.25 if low-value place type
      - 0.02 × candidate_index
```

#### Place Type Classifications

**High-value types** (bonus +0.1):
- restaurant, cafe, bar, hotel, lodging
- tourist_attraction, museum, park, landmark
- natural_feature, point_of_interest
- beach, lake, mountain

**Low-value types** (penalty -0.25):
- travel_agency, tour_operator
- insurance_agency, real_estate_agency
- car_rental

**File:** `app/services/place_extractor/scoring.py` (`score_place_result`)

### 7. Confidence Threshold

The best result is only returned if its **confidence** (not score) meets the minimum threshold:

```python
min_confidence = 0.5  # Configurable via PLACE_EXTRACTION_MIN_CONFIDENCE
```

Results below this threshold are discarded to avoid false matches.

**File:** `app/core/config.py`

## Known Limitations

### 1. Transliteration Mismatches

Word overlap matching doesn't handle spelling variations well:

| Query | Place Name | Issue |
|-------|------------|-------|
| `"Dajti Express"` | `"Dajti Ekspres"` | "Express" ≠ "Ekspres" (1/4 word overlap = 0.34 confidence) |

**Potential fix:** Add fuzzy string matching (Levenshtein distance) for partial word matches.

### 2. Long Place Names with Suffixes

Google often returns names with qualifiers that hurt confidence:

| Query | Place Name | Confidence |
|-------|------------|------------|
| `"Dajti Express"` | `"Dajti Ekspres Lower station)"` | 0.44 (below threshold) |

### 3. Ambiguous Place Names

Common words like "Beach" or "Cafe" may match wrong locations without strong location hints.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `PLACE_EXTRACTION_MIN_CONFIDENCE` | 0.5 | Minimum confidence to accept a match |
| `GOOGLE_PLACES_API_KEY` | required | API key for Places API |

## Debugging

Enable debug logging to trace extraction:

```
2025-12-28 | INFO | LOCATION HINTS extracted: ['tirana']
2025-12-28 | INFO | PLACE EXTRACTION: 10 candidates from title_len=789
2025-12-28 | DEBUG | PLACE EXTRACTION first candidate: 'Guida Shqiptare'
2025-12-28 | INFO | PLACES AUTOCOMPLETE query='Dajti Express' -> 5 results
2025-12-28 | INFO | place_extraction_success
2025-12-28 | INFO | place_extraction_low_confidence (confidence=0.44, threshold=0.5)
```

## File Structure

```
backend/app/services/place_extractor/
├── __init__.py
├── extractor.py           # Main extraction orchestration
├── google_places_client.py # Google Places API client
├── location_hints.py      # Location hint extraction
└── scoring.py             # Confidence and ranking logic
```
