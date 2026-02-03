# Multi-Place Extraction from Social Media

**Date:** 2026-02-01
**Status:** Ready for Planning

## What We're Building

An enhanced social media ingestion system that extracts **multiple places** from a single TikTok/Instagram share, with fallback to video frame analysis and screenshot OCR when caption parsing fails.

### Core Capabilities

1. **Multi-place extraction** - Detect and return all specific places mentioned in a post, not just the first one
2. **Video frame analysis** - When caption yields no places, extract frames from videos (1 per 1-2 seconds) and run OCR to find on-screen text
3. **Slideshow/carousel scanning** - Read text from all images in Instagram carousels
4. **Screenshot support** - Accept shared screenshots and extract place names via OCR
5. **Smart context filtering** - Use broad locations (countries, cities) as Google Places search bias but exclude them from results

### User Flow

1. User shares TikTok/Instagram URL (or screenshot) via Share Extension or in-app
2. Backend processes with cascading extraction: caption → video frames → slideshow images
3. Returns array of detected places (0 to many)
4. Mobile shows checkbox list with all places pre-selected
5. User unchecks unwanted places, can tap any place to replace it via search
6. User selects trip and saves all selected places as entries

## Why This Approach

**Cascading Extraction Pipeline** was chosen over alternatives:

| Decision                     | Rationale                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Backend-only processing      | Avoids iOS Share Extension memory limits, single codebase, Swift/RN parity         |
| Fallback-only video analysis | Cost optimization—most posts have good captions, no need to process video          |
| Checkbox list UI             | Fastest for "select all" use case, familiar pattern, minimal taps                  |
| Auto-filter broad locations  | Users want specific places, not "Thailand" as an entry—silently use as search bias |
| 15-second timeout            | Allows thorough video processing while keeping perceived performance reasonable    |
| Full Share Extension parity  | Consistent UX regardless of entry point                                            |

## Key Decisions

### Extraction Pipeline

```
1. Caption/Title Parsing (existing LLM + regex)
   ↓ Found specific places? → Return array
   ↓ No specific places found

2. Video Frame Extraction (new)
   - Download video via yt-dlp or similar
   - Extract frames at 1 per 2 seconds
   - Run parallel OCR on frames
   - LLM processes combined text for place extraction
   ↓ Found places? → Return array
   ↓ No places found

3. Slideshow/Image Scanning (new)
   - For Instagram carousels, fetch all images
   - Run OCR on each image
   - LLM processes combined text
   ↓ Return array (may be empty)
```

### Context Location Filtering

When extraction finds broad locations like "14 days in Thailand" or "Perfect Italy itinerary":

- **DO**: Use "Thailand" or "Italy" as `location_bias` for Google Places API searches
- **DON'T**: Include "Thailand" or "Italy" as detected places in the results
- **Detection signals**: Phrases like "X days in [Country]", "[Country] itinerary", "trip to [City]", "guide to [Region]"

### Multi-Place Response Schema

```python
class SocialIngestResponse(BaseModel):
    # ... existing fields ...

    # Changed from single to array
    detected_places: list[DetectedPlace]  # Was: detected_place: DetectedPlace | None

    # New metadata
    extraction_source: Literal["caption", "video_frames", "slideshow", "screenshot"]
    context_location: str | None  # e.g., "Thailand" - used as bias, not a place
    processing_time_ms: int
```

### Multi-Place Selection UI

Both React Native and Swift Share Extension will implement:

```
┌─────────────────────────────────────────┐
│ [Thumbnail]  @travel_creator            │
│              "Best spots in Bali!"      │
├─────────────────────────────────────────┤
│ Found 4 places                          │
│                                         │
│ ☑ Tanah Lot Temple            [Edit]   │
│   Bali, Indonesia • Place              │
│                                         │
│ ☑ Warung Babi Guling Ibu Oka  [Edit]   │
│   Ubud, Indonesia • Food               │
│                                         │
│ ☑ COMO Uma Ubud               [Edit]   │
│   Ubud, Indonesia • Stay               │
│                                         │
│ ☑ Tegallalang Rice Terraces   [Edit]   │
│   Bali, Indonesia • Place              │
│                                         │
├─────────────────────────────────────────┤
│ Trip: [Bali 2026           ▼]          │
│                                         │
│ [Save 4 Places]                        │
└─────────────────────────────────────────┘
```

**Edit action:** Opens place search to replace the detected place with a different one.

### Screenshot Handling

When user shares an image (not a URL):

1. Detect it's an image, not a URL
2. Run OCR to extract all visible text -> use OpenRouter for this, Gemini Flash Lite 2.5 should still work
3. Pass text to LLM for place extraction -> if it is faster to just pass the image and do it all in one go instead of two steps here, then probably keep it the same
4. Return places array (same flow as video frames)
5. No thumbnail/author metadata available for screenshots

### Batch Save Endpoint

New or modified endpoint to save multiple entries at once:

```python
@router.post("/ingest/save-places")
async def save_places(
    data: SavePlacesRequest,  # Contains list of places + single trip_id
    user: CurrentUser,
) -> list[EntryWithPlace]:
    # Atomic transaction: create all entries for the trip
    # Handle duplicates gracefully (skip already-saved places)
```

## Open Questions

1. **Video download reliability** - yt-dlp works for TikTok/Instagram, but may break with platform changes. Need monitoring/alerts.

2. **OCR provider** - Use Gemini 2.5 flash lite ideally (already have OpenRouter) or similar?

3. **Frame extraction compute** - Run ffmpeg on backend server unless a video processing service (AWS MediaConvert) is much cheaper?

4. **Rate limiting** - Video processing is expensive. Just set up monitroing. Only works for premium users (after the 5 monthly)

5. **Caching** - Yes, we should absolutely do Cache extraction results by URL to avoid re-processing same video

## Out of Scope

- Extracting places from post comments (would require Instagram/TikTok API auth)
- Real-time video streaming analysis
- Audio transcription for spoken place names
- Automatic trip creation from detected country

## Success Criteria

- Caption extraction finds 2+ places in multi-place posts (vs. 1 today)
- Video frame analysis finds places in 70%+ of posts where caption failed
- End-to-end latency under 15 seconds for video processing path
- User can save all detected places in 2 taps (confirm selection → save)
- Share Extension and in-app have identical capabilities

---

**Next step:** Run `/workflows:plan` to create implementation plan.
