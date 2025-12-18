## Relevant Files

- `mobile/src/extensions/share/ShareCaptureScreen.tsx` - Primary UI for the Share Extension/Share Target one-tap save surface.
- `mobile/src/extensions/share/__tests__/ShareCaptureScreen.test.tsx` - Component tests for ShareCaptureScreen interactions.
- `mobile/src/ios/ShareExtensionViewController.swift` - Native wrapper that hands URLs into the React Native share UI.
- `mobile/src/android/share/ShareTargetActivity.kt` - Android share target activity receiving ACTION_SEND intents.
- `mobile/src/hooks/useClipboardListener.ts` - Hooks for clipboard detection and prompting logic.
- `mobile/src/hooks/__tests__/useClipboardListener.test.ts` - Unit tests validating clipboard prompt behavior.
- `mobile/src/services/shareQueue.ts` - Local queue for retrying failed share submissions.
- `mobile/src/services/__tests__/shareQueue.test.ts` - Unit tests covering retry and persistence logic.
- `mobile/src/services/analytics.ts` - Event logging for share start/success/failure metrics.
- `backend/app/api/ingest.py` - FastAPI routes for `/ingest/social`, `/ingest/tiktok`, `/ingest/instagram`.
- `backend/tests/api/test_ingest.py` - API tests covering success, low-confidence, rate-limit, and error paths.
- `backend/app/services/social_ingest.py` - Canonicalization, metadata adapters, caching, and place extraction orchestration.
- `backend/tests/services/test_social_ingest.py` - Unit tests for adapters, caching, and Google Places resolution.
- `backend/app/models/saved_source.py` - SQLAlchemy/Pydantic models for SavedSource and relationships to Place/Trip.
- `backend/migrations/` - Schema migrations adding SavedSource tables/columns.

### Notes

- Unit tests should typically live beside the files being tested (e.g., `Component.tsx` with `Component.test.tsx`).
- Use `npm run test -- [path]` inside `mobile/` and `poetry run pytest [path]` inside `backend/` for targeted suites. Running without a path executes the entire test suite.

## Tasks

- [ ] 1.0 Build cross-platform share capture surfaces
  - [ ] 1.1 Create the iOS Share Extension target, configure entitlements/app group, and load the React Native `ShareCaptureScreen`.
  - [ ] 1.2 Implement the branded one-tap UI (thumbnail, detected place, Save CTA, trip selector) shared across iOS/Android.
  - [ ] 1.3 Wire the Share Extension to package payloads (URL, caption, source, user auth token) and post them to the core app/backend.
  - [ ] 1.4 Register an Android `ACTION_SEND` share target activity that extracts the first URL from `EXTRA_TEXT` and opens the same React Native UI.
  - [ ] 1.5 Add automated UI tests (React Native testing library) covering TikTok and Instagram share flows, including trip picker behavior.

- [ ] 2.0 Implement social ingestion backend with caching and rate limiting
  - [ ] 2.1 Add FastAPI routes (`/ingest/social`, `/ingest/tiktok`, `/ingest/instagram`) and request schemas for URL + caption payloads.
  - [ ] 2.2 Build canonicalization utilities that follow one redirect, detect provider, and normalize URLs for storage.
  - [ ] 2.3 Implement TikTok oEmbed adapter with short-term response caching (e.g., Redis) to avoid redundant provider calls.
  - [ ] 2.4 Implement Instagram metadata adapter using the Meta access token (config via env vars) plus fallback OpenGraph fetch; include cache + error handling.
  - [ ] 2.5 Enforce rate limiting on all ingest endpoints (per-user + global ceilings) and add structured logging when limits trigger.
  - [ ] 2.6 Write backend unit/integration tests covering success paths, cache hits, provider failures, and rate-limit responses.

- [ ] 3.0 Extend place extraction, trip association, and persistence
  - [ ] 3.1 Update or create `SavedSource` models, migrations, and repositories to store original/canonical URLs, thumbnails, captions, and author handles.
  - [ ] 3.2 Integrate the existing Google Places autocomplete → details pipeline, returning confidence scores and resolved Place IDs.
  - [ ] 3.3 Implement trip matching logic (by country) plus “create new trip” support in the backend payloads consumed by the share UI.
  - [ ] 3.4 Persist SavedSource ↔ Place ↔ Trip relationships and expose them via existing APIs for downstream use.
  - [ ] 3.5 Add automated tests for persistence logic and place resolution edge cases (high confidence vs. unresolved saves).

- [ ] 4.0 Deliver reliability backstops and failure handling
  - [ ] 4.1 Implement the in-app clipboard listener hook that detects TikTok/Instagram URLs (with opt-in/out settings) and launches the capture UI.
  - [ ] 4.2 Build a local retry queue for failed share submissions with exponential backoff and foreground/background flush triggers.
  - [ ] 4.3 Design error states for the share UI (provider outage, offline) and ensure users can retry or save as unresolved.
  - [ ] 4.4 Add automated tests for clipboard prompts, queue persistence, and retry behavior (including offline simulations).

- [ ] 5.0 Instrument analytics, monitoring, and critical tests
  - [ ] 5.1 Define and emit analytics events for share start/completion, metadata success/failure, trip association, clipboard prompt conversions.
  - [ ] 5.2 Add observability on the backend (structured logs, metrics for cache hit ratio, rate-limit counts, adapter latency).
  - [ ] 5.3 Expand automated test coverage: end-to-end happy path (share → saved place), low-confidence fallback, and rate-limit enforcement scenarios.
  - [ ] 5.4 Document test plans and add CI checks ensuring new suites (mobile + backend) run on every PR.

