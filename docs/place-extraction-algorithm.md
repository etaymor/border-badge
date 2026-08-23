# Place Extraction Algorithm

This document describes how Border Badge extracts place information from social media links (Instagram, TikTok, YouTube, etc.).

## Overview

When a user shares a social media URL, we use a **cascading extraction pipeline** with multiple fallback strategies to extract place information. The system supports **multi-place extraction**, allowing a single social media post to yield multiple places (e.g., "Top 10 restaurants in Paris" videos).

The extraction pipeline attempts to:

1. Check the extraction cache for previously processed URLs
2. Fetch metadata (title, caption, location tags) via oEmbed
3. Try caption extraction (LLM-first with regex fallback)
4. If caption fails or signals skip_to_video, try video frame extraction or carousel/slideshow parsing
5. Resolve candidates via Google Places API
6. Cache results for future requests
7. Return places with confidence scores and entry type classifications

## Extraction Methods

The system supports three extraction methods, controlled via the `extraction_method` request parameter:

| Method | Description |
|--------|-------------|
| `auto` | LLM-first with regex fallback (default) |
| `llm` | LLM extraction only |
| `regex` | Regex extraction only (legacy behavior) |

## Extraction Orchestrator

The `ExtractionOrchestrator` coordinates the cascading extraction pipeline with caching and parallel operations. It implements a multi-source extraction strategy that balances latency, cost, and accuracy.

```
Social Media URL
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    1. Cache Check                                    │
│  Check extraction_cache table for previously processed URL           │
│  If hit → return cached places immediately                           │
└─────────────────────────────────────────────────────────────────────┘
    │ (cache miss)
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    2. Speculative Video Download                     │
│  Start video download with 500ms delay (if video URL)                │
│  ~70% of caption extractions complete in <500ms                      │
│  Cancel download if caption succeeds                                 │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    3. Caption Extraction                             │
│  ┌─────────────────────────┐     ┌─────────────────────────────┐    │
│  │   LLM Multi-Place       │     │   Regex Extraction          │    │
│  │   (Primary, async)      │     │   (Fallback)                │    │
│  │   3s timeout            │     │   CPU-only, NO API calls    │    │
│  └─────────────────────────┘     └─────────────────────────────┘    │
│           │                               │                          │
│           └───────────┬───────────────────┘                          │
│                       │ LLM may signal skip_to_video                 │
└─────────────────────────────────────────────────────────────────────┘
    │ (if caption fails or skip_to_video)
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    4. Visual Extraction (Fallback)                   │
│  ┌─────────────────────────┐     ┌─────────────────────────────┐    │
│  │   Video Frame Analysis  │     │   Carousel/Slideshow        │    │
│  │   (yt-dlp + ffmpeg)     │     │   (TikTok/Instagram)        │    │
│  │   Multimodal LLM        │     │   Image analysis            │    │
│  └─────────────────────────┘     └─────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    5. Google Places Resolution                       │
│  Resolve extracted place names via Google Places API                 │
│  Parallel resolution for multi-place results                         │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    6. Cache Results                                  │
│  Store extraction result in database with source metadata            │
│  Sources: caption, video_frames, carousel, screenshot                │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
DetectedPlace[] result with entry_types (Place|Stay|Food|Experience)
```

**Cost Optimization:** The speculative video download starts with a 500ms delay while caption extraction runs. Since ~70% of caption extractions complete in under 500ms, this reduces unnecessary bandwidth usage. If caption succeeds, the download is cancelled.

**File:** `app/services/extraction_orchestrator.py`

---

## Multi-Place Extraction

The system supports extracting multiple places from a single social media post. This is particularly useful for content like "Top 10 restaurants in Paris" or travel itinerary videos.

The LLM extraction now returns an array of places (up to 10) with parallel Google Places resolution for each candidate. The `detected_places` response field contains all extracted places, while `detected_place` (deprecated) contains only the first place for backward compatibility.

---

## Extraction Sources

The system uses different extraction sources depending on the content type:

| Source | Description | Use Case |
|--------|-------------|----------|
| `caption` | Text extraction from title/caption | Default for all posts |
| `video_frames` | Multimodal analysis of video frames | Videos when caption fails |
| `carousel` | Image analysis of slideshow/carousel | TikTok photo posts, Instagram carousels |
| `screenshot` | Client-provided frames | Mobile app video frame sampling |

---

## LLM-First Architecture

The extraction pipeline is cost-optimized to minimize Google Places API calls:

## LLM Extraction

The LLM extraction uses Gemini 2.5 Flash-Lite via OpenRouter to extract structured place data from social media content.

### Features

- **Semantic understanding** of natural language captions
- **Structured output** with city/country context for tighter location biasing
- **Entry type classification** (Place, Stay, Food, Experience) for automatic categorization
- **Security hardening** with input sanitization and prompt injection protection

### Entry Type Classification

The LLM automatically classifies places into one of four entry types:

| Type | Description | Examples |
|------|-------------|----------|
| `Place` | Landmark, attraction, museum, park, beach, monument | Eiffel Tower, Central Park |
| `Stay` | Hotel, Airbnb, hostel, resort, accommodation | Four Seasons, Marriott |
| `Food` | Restaurant, cafe, bar, bakery | Cafe Lomi, Ichiran Ramen |
| `Experience` | Tour, activity, class, event | Cooking class, City tour |

### Security

User-controlled social media content requires aggressive sanitization before LLM processing:

- Delimiter injection patterns are stripped
- System role injection attempts are blocked
- Code block injection is removed
- Input length is limited (title: 500 chars, caption: 2000 chars)

### Configuration

LLM extraction is controlled by a feature flag (disabled by default):

```bash
LLM_PLACE_EXTRACTION_ENABLED=true  # Enable LLM-first extraction
```

When disabled, the system uses regex extraction only (legacy behavior).

**File:** `app/core/config.py`

---

## Regex Extraction (Fallback)

The regex extraction system serves as the fallback when LLM extraction is disabled or fails. It uses 8 layers of regex patterns to identify place candidates.

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
| `LLM_PLACE_EXTRACTION_ENABLED` | `false` | Enable LLM-first extraction (opt-in) |
| `PLACE_EXTRACTION_MIN_CONFIDENCE` | 0.5 | Minimum confidence to accept a match |
| `GOOGLE_PLACES_API_KEY` | required | API key for Places API |
| `OPENROUTER_API_KEY` | required for LLM | API key for OpenRouter (reused from classification) |

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

## Video Frame Extraction

When caption extraction fails or signals `skip_to_video`, the system falls back to video frame analysis using a multimodal LLM.

The video extraction pipeline:

1. **Download video** using yt-dlp with a 12-second timeout
2. **Extract frames** using ffmpeg (up to 15 frames, evenly distributed)
3. **Analyze frames** using multimodal LLM (Gemini 2.5 Flash) to identify place names
4. **Resolve places** via Google Places API

The mobile app can also provide pre-sampled video frames via the `video_frames` request parameter, bypassing server-side video download.

**When the speculative download starts.** `/ingest/social` classifies the URL
before extraction (`is_photo_slideshow`, `allow_video_fallback`,
`is_known_video_url`) and only a *known* video URL gets the 500ms-delayed
speculative yt-dlp download. Instagram post URLs are not known video URLs — a
`/p/` shortcode can be a photo, a carousel, or a video, and Instagram's login
wall makes a wrong guess a wasted request — so they go through carousel
extraction first and only then, if the post turns out to be a video, start a
download (see below). TikTok `/photo/` slideshows disable video fallback
entirely (`enable_video_fallback=False`): yt-dlp cannot fetch them, so there is
nothing to fall back to.

**Files:**
- `app/services/video_extractor/downloader.py` - yt-dlp video download
- `app/services/video_extractor/frame_extractor.py` - ffmpeg frame extraction
- `app/services/multimodal_extractor.py` - Multimodal LLM analysis

---

## Carousel and Slideshow Extraction

For TikTok photo slideshows (`/photo/` URLs) and Instagram carousels, the system uses specialized extractors:

**TikTok Slideshows:**
- Parse HTML to extract image URLs from the slideshow
- Download images and analyze with multimodal LLM
- Extract place names from visible text in images

**Instagram Carousels:**
- Fetch carousel images via Instagram's API
- Check for geotag location data (specific POIs vs generic city names)
- Fall back to image analysis if geotag is generic

**Instagram videos (`GraphVideo`):** the carousel fetch is also how a video post
is identified, and it returns what is needed to read one. When Instaloader
reports `post_type="GraphVideo"` the result carries a signed CDN `video_url`,
which the orchestrator downloads directly (`download_instagram_cdn_video`)
instead of invoking yt-dlp, which hits Instagram's login wall. If that URL is
absent, it falls back to yt-dlp on the original URL. The direct download is
deliberately narrow: the URL must be on `cdninstagram.com` or `fbcdn.net`
(`is_instagram_cdn_video_url`), redirects are capped, the body is streamed and
abandoned past `MAX_VIDEO_BYTES` (100 MB), and the file must start with an mp4
`ftyp` box — anything else deletes the partial file and returns `None`, leaving
the pipeline exactly where it was. From there the normal frame-extraction path
runs, so the extraction reports `source: video_frames`.

A cover-thumbnail-only carousel result therefore no longer dead-ends: a
`GraphVideo` post whose images yield no places continues into frame extraction
rather than returning empty. Because of that, a cached *empty* `carousel` result
is retried when video fallback is enabled instead of being served from cache —
those negatives were recorded before there was a video path to try.

**Files:**
- `app/services/tiktok_slideshow.py` - TikTok photo slideshow parser
- `app/services/instagram_carousel.py` - Instagram carousel fetcher, CDN video URL validation and download

---

## Extraction Cache

Results are cached in the `social_ingest_job` table to avoid redundant API calls:

| Column | Description |
|--------|-------------|
| `extraction_result` | JSON array of detected places |
| `extraction_source` | Source: `caption`, `video_frames`, `carousel`, `screenshot` |
| `extraction_at` | Timestamp of extraction |

Cache lookup is keyed by canonical URL. Negative results (no places found) are also cached to prevent repeated failed extractions.

One exception: an empty `carousel` result is re-extracted rather than served
from cache when video fallback is enabled, so posts cached before the Instagram
video path existed get one more chance through frame extraction.

**File:** `app/services/extraction_cache.py`

---

## File Structure

```
backend/app/services/
├── extraction_orchestrator.py  # Main orchestration with caching
├── extraction_cache.py         # Cache read/write operations
├── multimodal_extractor.py     # Multimodal LLM for image analysis
├── tiktok_slideshow.py         # TikTok photo slideshow parser
├── instagram_carousel.py       # Instagram carousel fetcher
├── video_extractor/
│   ├── __init__.py
│   ├── downloader.py           # yt-dlp video download
│   └── frame_extractor.py      # ffmpeg frame extraction
└── place_extractor/
    ├── __init__.py
    ├── extractor.py            # Caption extraction + LLM
    ├── llm_client.py           # OpenRouter API client
    ├── google_places_client.py # Google Places API client
    ├── location_hints.py       # Location hint extraction
    ├── candidate_extraction.py # Number-emoji location extraction
    └── scoring.py              # Confidence and ranking logic
```

## API Response Fields

When using the `/ingest/social` endpoint, the response includes extraction metadata:

| Field | Type | Description |
|-------|------|-------------|
| `detected_places` | array | Array of all detected places (up to 10) |
| `detected_place` | object | First detected place (deprecated, use `detected_places`) |
| `extraction_method_used` | `"llm"` \| `"regex"` \| `"video"` \| `"none"` | Which extraction method succeeded |
| `extraction_source` | `"caption"` \| `"video_frames"` \| `"carousel"` \| `"screenshot"` | Source of extraction |
| `extraction_latency_ms` | integer | Time taken for extraction in milliseconds |
| `context_location` | string | Context location detected from content (used as search bias) |
| `suggested_trips` | array | Trips suggested for saving (matching country first, then "Saved Places") |
| `extraction_error` | string | User-facing error message when extraction fails |
| `detected_places[].llm_entry_type` | `"place"` \| `"food"` \| `"stay"` \| `"experience"` | LLM-predicted entry type |

See [API Reference](./API.md#social-ingest) for complete endpoint documentation.

---

## Related Systems

- **Photo Vision Classification**: The photo import feature uses a separate vision pipeline (`backend/app/services/photo_vision/`) for classifying travel photos into categories (food, landmark, stay, etc.) and extracting text from signage. This is distinct from the social ingest extraction pipeline described above but shares the same OpenRouter infrastructure and `MULTIMODAL_MODEL` config.
- **Photo Place Matcher**: Photo clusters are matched to places using `backend/app/services/place_matcher/`, which uses Google Places Nearby Search and Text Search APIs with density-adaptive tiered radii. This differs from the Autocomplete API used by social ingest place resolution.
