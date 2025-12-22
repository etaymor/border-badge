## Relevant Files

### Backend
- `supabase/migrations/0025_social_ingest.sql` - Database schema for saved_source and oembed_cache tables
- `backend/app/schemas/social_ingest.py` - Pydantic models for ingest requests/responses
- `backend/app/services/url_resolver.py` - URL canonicalization and provider detection
- `backend/app/services/oembed_adapters.py` - TikTok/Instagram oEmbed API clients with caching
- `backend/app/services/place_extractor.py` - Extract place candidates from metadata, resolve via Google Places
- `backend/app/api/ingest.py` - FastAPI routes for `/ingest/social`
- `backend/tests/services/test_url_resolver.py` - Unit tests for URL processing
- `backend/tests/services/test_oembed_adapters.py` - Unit tests for oEmbed adapters
- `backend/tests/api/test_ingest.py` - Integration tests for ingest API

### Mobile - Share UI
- `mobile/src/screens/share/ShareCaptureScreen.tsx` - Main share capture UI with place confirmation
- `mobile/src/components/share/TripSelector.tsx` - Trip dropdown with inline creation
- `mobile/src/components/share/InlineTripForm.tsx` - Quick trip creation form
- `mobile/src/components/share/ClipboardBanner.tsx` - Floating prompt for clipboard URLs
- `mobile/src/hooks/useSocialIngest.ts` - React Query mutations for ingest API
- `mobile/src/hooks/useClipboardListener.ts` - Clipboard detection on app foreground

### Mobile - Native Extensions
- `mobile/plugins/withShareExtension.js` - Expo config plugin for iOS Share Extension
- `mobile/plugins/share-extension/ShareViewController.swift` - iOS Share Extension Swift code
- `mobile/plugins/share-extension/Info.plist` - Extension configuration
- `mobile/plugins/share-extension/ShareExtension.entitlements` - App Group entitlements
- `mobile/src/services/shareExtensionBridge.ts` - Bridge to read shared data from App Group
- `mobile/src/__tests__/services/shareExtensionBridge.test.ts` - Unit tests for share extension bridge
- `mobile/src/services/shareQueue.ts` - Local retry queue for failed submissions

### Notes

- Unit tests live beside the files being tested (e.g., `Component.tsx` with `Component.test.tsx`)
- Use `npm run test -- [path]` inside `mobile/` and `poetry run pytest [path]` inside `backend/`
- Focus tests on critical logic (URL parsing, oEmbed, place extraction, retry queue) - skip UI component tests

## Tasks

- [x] 1.0 Backend Social Ingest API
  - [x] 1.1 Create database migration `0025_social_ingest.sql` with `saved_source` table, `oembed_cache` table, and RLS policies
  - [x] 1.2 Create Pydantic schemas in `social_ingest.py` for ingest request/response and provider enum
  - [x] 1.3 Implement URL canonicalization service in `url_resolver.py` (follow redirects, detect provider, normalize URL)
  - [x] 1.4 Implement oEmbed adapters in `oembed_adapters.py` (TikTok oEmbed, Instagram oEmbed with token, OpenGraph fallback, database caching)
  - [x] 1.5 Implement place extraction in `place_extractor.py` (extract candidates from oEmbed/caption, call Google Places, return with confidence)
  - [x] 1.6 Create ingest API endpoint in `ingest.py` with rate limiting and register router
  - [x] 1.7 Write backend tests for URL resolver, oEmbed adapters, and ingest API integration

- [x] 2.0 Mobile Share Capture UI
  - [x] 2.1 Create ShareCaptureScreen with branded UI (thumbnail, place autocomplete, trip selector, save CTA)
  - [x] 2.2 Create TripSelector component with country-filtered trips and "Create new trip" option
  - [x] 2.3 Create InlineTripForm for quick trip creation within share flow
  - [x] 2.4 Create useSocialIngest hook with mutations for `/ingest/social` and save-to-trip
  - [x] 2.5 Add ShareCaptureScreen to navigation with modal presentation and deep link params

- [x] 3.0 Clipboard Detection (In-App Fallback)
  - [x] 3.1 Create useClipboardListener hook to detect TikTok/Instagram URLs on app foreground
  - [x] 3.2 Create ClipboardBanner component for non-blocking prompt UI
  - [x] 3.3 Add clipboard detection opt-out toggle to ProfileSettingsScreen
  - [x] 3.4 Write tests for clipboard URL pattern detection

- [x] 4.0 iOS Share Extension
  - [x] 4.1 Create iOS Share Extension target with entitlements and App Group configuration
  - [x] 4.2 Implement ShareViewController.swift to extract URL and pass to main app
  - [x] 4.3 Create shareExtensionBridge.ts to read shared URL from App Group storage
  - [x] 4.4 Update App.tsx to handle deep links and open ShareCaptureScreen

- [ ] 5.0 Android Share Target
  - [ ] 5.1 Add ACTION_SEND intent filter to AndroidManifest.xml for text/plain
  - [ ] 5.2 Create androidShareHandler.ts to extract URL from shared intent
  - [ ] 5.3 Wire intent handling to open ShareCaptureScreen with URL

- [x] 6.0 Reliability and Polish
  - [x] 6.1 Implement shareQueue.ts for local retry queue with exponential backoff
  - [x] 6.2 Add error states to ShareCaptureScreen (provider outage, offline, retry)
  - [x] 6.3 Add analytics events for share flow (started, completed, failed, place detection, trip selection)
  - [x] 6.4 Write tests for retry queue persistence and flush behavior

- [ ] 7.0 Share Ingest Bug Fixes
  - [x] 7.1 Validate Supabase token usage in ingest endpoints
  - [x] 7.2 Restrict save-to-trip verification to owner trips
  - [x] 7.3 Prevent authenticated shares from being stored as pending when navigation isn't ready
