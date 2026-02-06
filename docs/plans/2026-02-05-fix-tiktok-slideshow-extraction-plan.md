---
title: "fix: TikTok Slideshow Extraction via gallery-dl"
type: fix
date: 2026-02-05
---

# fix: TikTok Slideshow Extraction via gallery-dl

## Overview

TikTok photo slideshows (`/photo/` URLs) fail to extract places because the current HTML scraping approach in `tiktok_slideshow.py` never worked reliably -- TikTok detects server-side scraping and returns different/empty pages.

**The fix:** Replace with **gallery-dl**, the image-gallery equivalent of yt-dlp. Actively maintained (v1.31.5, Jan 2026), native TikTok slideshow support since Feb 2025. yt-dlp's own maintainers recommend it. Additionally, add proxy support via `TIKTOK_PROXY_URL` to mitigate IP blocking.

## Problem Statement / Motivation

**What's broken:**
- TikTok slideshows return 0 places -- the HTML scraper never worked reliably
- Users see: "TikTok photo slideshows don't provide metadata we can read"
- TikTok videos work fine (yt-dlp), Instagram carousels work fine (Instaloader)

**Why it matters:**
- TikTok is the #1 source of travel content users share into the app
- Slideshows are increasingly popular on TikTok (travel listicles, "top 10 spots" posts)
- Every failed extraction is a missed opportunity to save a place

## Proposed Solution

### Primary: gallery-dl Integration

gallery-dl is to images what yt-dlp is to video. yt-dlp's maintainers explicitly closed TikTok slideshow issues as "out of scope, use gallery-dl."

**Key facts:**
- TikTok photo slideshow support since v1.29.0 (Feb 2025)
- Removed yt-dlp dependency entirely in v1.31.2 (Dec 2025) -- native TikTok extraction
- Current version: v1.31.5 (Jan 31, 2026)
- 7k+ GitHub stars, actively maintained
- Built-in proxy support, JSON metadata output
- When TikTok changes their page structure, gallery-dl gets fixed by the community -- not us

**Invocation strategy:** Use `gallery-dl --dump-json` (metadata-only mode) to extract image URLs and post description, then download images ourselves using the existing httpx pattern. This gives us control over timeouts, size limits, and download parallelism -- consistent with how Instaloader is used for Instagram.

### Secondary: Proxy Support

Add a `TIKTOK_PROXY_URL` environment variable that gets passed to:
- gallery-dl subprocess (`--proxy` flag)
- yt-dlp subprocess (`--proxy` flag) -- for TikTok video URLs

### Cleanup: Remove Dead Code

Delete `tiktok_slideshow.py` and its test file. The module never worked reliably. gallery-dl is the sole TikTok slideshow extractor. If gallery-dl fails, the user gets the manual search fallback (which is what happens today anyway).

## Technical Approach

### Architecture

```
TikTok /photo/ URL detected
    │
    ├── Step 1: Caption extraction (LLM + regex) -- existing, no changes
    │   └── Found places? → Return (no slideshow extraction needed)
    │
    └── Step 2: Carousel extraction (_extract_from_carousel)
        │
        ├── gallery-dl --dump-json URL → image URLs + metadata
        ├── Validate image URLs (https, *.tiktokcdn.com only)
        ├── Download images via httpx (existing pattern)
        ├── Multimodal analysis → Google Places resolution
        │
        └── Failed → Return helpful error + manual search option
```

### Implementation Phases

#### Phase 1: gallery-dl Client + Config

Create `backend/app/services/gallery_dl_client.py` and add proxy config.

**Design decisions:**
- **Metadata-only mode** (`--dump-json`): Extract image URLs without gallery-dl downloading files. We download images ourselves with httpx for consistent timeout/size control.
- **Security hardening** mirrors yt-dlp downloader pattern: strict URL validation, array-based subprocess args, process timeout with kill, stdout size limit, image URL validation.
- **Proxy passthrough**: Accept optional proxy URL, pass via `--proxy` flag.

```python
# backend/app/services/gallery_dl_client.py

ALLOWED_TIKTOK_PHOTO_PATTERN = re.compile(
    r"^https://(www\.)?tiktok\.com/@[\w.-]+/photo/\d+$"
)

# Validate image URLs from gallery-dl output (SSRF prevention)
ALLOWED_IMAGE_HOST_PATTERN = re.compile(
    r"^https://[a-z0-9-]+\.tiktokcdn\.com/"
)

DEFAULT_TIMEOUT_SECONDS = 8.0
MAX_IMAGES = 20
MAX_STDOUT_BYTES = 512 * 1024  # 512KB cap on subprocess output

async def fetch_tiktok_slideshow_gallery_dl(
    url: str,
    *,
    proxy_url: str | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> GalleryDLResult | None:
    """Extract TikTok slideshow images via gallery-dl subprocess.

    Returns image URLs + metadata, or None on failure.
    Images are NOT downloaded by gallery-dl -- caller handles download.
    """
    # 1. Validate URL against allowlist
    if not ALLOWED_TIKTOK_PHOTO_PATTERN.match(url):
        return None

    # 2. Build command (array args, never shell=True)
    cmd = [
        "gallery-dl",
        "--dump-json",          # Metadata only, no file downloads
        "--range", f"1-{MAX_IMAGES}",  # Limit output count
    ]
    if proxy_url:
        cmd.extend(["--proxy", proxy_url])
    cmd.append(url)

    # 3. Run as async subprocess with timeout + kill
    #    - Handle both TimeoutError and CancelledError with proc.kill()
    #    - Cap stdout read to MAX_STDOUT_BYTES
    # 4. Parse JSON lines output (skip non-JSON lines defensively)
    #    - Each line: [type, url, metadata]. Type 1 = downloadable URL
    #    - Filter for image URLs (exclude audio .m4a/.mp3 by extension)
    #    - Validate each URL against ALLOWED_IMAGE_HOST_PATTERN
    # 5. Extract caption from metadata dict
    # 6. Return GalleryDLResult(image_urls, caption)
```

**Output parsing notes:** gallery-dl `--dump-json` produces JSON lines. Each line is `[type, url, metadata_dict]`. Type `1` = downloadable URL. The parser must:
- Wrap each `json.loads()` in try/except and skip non-JSON lines (gallery-dl may emit warnings to stdout)
- Filter out audio files by URL extension (`.m4a`, `.mp3`)
- Validate image URLs use `https://` and point to `*.tiktokcdn.com` (SSRF prevention)
- Extract caption from the `description` field of the first metadata dict

```python
@dataclass
class GalleryDLResult:
    image_urls: list[str]       # Validated TikTok CDN URLs for slideshow images
    caption: str | None         # Post description/caption
```

**Config addition** (one setting):

```python
# backend/app/core/config.py -- add to Settings class:
tiktok_proxy_url: str | None = Field(default=None, repr=False)  # e.g., "http://user:pass@proxy:8080"
```

Note: `repr=False` prevents proxy credentials from appearing in debug output/tracebacks, matching the pattern used for other secrets in this codebase (`supabase_service_role_key`, `supabase_jwt_secret`, etc.).

```bash
# backend/.env.example -- add:
TIKTOK_PROXY_URL=                           # Optional: residential proxy for TikTok requests
```

**Proxy propagation to yt-dlp** (for TikTok video URLs):

```python
# backend/app/services/video_extractor/downloader.py -- add to cmd builder:
# When tiktok_proxy_url is set and URL is TikTok, add: "--proxy", proxy_url
```

**Files to create:**
- [backend/app/services/gallery_dl_client.py](backend/app/services/gallery_dl_client.py) -- New module

**Files to modify:**
- [backend/app/core/config.py](backend/app/core/config.py) -- Add `tiktok_proxy_url` with `repr=False`
- [backend/.env.example](backend/.env.example) -- Document `TIKTOK_PROXY_URL`
- [backend/app/services/video_extractor/downloader.py](backend/app/services/video_extractor/downloader.py) -- Add `--proxy` to yt-dlp command for TikTok URLs

#### Phase 2: Orchestrator Integration + Cleanup

Wire gallery-dl into the extraction pipeline, update error messages, and delete dead code.

**Modify `_extract_from_carousel()` in `extraction_orchestrator.py`:**

```python
# Current flow (line 736-848 of extraction_orchestrator.py):
#   if is_tiktok_photo(url):
#       slideshow = await fetch_tiktok_slideshow(url)
#       images = slideshow.images

# New flow:
#   if is_tiktok_photo(url):
#       result = await fetch_tiktok_slideshow_gallery_dl(
#           url, proxy_url=settings.tiktok_proxy_url, timeout=remaining
#       )
#       if result and result.image_urls:
#           images = await _download_images(result.image_urls, timeout=remaining)
#           caption = result.caption  # May enrich oEmbed caption
```

**Update error message** in `ingest.py`:

```python
# Replace: "TikTok photo slideshows don't provide metadata we can read."
# With:
"We couldn't identify a place from this TikTok slideshow. "
"You can still save it manually by searching for the place."
```

**Logging** (two log lines, not a taxonomy):
- Info on success: image count, duration_ms
- Warning on failure: error type, stderr snippet (first 200 chars), duration_ms

**Timeout budget allocation (within 15s total):**

| Step | Budget | Notes |
|------|--------|-------|
| Caption extraction | ~500ms (p70) | Existing, no change |
| gallery-dl subprocess | 8s max | Includes TikTok fetch + JSON parse |
| Image download (from URLs) | 4s | Concurrent download of slideshow images |
| Multimodal analysis | 2-3s | Existing, no change |
| Google Places resolution | 2-3s | Existing, no change |

Note: These are maximum budgets, not additive. The orchestrator's `_get_remaining_time(start_time)` pattern dynamically computes remaining budget for each step.

**Files to modify:**
- [backend/app/services/extraction_orchestrator.py](backend/app/services/extraction_orchestrator.py) -- Replace `fetch_tiktok_slideshow()` with `fetch_tiktok_slideshow_gallery_dl()`
- [backend/app/api/ingest.py](backend/app/api/ingest.py) -- Update error message

**Files to delete:**
- [backend/app/services/tiktok_slideshow.py](backend/app/services/tiktok_slideshow.py) -- Dead code, never worked
- [backend/tests/services/test_tiktok_slideshow.py](backend/tests/services/test_tiktok_slideshow.py) -- Tests for deleted module

#### Phase 3: Dependency + Cache Migration

**Add gallery-dl dependency:**

```toml
# backend/pyproject.toml -- add to [tool.poetry.dependencies]:
gallery-dl = "^1.31.0"
```

```txt
# backend/requirements.txt -- add:
gallery-dl>=1.31.0
```

**Cache invalidation migration** (clear stale negative results so they get re-extracted):

```sql
-- supabase/migrations/YYYYMMDDHHMMSS_clear_tiktok_slideshow_cache.sql
-- Clear cached negative TikTok slideshow results so they get re-extracted with gallery-dl
UPDATE oembed_cache
SET extraction_result = NULL, extraction_source = NULL
WHERE canonical_url LIKE 'https://www.tiktok.com/%/photo/%'
  AND (extraction_result = '[]' OR extraction_result IS NULL);
```

**Files to modify:**
- [backend/pyproject.toml](backend/pyproject.toml) -- Add gallery-dl dependency
- [backend/requirements.txt](backend/requirements.txt) -- Add gallery-dl

**Files to create:**
- `supabase/migrations/` -- Cache invalidation migration

## Security Considerations

gallery-dl subprocess execution requires the same security hardening applied to yt-dlp:

| Measure | Implementation |
|---------|---------------|
| URL validation | Strict regex: `^https://(www\.)?tiktok\.com/@[\w.-]+/photo/\d+$` |
| No shell execution | `subprocess.create_subprocess_exec()` with array args |
| Output count limit | `--range 1-20` to cap image count |
| Stdout size limit | Cap at 512KB before parsing (prevents memory exhaustion) |
| Process timeout | `asyncio.wait_for()` with SIGKILL on timeout |
| CancelledError handling | Mirror yt-dlp: `proc.kill()` + `await proc.wait()` on cancellation |
| No file writes | `--dump-json` mode -- no files written to disk |
| Image URL validation | Validate output URLs: `https://` scheme + `*.tiktokcdn.com` host (SSRF prevention) |
| Proxy credentials | `repr=False` on config field, never logged |

## Test Plan

**New test file:** `backend/tests/services/test_gallery_dl_client.py`

| Test Case | What It Verifies |
|-----------|-----------------|
| Valid TikTok photo URL accepted | URL validation regex allows canonical `/photo/` URLs |
| Non-TikTok URL rejected | URL validation returns `None` for non-matching URLs |
| Video URL rejected | `/video/` URLs return `None` (not our job) |
| Successful extraction | Mock subprocess returns JSON lines, images parsed correctly |
| Audio files filtered out | `.m4a`/`.mp3` URLs excluded from result |
| Non-TikTok CDN URLs rejected | Image URLs not matching `*.tiktokcdn.com` are dropped |
| gallery-dl not installed | Subprocess raises `FileNotFoundError`, returns `None` gracefully |
| Subprocess timeout | Process killed after timeout, returns `None` |
| CancelledError cleanup | Process killed on cancellation, no zombie |
| Malformed JSON lines | Non-JSON lines skipped, valid lines still parsed |
| Stdout size exceeded | Output truncated at 512KB, parsing still works |
| Empty output | Returns `None` when gallery-dl finds no images |
| Proxy config propagated | `--proxy` flag present in command when `tiktok_proxy_url` is set |

**Deleted test file:** `backend/tests/services/test_tiktok_slideshow.py` (tests for dead module)

## Acceptance Criteria

- [x] TikTok slideshow URLs (`/photo/`) successfully extract images via gallery-dl
- [x] Images are sent to multimodal extractor and places are detected
- [x] When gallery-dl fails, user gets a helpful error message (not "can't read metadata")
- [x] `TIKTOK_PROXY_URL` env var is accepted and passed to gallery-dl and yt-dlp
- [x] gallery-dl subprocess has URL validation, timeout, stdout size limit, and output count limit
- [x] Image URLs from gallery-dl are validated against TikTok CDN domains (SSRF prevention)
- [x] Proxy credentials are not exposed in logs or tracebacks (`repr=False`)
- [x] Subprocess handles both TimeoutError and CancelledError with process kill
- [x] Existing TikTok video extraction (`/video/` URLs via yt-dlp) is unaffected
- [x] Existing Instagram carousel extraction (via Instaloader) is unaffected
- [x] Dead `tiktok_slideshow.py` and its test file are removed
- [x] Backend tests cover all cases in the test plan above
- [x] Stale cache entries for TikTok slideshows are cleared via migration

## Dependencies & Risks

**Dependencies:**
- `gallery-dl >= 1.31.0` (pip installable, already in PATH pattern like yt-dlp)
- Optional: residential proxy service (~$5-15/month for testing)

**Risks:**

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| gallery-dl breaks with TikTok changes | Low (actively maintained) | Medium | Community fixes quickly; revert deploy if needed |
| TikTok blocks gallery-dl without proxy | Medium | Medium | Add proxy via `TIKTOK_PROXY_URL` |
| gallery-dl subprocess is slow (>8s) | Low | Low | Timeout with SIGKILL, manual search fallback |
| Image URLs from gallery-dl expire before download | Low | Low | Download immediately after extraction |
| gallery-dl dependency conflicts | Low | Medium | Pin version range `^1.31.0` |

## Success Metrics

- TikTok slideshow extraction success rate increases from ~0% to >70%
- gallery-dl extraction completes in <8 seconds (p95)
- No increase in error rate for TikTok video or Instagram extraction

## References & Research

### Internal References
- Dead TikTok slideshow scraper (to delete): [tiktok_slideshow.py](backend/app/services/tiktok_slideshow.py)
- Instagram carousel extractor (reference pattern): [instagram_carousel.py](backend/app/services/instagram_carousel.py)
- yt-dlp downloader (security pattern to mirror): [downloader.py](backend/app/services/video_extractor/downloader.py)
- Extraction orchestrator: [extraction_orchestrator.py](backend/app/services/extraction_orchestrator.py)
- Ingest endpoint: [ingest.py](backend/app/api/ingest.py)
- URL resolver: [url_resolver.py](backend/app/services/url_resolver.py)
- Config: [config.py](backend/app/core/config.py)
- Multimodal extractor: [multimodal_extractor.py](backend/app/services/multimodal_extractor.py)
- Brainstorm: [2026-02-01-multi-place-extraction-brainstorm.md](docs/brainstorms/2026-02-01-multi-place-extraction-brainstorm.md)

### External References
- [gallery-dl GitHub](https://github.com/mikf/gallery-dl) -- v1.31.5, 7k+ stars
- [gallery-dl TikTok support PR #6708](https://github.com/mikf/gallery-dl/pull/6708) -- Merged Feb 2025
- [gallery-dl native TikTok PR #8715](https://github.com/mikf/gallery-dl/pull/8715) -- Removed yt-dlp dependency, Dec 2025
- [yt-dlp TikTok photos: out of scope](https://github.com/yt-dlp/yt-dlp/issues/9990) -- Maintainer: "use gallery-dl"
- [gallery-dl TikTok config options](https://github.com/mikf/gallery-dl/issues/7060) -- Photos/audio/video toggles
- [gallery-dl PyPI](https://pypi.org/project/gallery-dl/)
