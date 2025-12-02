## Relevant Files

- `infra/supabase/migrations/*.sql` - Existing Supabase migrations; may need additional indices and minor schema tweaks for performance and cleanup (`docs/travel-technical-design.md` L176–192, L595–599).
- `backend/app/schemas/common.py` - Shared error response model; must be used consistently across all endpoints (`docs/travel-technical-design.md` L486–495).
- `backend/app/api/*.py` - All FastAPI routers (auth, countries, trips, entries, media); primary targets for edge-case hardening and consistent error handling. **[DEFERRED: friends, notifications, subscriptions routers - requires Phase 5 social layer and paywall]**
- `backend/app/core/config.py` - Centralized configuration (env flags for logging, performance tuning, feature toggles).
- `backend/app/db/session.py` - Database session/client utilities; relevant for connection pooling and query tuning.
- `backend/app/core/notifications.py` - Notification helper; needs robust error handling and logging for delivery failures. **[DEFERRED: requires Phase 5 social layer]**
- `backend/tests/` - All backend test modules from previous phases (auth, countries, trips/tags, entries/media) to be extended for edge cases and regression coverage. **[DEFERRED: friends, notifications, subscriptions, analytics tests - requires Phase 5 social layer and paywall]**
- `mobile/src/screens/**` - All major mobile screens (onboarding, passport, country detail, trip detail, entry list/form) where improved error/empty/loading states and performance tweaks will be applied. **[DEFERRED: friends, notification center, paywall screens - requires Phase 5 social layer and paywall]**
- `mobile/src/components/layout/Screen.tsx` - Shared screen wrapper; good place to centralize generic loading/error/empty patterns.
- `mobile/src/components/ui/*` - UI primitives (buttons, inputs, text, snackbars/toasts/dialogs) used for confirmations and undo flows.
- `mobile/src/components/entries/PlacesAutocomplete.tsx` - Component that must implement the Places quota fallback behavior (`docs/travel-prd.md` L289–291; `docs/travel-technical-design.md` L423–435, L515–521).
- `mobile/src/components/media/EntryMediaGallery.tsx` - Component used for image display and delete/undo interactions (`docs/travel-prd.md` L293; US-010/016).
- `mobile/src/api/hooks/**` - All React Query hooks (`useCountries`, `useUserCountries`, `useTrips`, `useTripEntries`, `useMedia`, etc.) where retry/backoff, caching, and error handling should be tuned. **[DEFERRED: useFriends, useNotifications, useSubscription - requires Phase 5 social layer and paywall]**
- `mobile/src/__tests__/` - Existing mobile unit and integration tests; will be expanded and complemented with E2E tests.
- `e2e/**` or `mobile/e2e/**` - Detox (or equivalent) configuration and tests for end-to-end flows (if not present, to be created in this phase).
- `.github/workflows/ci.yml` (or equivalent CI config) - CI pipeline that runs lint, tests, and builds.
- `fastlane/Fastfile` / `fastlane/Appfile` or `eas.json` / `scripts/release-ios.sh` - iOS release automation scripts for TestFlight builds.
- `scripts/release-android.sh` or Android CI config - Optional scripts for Android internal builds.
- `CHANGELOG.md` and `README.md` - Documentation for release notes, versioning, and how to run tests/builds.

### Notes

- Phase 7 focuses on **hardening, performance, testing, and release readiness** as described in `docs/travel-mvp-blueprint.md` §11 (L532–577).
- Edge-case handling is driven by PRD advanced features & edge cases (`docs/travel-prd.md` L287–293) and user stories **US-016–018/020** (`docs/travel-prd.md` L499–521, L531–537), as well as technical error and file-handling guidance (`docs/travel-technical-design.md` L486–495, L513–525).
- Performance work must meet the technical metrics in PRD (`docs/travel-prd.md` L317–323, L369–375) and leverage scalability notes from the technical design (`docs/travel-technical-design.md` L595–601, L613–619).
- Testing strategy should consolidate and extend tests from all previous phases (backend + mobile + analytics) and introduce a small but meaningful E2E suite for critical flows.
- Release pipeline work formalizes TestFlight (and optional Android) delivery and ensures CI is a reliable gate for quality.

## Tasks

- [ ] 1.0 Harden edge cases and error handling across backend and mobile

  - [ ] 1.1 Compile an edge-case checklist from PRD and technical design:
    - Places quota fallback and manual entry (PRD L289–291; US-018 L515–521).
    - Duplicate trip names behavior (append “(2)”) (PRD L291).
    - Delete with confirmation + undo snack bar (PRD L293; US-016 L499–505).
    - Media upload failures and orphaned files (PRD L323, `docs/travel-technical-design.md` L513–525).
  - [ ] 1.2 Ensure all backend endpoints use the shared error format from `backend/app/schemas/common.py` (`docs/travel-technical-design.md` L486–495), updating routes where ad-hoc error shapes still exist.
  - [ ] 1.3 In `PlacesAutocomplete`, ensure Places API quota and auth errors (HTTP 429/403) trigger the manual entry fallback UI automatically, with clear messaging and no infinite retry loops (PRD L289–291; `docs/travel-technical-design.md` L423–435, L515–521).
  - [ ] 1.4 Implement duplicate trip-name handling in the trip creation path (likely in `backend/app/api/trips.py`): on conflict, append “(2)”, “(3)”, etc., while keeping behavior predictable and covered by tests.
  - [ ] 1.5 Implement delete confirmation and undo:
    - On mobile, use a confirmation dialog before destructive actions for entries/photos.
    - After delete, show a snackbar/toast with an “Undo” action that reverts the deletion within a short window (US-016).
    - On the backend, consider soft-delete flags or delayed hard-deletes consistent with product expectations.
  - [ ] 1.6 Improve `useMedia` and media endpoints to handle failed uploads:
    - Properly mark `media_files.status` as `failed` when uploads time out or error (`docs/travel-technical-design.md` L513–521).
    - Surface actionable error messages and retry options in the UI without breaking the main entry.
  - [ ] 1.7 Review and standardize error/empty/loading states across major screens using shared components (e.g., `Screen` + shared `ErrorState`, `EmptyState`, `Loading` patterns) so behavior is consistent and understandable for users.

- [ ] 2.0 Optimize performance and scalability for critical flows

  - [ ] 2.1 Identify and document the most performance-critical flows (passport grid, trip list/country detail, entry list, shared lists/public web pages), mapping them to PRD technical metrics (`docs/travel-prd.md` L317–323, L369–375).
  - [ ] 2.2 At the database level:
    - Review query patterns used by critical endpoints (`/user_countries`, `/trips`, `/trips/:trip_id/entries`, `/public/*`).
    - Add or refine indices per `docs/travel-technical-design.md` L176–192 and L595–599 (e.g., composite indices on `(user_id, country_id)`, `(trip_id, date)`, `(owner_id, trip_id, status)`).
  - [ ] 2.3 On the backend:
    - Profile slow endpoints using logging or basic profiling tools.
    - Optimize N+1 patterns by using batched queries or efficient joins where necessary.
    - Ensure pagination or sensible limits for list endpoints (trips, entries, media). **[DEFERRED: notifications pagination - requires Phase 5 social layer]**
  - [ ] 2.4 On the mobile side:
    - Tune React Query caching (e.g., `staleTime`, `cacheTime`) for frequently-used queries (countries, user_countries, trips, entries).
    - Avoid unnecessary re-renders by memoizing heavy components and using flat lists with proper `keyExtractor`s.
    - Ensure image loading in `EntryMediaGallery` uses thumbnails and defers full-resolution loads to tap actions.
  - [ ] 2.5 Implement lightweight performance instrumentation:
    - Log timing for key operations (e.g., from app launch to passport visible, from trip tap to entries loaded) either via analytics events or internal logs.
    - Compare against P75 < 2.5 s target (`docs/travel-prd.md` L319–321) and adjust where needed.
  - [ ] 2.6 (Optional) Run small-scale load tests or use synthetic traffic against critical backend endpoints to validate that performance holds under expected early-stage traffic patterns.

- [ ] 3.0 Expand and formalize the test strategy (backend, mobile, E2E)

  - [ ] 3.1 Audit existing tests against PRD user stories (`docs/travel-prd.md` L377–545) and blueprint coverage mappings (§13.1), creating a matrix that shows which stories are fully, partially, or not at all covered.
  - [ ] 3.2 For backend tests:
    - Ensure each endpoint group (auth, countries, trips, entries, places, media, public web) has corresponding unit/integration tests. **[DEFERRED: friends, notifications, subscriptions tests - requires Phase 5 social layer and paywall]**
    - Add missing tests for edge-case behaviors defined in Phase 7 (duplicate names, undo deletes, Places fallback, media failures).
  - [ ] 3.3 For mobile unit/integration tests:
    - Add or improve tests for core business logic (e.g., `useTripEntries`, `useMedia`). **[DEFERRED: useFriends, useNotifications, useSubscription tests - requires Phase 5 social layer and paywall]**
    - Verify that screens respond correctly to errors, empty states, and slow networks, not only happy paths.
  - [ ] 3.4 Introduce or extend an E2E test suite (e.g., Detox) with a small set of high-value flows:
    - Onboarding: guest → signup → passport view.
    - Trip creation + entry logging with images.
    - **[DEFERRED]** Tagging & approval flow with two test users. *(requires Phase 5 social layer)*
    - **[DEFERRED]** Paywall display and navigation around it. *(requires paywall implementation)*
  - [ ] 3.5 Document the testing strategy in `README.md` or a dedicated `docs/testing-strategy.md`: how to run unit, integration, and E2E tests; expected runtime; and which tests must pass before a release.

- [ ] 4.0 Implement and finalize the release pipeline for iOS (and optional Android)

  - [ ] 4.1 Configure CI workflows (e.g., `.github/workflows/ci.yml`) to:
    - Run lint and tests (backend + mobile) on every PR/merge to main.
    - Optionally, run E2E tests on a nightly or pre-release basis.
  - [ ] 4.2 Implement or refine iOS release automation:
    - Using Fastlane or EAS, create scripts (e.g., `fastlane ios beta` or `eas build --profile preview`) that build the iOS app and upload to TestFlight.
    - Ensure environment variables (API keys, Supabase URLs, analytics keys) are correctly provided for staging and production builds. **[DEFERRED: RevenueCat keys - requires paywall implementation]**
  - [ ] 4.3 (Optional) Implement Android internal release scripts (e.g., `fastlane android beta` or `eas build --platform android`) to produce internal testing builds, even if the MVP is iOS-first.
  - [ ] 4.4 Define a versioning and changelog process:
    - Adopt semantic or date-based versioning.
    - Maintain a `CHANGELOG.md` capturing user-visible changes and key technical notes per release.
  - [ ] 4.5 Add simple smoke checks to the release pipeline (e.g., run a subset of E2E tests or automated UI checks on a freshly built app) to catch obvious regressions before distributing builds.

- [ ] 5.0 Run a structured QA/bug-bash cycle and capture a launch-readiness checklist

  - [ ] 5.1 Create a QA checklist mapped to PRD user stories and key flows (onboarding, passport, trip creation, entries, shared lists), and share it with testers. **[DEFERRED: tagging/approvals, notifications, paywall - requires Phase 5 social layer and paywall]**
  - [ ] 5.2 Set up a simple issue-tracking convention (labels for severity, area, regression vs new) and bug template so findings from QA/bug-bash sessions are consistent and actionable.
  - [ ] 5.3 Run at least one internal bug-bash session using a near-production build (TestFlight/staging), capturing issues across devices and network conditions.
  - [ ] 5.4 Prioritize and fix critical and high-severity issues uncovered during QA, adding regression tests where appropriate to avoid reintroducing bugs.
  - [ ] 5.5 Compile a **launch-readiness checklist** summarizing:
    - Passed tests (unit/integration/E2E).
    - Performance metrics vs targets.
    - Open known issues and rationale for deferring them.
    - Status of analytics wiring. **[DEFERRED: paywall and notification status - requires Phase 5 social layer and paywall]**
  - [ ] 5.6 Use the checklist as a gate before initiating the final TestFlight/production release, updating it for subsequent releases as the product evolves.


