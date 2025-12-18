## Introduction / Overview

Atlasi users often discover compelling travel spots while scrolling TikTok or Instagram, but capturing those places inside Atlasi today is manual and error-prone. This feature delivers a seamless “Share → Atlasi” capture flow that receives social URLs via the native system share sheet (iOS Share Extension, Android share target), enriches them server-side, and converts them into Atlasi Place entries using the existing Google Places integration. TikTok is the hero path; Instagram follows the same UX while swapping in a different metadata adapter. The end goal is a one-tap save experience that reliably stores the source, thumbnail, and detected place—with graceful fallbacks when metadata is incomplete.

## Goals

1. Provide a frictionless, single-screen share flow from TikTok and Instagram into Atlasi on both iOS and Android.
2. Normalize shared URLs and enrich them via provider metadata plus Atlasi’s Google Places pipeline to create structured Place entries automatically.
3. Surface relevant trips (matching the detected place’s country) and allow quick trip association or creation without leaving the share flow.
4. Guarantee a reliable fallback path (clipboard listener + unresolved saves) so users never lose a discovered spot, even when metadata extraction is low-confidence.

## User Stories

- As a casual traveler who finds a restaurant on TikTok, I want to tap “Share → Atlasi” and save it instantly so I can revisit it later inside my Passport grid.
- As a user organizing an upcoming trip, I want Atlasi to auto-suggest trips that match the detected place so I can attach the saved spot to the right itinerary (or create a new trip) with one tap.
- As someone who copies Instagram links and opens Atlasi later, I want the app to notice the URL on my clipboard and prompt me to save it so I don’t forget.
- As a backend operator, I want all social saves to flow through a single ingestion pipeline with source-specific adapters so maintenance and compliance remain manageable.

## Functional Requirements

1. **System Share Targets**: Atlasi must register an iOS Share Extension (accepting `public.url` and `public.text`) and an Android `ACTION_SEND` handler for `text/plain` so TikTok/Instagram can hand off URLs (with optional caption text).
2. **Payload Handling**: The share UI must display the shared thumbnail (if available), detected place name, source platform icon, and a single primary `Save` CTA, plus an optional “Add to Trip” selector defaulting to the last used trip.
3. **Trip Association Logic**: When place data includes a country, the UI must list all user trips matching that country (no active/archived filtering, no list-length limit). Provide a prominent “Create New Trip” action if no trip exists or the user wants a new one.
4. **Clipboard Listener**: Within the core Atlasi app, detect when the clipboard holds a TikTok or Instagram URL and show a non-blocking banner (“Save TikTok place” / “Save Instagram place”) that opens the same capture UI. Provide opt-in/out controls aligned with OS privacy guidance.
5. **Backend Ingest Endpoint**: Implement `POST /ingest/social` (or `/ingest/tiktok` + `/ingest/instagram` if separated) that receives `url`, `source`, optional `caption`, and user context, then:  
   a. follows redirects once and stores the canonical URL,  
   b. identifies the provider (TikTok, Instagram, generic),  
   c. calls the appropriate metadata adapter,  
   d. runs the place-extraction pipeline, and  
   e. persists results.
6. **TikTok Metadata Adapter**: Use TikTok oEmbed (no user login) to retrieve title, author handle, thumbnail, and embed HTML. Never resort to brittle HTML scraping. Cache responses briefly to limit provider rate usage.
7. **Instagram Metadata Adapter**: Support Instagram via oEmbed when a Meta app token is configured (new env variables on mobile + backend). When oEmbed fails or the token is absent, fall back to a generic link preview (URL, host, shared text) and mark the save as unresolved.
8. **Place Extraction Pipeline**: From combined inputs (URL, oEmbed title, caption, author), detect place candidates, resolve via Google Places autocomplete → place details, and capture Place ID, name, city, country, lat/lng. Reuse the existing Google Places integration modules.
9. **Low-Confidence Handling**: If confidence falls below the agreed threshold, store the item as a “TikTok Save” or “Instagram Save” with source metadata and thumbnail so the user can fix the place later inside Atlasi.
10. **Data Model Updates**: Introduce or extend `SavedSource` (fields: `id`, `user_id`, `type`, `original_url`, `canonical_url`, `thumbnail_url`, `author_handle`, `caption`, timestamps) and link it to existing `Place` entries and optional `Trip` associations. Persist the Google Place ID plus city/country for quick filtering.
11. **Error + Retry UX**: If ingestion fails (network, provider outage), the share UI must show a friendly error and queue the payload locally for retry when connectivity returns. Clipboard saves should also retry silently.
12. **Analytics + Logging**: Instrument share start, metadata success/failure, place confidence, trip association, and save completion events for future success-metric tracking.

## Non-Goals / Out of Scope

- Building OAuth login flows for TikTok or Instagram.
- Scraping HTML from TikTok/Instagram web pages beyond officially provided oEmbed or generic OpenGraph previews.
- Supporting other social networks in this iteration (Pinterest, YouTube Shorts, etc.).
- Full-featured trip management inside the share extension (only lightweight selection/creation).

## Design Considerations

- Apply the `STYLEGUIDE.md` palette: Midnight Navy backgrounds, Warm Cream surfaces, and Sunset Gold primary CTAs to keep the capture UI on-brand.
- Present the shared thumbnail prominently with a soft card treatment (Paper Beige background, rounded corners) to reinforce the analog field-guide aesthetic.
- Typography: Playfair Display for the detected place/title, Open Sans for body/labels, following the defined weights and spacing.
- Ensure the single-screen flow looks identical across TikTok and Instagram captures; only the platform badge/icon differs. Keep secondary actions lightweight to maintain the “one-tap save” promise.

## Technical Considerations

- **Share Extension Architecture (iOS)**: Use an extension target that packages minimal dependencies, communicates with the main app via shared app group storage or background URL session, and posts payloads to the backend even when the main app is not running.
- **Android Share Target**: Implement an activity/receiver registered for `android.intent.action.SEND` with `text/plain`, extracting the first URL from `EXTRA_TEXT`. Ensure the activity can operate in `singleTask` mode to avoid spawning duplicates.
- **Environment Configuration**: Add secure env variables for the Instagram oEmbed token on both mobile (for availability gating) and backend (for API calls). Document keys in `mobile/.env.local` and `backend/.env`.
- **Backend Services**: Run redirect resolution and metadata fetch server-side to avoid mobile networking constraints and to centralize rate limiting. Consider background jobs or queues if ingestion becomes long-running.
- **Place Resolver Reuse**: Factor the video-to-place extraction into a reusable module so future sources (e.g., YouTube, articles) can plug into the same pipeline.
- **Security & Privacy**: Avoid storing clipboard contents beyond the session; respect OS clipboard access guidelines and provide an opt-out toggle in settings.

## Success Metrics

- ≥80% of TikTok share attempts successfully create a Place entry without manual edits.
- ≥60% of Instagram share attempts resolve with metadata (oEmbed or fallback) and are saved within 10 seconds.
- ≥50% of saves include a trip association via the share UI or clipboard banner.
- Track clipboard-banner conversions (impressions → saves) to ensure the backstop meaningfully increases captured content.

## Open Questions

1. What definitive KPIs should product leadership track post-launch (e.g., daily saves per user, percentage of high-confidence matches)? Current metrics are provisional.
2. Are there rate-limit or compliance caps for TikTok/Instagram oEmbed that require batching or caching strategies beyond simple short-term cache?
3. Should unresolved saves trigger user reminders inside Atlasi (e.g., “Complete place details”)? If so, what is the timing/UX?
4. Do we need localization support for share-extension copy at launch, or is English-only acceptable?
5. Should clipboard prompts expire after a time window to avoid resurfacing stale links?

