## Relevant Files

- `backend/app/api/trips.py` - FastAPI routes for `/trips`, `/trips/:id`, and any list/filter endpoints used by country detail and trip list screens (`docs/travel-technical-design.md` L279–360).
- `backend/app/api/entries.py` - FastAPI routes for `/trips/:trip_id/entries`, `/entries/:id`, and delete operations used by entry list and edit flows (`docs/travel-technical-design.md` L362–417).
- `backend/app/api/places.py` - Backend endpoint for `/places/:id`, returning canonical place metadata given a stored `google_place_id` (`docs/travel-technical-design.md` L423–435).
- `backend/app/api/media.py` - FastAPI routes for `/media/files/signed-url`, `/media/files/:id`, and delete, plus handling upload status transitions (`docs/travel-technical-design.md` L436–470, L513–521).
- `mobile/src/navigation/index.tsx` - Navigation setup that links the passport tab to country detail, trip detail, entry list, and entry form screens.
- `mobile/src/navigation/types.ts` - Route/param type definitions for new Phase 4 screens (country detail, trip form/detail, entry list/form).
- `mobile/src/screens/Tabs/PassportScreen.tsx` - Main passport view; will gain navigation into the per-country detail and trip list (`docs/travel-mvp-blueprint.md` L384–391).
- `mobile/src/screens/Country/CountryDetailScreen.tsx` - New screen showing basic country info and listing trips for that country (`docs/travel-mvp-blueprint.md` L384–391).
- `mobile/src/screens/Trips/TripFormScreen.tsx` - Screen for creating and editing trips, including required/optional fields (`docs/travel-mvp-blueprint.md` L393–403; `docs/travel-technical-design.md` L281–299).
- `mobile/src/screens/Trips/TripDetailScreen.tsx` - Screen showing a single trip’s metadata and its entries list (backed by `/trips/:id` and `/trips/:trip_id/entries`).
- `mobile/src/screens/Entries/EntryListScreen.tsx` - Screen listing entries per trip and providing navigation to add/edit entry forms (`docs/travel-technical-design.md` L364–377).
- `mobile/src/screens/Entries/EntryFormScreen.tsx` - Screen for creating and editing entries of type place/food/stay/experience (`docs/travel-mvp-blueprint.md` L404–413; `docs/travel-technical-design.md` L381–399).
- `mobile/src/components/entries/PlacesAutocomplete.tsx` - Reusable component providing Google Places autocomplete UI (hybrid model: mobile → Google for suggestions; backend `/places/:id` for canonical details).
- `mobile/src/components/media/EntryMediaGallery.tsx` - Component showing entry photos as thumbnails and a full-screen gallery view (`docs/travel-mvp-blueprint.md` L424–434).
- `infra/supabase/migrations/0004_lists.sql` - Supabase migration defining shared list tables (e.g., `list` and `list_entries`) for US-011/012, scoped to a single trip (`docs/travel-prd.md` L173–179, L459–473).
- `backend/app/schemas/lists.py` - Pydantic models for list creation, list detail, and list entry references.
- `backend/app/api/lists.py` - FastAPI routes for creating and viewing shared lists for a trip, to be consumed by both mobile and public web (`docs/travel-prd.md` L459–473).
- `mobile/src/api/hooks/useLists.ts` - React Query hooks for creating and fetching lists linked to a trip.
- `mobile/src/screens/Lists/ListCreateScreen.tsx` - Screen for naming a list and selecting entries from a single trip to include.
- `mobile/src/screens/Lists/ListDetailScreen.tsx` - Optional in-app view for a list, reusing the same structure that will later power the public web view.
- `mobile/src/api/hooks/useTrips.ts` - React Query hook(s) extended to support listing trips (optionally by `country_id`) and fetching trip detail per `docs/travel-technical-design.md` L279–326.
- `mobile/src/api/hooks/useTripEntries.ts` - Hooks for listing and mutating entries under a trip per L362–417.
- `mobile/src/api/hooks/useMedia.ts` - New hook for requesting signed URLs, tracking upload status, and fetching/deleting media metadata (`docs/travel-technical-design.md` L436–470, L513–521).
- `mobile/src/config/env.ts` - Environment configuration used to hold Google Places API key and any flags for Places/autocomplete behavior (`docs/travel-technical-design.md` L423–435, L529–541).
- `backend/tests/test_trips_and_entries_phase4.py` - Backend tests for trip and entry flows, including country-filtered trip lists, entry CRUD, and behavior for delete/undo-related user stories US-005–010 and US-016–018.
- `backend/tests/test_media_phase4.py` - Backend tests focused on media upload status transitions (`uploaded`/`processing`/`failed`) and edge cases described in `docs/travel-technical-design.md` L513–525.
- `mobile/src/__tests__/flows/TripAndEntryFlow.test.tsx` - Integration-style mobile test that covers creating a trip, adding entries, and uploading photos from the user’s perspective.

### Notes

- Phase 4 implements the **Trips, Entries, Places & Media** behavior described in `docs/travel-mvp-blueprint.md` L381–437 and is where user stories **US-005–010** and parts of **US-016–018** become usable in the app (`docs/travel-prd.md` L411–457, L499–521).
- Backend contracts for trips, entries, places, and media are defined in `docs/travel-technical-design.md` L279–417 and L423–470, with upload status semantics in L513–521; the frontend should not invent new shapes but consume these APIs consistently.
- Google Places is implemented using a **hybrid model**: mobile calls the Google Places API directly for autocomplete suggestions (fast UX), while the backend’s `/places/:id` endpoint is used for canonical place details tied to stored `google_place_id` values.
- Photo uploads follow the simple but robust state machine from `docs/travel-technical-design.md` L513–521: `processing` → `uploaded` or `failed`, with basic retry support (no full background queue yet).
- Shared lists are authored in this phase (list creation and entry selection per trip), while **public web views and SEO** for those lists are implemented later in Phase 9; the data model and APIs defined here are the foundation for those public endpoints.

## Tasks

- [x] 1.0 Refine and extend backend trips/entries/media endpoints for Phase 4 use cases
  - [x] 1.1 Review existing implementations in `backend/app/api/trips.py`, `entries.py`, and `media.py` (if present) and align them with the contracts in `docs/travel-technical-design.md` L279–417 and L436–470 (request/response shapes, status codes, and error format L486–495).
  - [x] 1.2 Add or confirm a `GET /trips` endpoint that can return trips filtered by `country_id` for use on the country detail screen, enforcing the visibility rules and RLS already defined (owner or approved tagged users only).
  - [x] 1.3 Ensure `GET /trips/:id` returns enough data for the trip detail screen: country, name, cover image URL, date range, and a summarized view of entries and `trip_tags` as defined in `docs/travel-technical-design.md` L315–323.
  - [x] 1.4 Confirm `GET /trips/:trip_id/entries` and `POST /trips/:trip_id/entries` (plus `/entries/:id` update/delete) support all entry types (`place`, `food`, `stay`, `experience`) and validate request bodies according to L381–399 (e.g., metadata for Places-backed entries).
  - [x] 1.5 Ensure `/media/files/signed-url`, `/media/files/:id`, and delete routes correctly update `media_files.status` from `processing` to `uploaded` or `failed` per L513–521 and handle error cases like 413 (file too large) and 400 (invalid type).
  - [x] 1.6 Add or update docstrings and inline comments on these endpoints describing how mobile clients should use them in the Phase 4 flows, and verify they integrate with existing RLS policies from Phase 1.

- [x] 2.0 Implement Country Detail screen and trip list UI wired to backend `/trips`
  - [x] 2.1 Add a new route and type definition for `CountryDetail` (e.g., `CountryDetailScreen`) in `mobile/src/navigation/types.ts`, with a route parameter containing at least `countryId` and optionally `countryName`/`flagUrl`.
  - [x] 2.2 Implement `CountryDetailScreen` to show basic country information (flag, name, region) fetched either from cached `/countries` data or from a small local mapping, and to serve as the entry point into that country's trips (`docs/travel-mvp-blueprint.md` L384–391).
  - [x] 2.3 Extend `useTrips` to support fetching trips filtered by `country_id` and use this in `CountryDetailScreen` to render a scrollable list of trips (name, date range, cover image thumbnail).
  - [x] 2.4 Add a primary "Create trip" CTA on `CountryDetailScreen` that navigates to `TripFormScreen`, passing along the `countryId` and any useful context (e.g., `countryName`).
  - [x] 2.5 Wire `PassportScreen` so that tapping on a country tile navigates to `CountryDetailScreen` with the correct params, using the navigation types to enforce correctness.

- [x] 3.0 Implement trip creation and editing flows
  - [x] 3.1 Create `TripFormScreen` with input fields matching the trip model in `docs/travel-technical-design.md` L287–295: `name` (required), `date_range` (optional), `cover_image_url` (optional), and implicit `country_id` from navigation params.
  - [x] 3.2 Implement client-side validation to ensure required fields (trip name) are present and user-friendly error messages are shown before hitting the backend.
  - [x] 3.3 Extend `useTrips` (or create a `useTripMutations` helper) to provide functions that call `POST /trips` (for create) and, if needed, a PATCH/PUT equivalent for editing trips; ensure the request body matches the schema and semantics in L289–297.
  - [x] 3.4 In `TripFormScreen`, wire the "Save" action to `POST /trips` for new trips, updating React Query caches (e.g., invalidating country-specific trips queries) and navigating back to `CountryDetailScreen` or directly to `TripDetailScreen` after success.
  - [x] 3.5 For editing, allow `TripFormScreen` to receive an existing trip object from navigation params, pre-fill the form, and call the appropriate update endpoint, keeping cover image handling minimal for now.
  - [x] 3.6 Add read-only UI hints around future tagging/consent (Phase 5) such as a placeholder "Tag friends (coming soon)" section so the trip form layout will not need major restructuring later.

- [x] 4.0 Implement entry logging UI backed by `/trips/:trip_id/entries`
  - [x] 4.1 Create `EntryListScreen` that takes a `tripId` (and optional trip title) via route params, calls `useTripEntries` to fetch entries from `GET /trips/:trip_id/entries`, and renders them grouped or sorted by date per `docs/travel-technical-design.md` L364–377.
  - [x] 4.2 Implement a compact entry card design that shows entry `type`, `title`, date, and a small indication of attached media, using shared UI primitives (`Screen`, `Text`, etc.).
  - [x] 4.3 Create `EntryFormScreen` that allows creating and editing entries with fields consistent with the entry schema in `docs/travel-technical-design.md` L389–396: `type`, `title`, `date`, `notes`, and `metadata` (which may include `google_place_id` and coordinates).
  - [x] 4.4 Extend `useTripEntries` with mutation functions that call `POST /trips/:trip_id/entries` for create and `/entries/:id` update/delete endpoints for editing/deleting entries, updating or invalidating the query cache appropriately.
  - [x] 4.5 Support all four entry types (place/food/stay/experience) by adjusting the form UI (e.g., toggles or segmented control) while keeping underlying API calls aligned with the single entry schema (type-agnostic where possible).
  - [x] 4.6 Implement delete behavior that triggers `/entries/:id/delete` (or the chosen HTTP method) and hooks into Phase 7's delete/undo UX by, at minimum, surfacing a toast or snackbar placeholder that could be upgraded later to a full undo pattern (`docs/travel-prd.md` L293; US-016 L499–505).

- [x] 5.0 Implement Google Places autocomplete and quota fallback behavior
  - [x] 5.1 Decide and document how the Google Places API key is stored for the mobile app (e.g., via Expo config `extra` + `env.ts`), ensuring it is scoped appropriately for client use and not accidentally committed in plaintext to the repo (`docs/travel-technical-design.md` L423–435, L529–541).
  - [x] 5.2 Implement `PlacesAutocomplete` as a reusable component used on `EntryFormScreen` for `place`, `food`, and `stay` types, showing a search field and a list of suggestions with place name and address (`docs/travel-prd.md` L167–171, L269–271).
  - [x] 5.3 Use a debounced text input to call Google Places API directly from the client for suggestions, handling network errors gracefully and cancelling in-flight requests as the user types.
  - [x] 5.4 When the user selects a suggestion, capture and store key place fields in entry `metadata` (e.g., `google_place_id`, `lat`, `lng`, `place_name`, `address`), consistent with the `place` entity in `docs/travel-technical-design.md` L141–150.
  - [x] 5.5 Integrate with the backend `/places/:id` endpoint so that when entries are later read, they can fetch canonical place details from the backend if needed, instead of repeatedly querying Google Places for each view.
  - [x] 5.6 Implement quota/limit fallback behavior per US-018: when the Places API returns quota or authorization errors (e.g., HTTP 429/403), show a manual entry UI (simple text fields) as a fallback and surface a clear, friendly message to the user (`docs/travel-prd.md` L287–291; `docs/travel-technical-design.md` L423–435, L515–521).

- [x] 6.0 Implement media upload and gallery for entries using signed URLs
  - [x] 6.1 Create a `useMedia` hook that encapsulates the flow described in `docs/travel-technical-design.md` L436–456 and L513–521: request a signed URL from `/media/files/signed-url`, upload the file to Storage, and then poll or update `media_files.status` from `processing` to `uploaded` or `failed`.
  - [x] 6.2 Implement `EntryMediaGallery` to display attached photos for an entry as a grid of thumbnails and a simple full-screen viewer (e.g., modal or dedicated screen) when the user taps an image (`docs/travel-mvp-blueprint.md` L424–434).
  - [x] 6.3 On `EntryFormScreen`, integrate a photo picker that allows the user to choose up to 10 photos per entry, matching US-010's requirement and PRD guidance (`docs/travel-prd.md` L113–119, L451–457).
  - [x] 6.4 Use `useMedia` in the photo picker flow to upload selected images sequentially or in small batches, updating local UI to reflect per-file status (`uploading`, `uploaded`, `failed`) and preventing the user from exceeding the per-entry limit.
  - [x] 6.5 Implement basic retry behavior for `failed` uploads: allow the user to tap a "Retry" action that re-requests a signed URL and repeats the upload without requiring them to re-pick the image.
  - [x] 6.6 Wire delete behavior so that removing a photo from an entry triggers `/media/files/:id/delete` and removes the thumbnail from the gallery; respect RLS and ownership logic from Phase 1 to prevent unauthorized deletions.

- [x] 7.0 Implement shared list creation and share-link generation for trips
  - [x] 7.1 Design the minimal list data model in `infra/supabase/migrations/0004_lists.sql` for US-011/012 (`docs/travel-prd.md` L173–179, L459–473):
    - `list` table with: `id`, `trip_id` (FK), `owner_id` (FK to list creator), `name`, `slug`, `created_at`, optional `description`, and a boolean `is_public` or `is_shareable`.
    - `list_entries` table with: `id`, `list_id` (FK), `entry_id` (FK), and `created_at`.
  - [x] 7.2 Enforce via schema and RLS that:
    - Only the **trip owner** can create and manage lists for that trip (not tagged participants).
    - Lists are restricted to entries belonging to the same `trip_id`.
    - Other users can only read list data when explicitly allowed (to be leveraged in Phase 9 public endpoints).
  - [x] 7.3 Implement `backend/app/schemas/lists.py` with Pydantic models for:
    - List creation request (name, description, array of `entry_ids`).
    - List summary (id, name, slug, entry count).
    - List detail (id, name, description, entries with minimal details).
  - [x] 7.4 Implement `backend/app/api/lists.py` with endpoints:
    - `GET /trips/{trip_id}/lists` to return lists owned by the current user for that trip.
    - `POST /trips/{trip_id}/lists` to create a new list:
      - Verifies that the current user owns the trip.
      - Verifies all `entry_ids` belong to that trip.
      - Generates a unique `slug` suitable for use in public URLs (e.g., based on name + short ID).
    - `GET /lists/{id}` (or `/lists/{slug}`) to return in-app list details for the owner (and later, restricted viewers if needed).
  - [x] 7.5 Implement `mobile/src/api/hooks/useLists.ts` to:
    - Fetch lists for a trip via `GET /trips/{trip_id}/lists`.
    - Create a list via `POST /trips/{trip_id}/lists`, returning the new list (including `slug`).
  - [x] 7.6 Add a "Share list" CTA to `TripDetailScreen`:
    - Visible only to the trip owner (based on user/trip ownership).
    - Navigates to `ListCreateScreen` with the `tripId` and trip metadata.
  - [x] 7.7 Implement `ListCreateScreen`:
    - Allows the user to enter a list name (required) and optional short description.
    - Shows a multi-select list of entries from that trip (leveraging `useTripEntries`).
    - On save, calls `useLists().createList(tripId, { name, description, entryIds })`, then shows a confirmation view with the generated share link (e.g., constructed as `${PUBLIC_BASE_URL}/public/lists/${slug}`).
  - [x] 7.8 Optionally implement `ListDetailScreen` for in-app viewing of a list, reusing the same structural layout that will later be mirrored in the Phase 9 public web view.
  - [x] 7.9 Ensure that nothing in the list data model or endpoints prevents future extensions to:
    - Support lists spanning multiple trips (e.g., by generalizing the `trip_id` constraint later).
    - Expose lists via the Phase 9 public endpoints without breaking existing data.

- [ ] 8.0 Add backend and mobile tests for trips, entries, Places fallback, media upload, and shared lists
  - [x] 8.1 Implement `backend/tests/test_trips_and_entries_phase4.py` to cover core flows: creating a trip under a country, listing trips by `country_id`, creating entries of each type under a trip, updating entries, and deleting them; assert that RLS prevents unauthorized access.
  - [x] 8.2 Implement backend tests for Places-related behavior in the same file or a dedicated one: verify that `/places/:id` returns the expected metadata for a stored `google_place_id` and that quota/edge conditions produce appropriate error responses.
  - [x] 8.3 Implement `backend/tests/test_media_phase4.py` to validate the upload lifecycle: signed URL issuance, correct initial `processing` status, transition to `uploaded` or `failed`, and proper cleanup or retry behavior per `docs/travel-technical-design.md` L513–521.
  - [x] 8.4 Implement `backend/tests/test_lists_phase4.py` to validate:
    - Only trip owners can create lists for a trip.
    - Lists can only include entries from that trip.
    - Slugs are unique and stable.
    - Non-owners cannot access or mutate lists unless explicitly allowed.
  - [ ] 8.5 Add `mobile/src/__tests__/flows/TripAndEntryFlow.test.tsx` that simulates a user navigating from passport → country detail → create trip → add entry (including a Places-backed one) → attach photos, using mocks for the backend and Google Places.
  - [ ] 8.6 Add `mobile/src/__tests__/flows/ListCreateFlow.test.tsx` that simulates:
    - Opening `TripDetailScreen` as the trip owner.
    - Tapping “Share list”, selecting entries, and creating a list.
    - Verifying that a share link URL is displayed.
  - [ ] 8.7 Add targeted mobile tests for `PlacesAutocomplete` (mocking Google responses and error cases) to ensure it correctly displays suggestions and falls back to manual entry on quota/authorization errors.
  - [ ] 8.8 Add mobile unit tests for `useMedia` to confirm it calls `/media/files/signed-url` with the right payload, handles status updates, and exposes state suitable for driving retry and gallery UI behavior.
  - [ ] 8.9 Run backend and mobile test suites, fix any regressions introduced by Phase 4, and document any known limitations or TODOs (e.g., offline-first uploads, multi-trip lists) in comments for future phases.
