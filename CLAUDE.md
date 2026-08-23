# Border Badge - AI Assistant Context

## Project Overview

Border Badge is a travel tracking mobile application that lets users mark countries they've visited, build wishlists of future destinations, log trips with rich entries (places, food, stays, experiences), and share curated lists with friends. The app features a "passport grid" visual interface and a consent-based social layer.

## Tech Stack

| Layer    | Technology                                       |
| -------- | ------------------------------------------------ |
| Mobile   | React Native 0.81.5, Expo 54, TypeScript         |
| State    | Zustand (auth), React Query (server state)       |
| Backend  | FastAPI (Python 3.12+), Uvicorn                  |
| Database | Supabase (PostgreSQL with Row-Level Security)    |
| Storage  | Supabase Storage (media files)                   |
| Auth     | Supabase Email/Password + Social (Apple, Google) |

## Repository Structure

- `mobile/` — React Native (Expo) app. Code under `mobile/src/{components,screens,hooks,services,stores,navigation}/`.
- `backend/` — FastAPI backend. Code under `backend/app/{api,core,schemas,services,db}/`.
- `supabase/migrations/` — SQL migration files.
- `docs/` — Product and feature documentation (PRD, technical design, per-feature deep dives).
- `mobile/plugins/share-extension/` — Swift source for the iOS Share Extension (NOT `mobile/ios/`, which is gitignored).

## Quick Commands

### Mobile

```bash
cd mobile
npm install                    # Install dependencies
npx expo start                 # Start Expo dev server
npm test                       # Run Jest tests
npm run lint                   # Run ESLint
npx prettier --check .         # Check formatting
```

### Backend

```bash
cd backend
poetry install                 # Install dependencies
poetry run uvicorn app.main:app --reload --host 0.0.0.0  # Start server
poetry run pytest              # Run tests
poetry run ruff check .        # Lint code
poetry run ruff format .       # Format code
```

### EAS Updates (Over-the-Air)

Push JavaScript/asset changes to TestFlight users without a new build:

```bash
cd mobile
npm run update:production -- --message "Description of changes"
```

**Never run a bare `eas update --branch production`.** It shipped a broken
production update once, and both of its causes are still live on any dev machine:

1. `eas update` bundles **locally**, so it inlines `EXPO_PUBLIC_*` from whatever
   env the shell has. Without `--environment production` that is your
   `mobile/.env` — a LAN IP. Every data-fetching screen then hangs on its
   skeleton forever, because React Query reads the failed requests as
   still-loading rather than surfacing an error.
2. Metro's transform cache survives an env change, so a cached module keeps the
   previously inlined URL and re-bakes the old LAN IP into a publish you already
   "fixed". `--clear-cache` is not optional.

The `update:production` script runs a preflight (`npm run verify:production`)
that exports the real bundle and greps the compiled Hermes output for
local/private URLs, then publishes with `--environment production --clear-cache`.
Grepping the artifact is the check that matters — the in-app guard in
`src/config/env.ts` only fires when `EXPO_PUBLIC_APP_ENV=production`, and the
same leaked `.env` sets it to `development`, so the guard stays silent on exactly
the publish that breaks.

Note: `eas.json`'s `build.production.env` applies to `eas build` only — it has no
effect on `eas update`.

Four vars (`EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_FB_APP_ID`,
`EXPO_PUBLIC_FB_CLIENT_TOKEN`, `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`) exist on EAS
as **SECRET**, which is readable only on the EAS builder, never during a local
`eas update` bundle. They are silently filled from your local `mobile/.env`
instead. Publishing from a machine without that file throws at import
(`Missing required Supabase environment variables`) and bricks the app on launch.

Users receive updates on next app restart (no active update prompts implemented).

**You can use EAS Update for:** JS/TS code, assets (images, fonts), styles.

**You need a new `eas build` for:** version bumps in `app.config.js`, native package add/remove, `plugins` array changes, native config (`ios.buildNumber`, etc.).

## Environment Setup

See `docs/environment-setup.md` for full env var lists. Local files: `mobile/.env.local`, `backend/.env`.

## Architecture

### Mobile

**State Management:**

- `authStore` (Zustand) - Session, onboarding status, `needsPostSignupFlow` flag
- `onboardingStore` (Zustand + AsyncStorage) - Persisted onboarding progress
- `subscriptionStore` (Zustand) - Subscription status, usage tracking, App Group sync
- React Query - Server state (trips, entries, countries, media). Trips/entries use `staleTime` 5min, `gcTime` 30min. Mutations use scoped invalidation targeting only affected query keys.

**Data Fetching Hooks:**

- `useTrips()`, `useTripsByCountry()`, `useTrip()`, `useUncategorizedTrip()` - Trip queries
- `useEntries()`, `useEntry()`, `useInfiniteEntries()` - Entry queries (20/page)
- `useMoveEntry()`, `useBulkMoveEntries()` - Move entries between trips
- `useCountries()`, `useUserCountries()` - Country data
- `useUploadMedia()`, `usePhotoPermissions()` - Media
- `usePhotoTrips()`, `useMultiClusterUpload()` - Photo import
- `useSubscription()`, `usePremiumGate()` - Subscriptions
- `usePostSignupNavigation()` - Post-signup flow

**API Client (`mobile/src/services/api.ts`):**

- Axios instance with JWT token injection
- Auto sign-out on 401 responses
- 10 second timeout

**Navigation:**

- React Navigation with native-stack and bottom-tabs
- Conditional rendering: OnboardingNavigator (unauthenticated OR `needsPostSignupFlow`) vs MainTabNavigator
- `needsPostSignupFlow` flag keeps authenticated users in OnboardingNavigator until paywall completes
- Type-safe navigation params; double-tap tab returns to home

### Backend

**API Routes (`backend/app/api/`):**

| Route                    | Purpose                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `/countries`             | Country reference data                                        |
| `/user_countries`        | User's visited/wishlist countries                             |
| `/trips`                 | Trip CRUD with tagging                                        |
| `/trips/uncategorized`   | Get/create Saved Places system trip                           |
| `/trips/{id}/entries`    | Entry CRUD                                                    |
| `/entries/{id}/move`     | Move entry to different trip                                  |
| `/entries/bulk-move`     | Bulk move entries to a trip                                   |
| `/media/files`           | Media upload URLs (request → upload to storage → confirm)     |
| `/ingest/social`         | Social media URL processing with LLM-first place extraction   |
| `/ingest/save-to-trip`   | Save social ingest data to a trip                             |
| `/photos/suggest-places` | Photo import place suggestions                                |
| `/lists`                 | Shareable curated lists                                       |
| `/profile`               | User profile                                                  |
| `/public`                | Public trip/list views                                        |
| `/subscriptions/status`  | Get user subscription status and usage                        |
| `/subscriptions/verify`  | Verify subscription with RevenueCat                           |
| `/webhooks/revenuecat`   | RevenueCat webhook endpoint                                   |

**Auth & DB:**

- JWT tokens from Supabase Auth; `CurrentUser` dependency extracts user from token
- RLS policies enforce data access at database level (users see only their own data; trip viewers = owner OR approved trip_tags; public lists = `is_public = true`)
- Custom `SupabaseClient` wrapper using httpx REST API; user-scoped queries via JWT for RLS; service role key for admin operations

## Database Schema (Key Tables)

```
country          - Reference data (227 countries/territories)
user_countries   - User's visited/wishlist status
trip             - User trips (soft delete via deleted_at, is_system flag for system trips)
trip_tags        - Consent workflow for tagged friends (must be approved before appearing)
entry            - Trip entries (place/food/stay/experience)
place            - Google Places enrichment (trip_id denormalized for unique constraint)
media_files      - Uploaded photos
list             - Shareable curated lists
list_entries     - List to entry junction
user_profile     - Extended user data
```

System trips (e.g. "Saved Places") use the `is_system` flag and have nullable `country_id`. The uncategorized trip is lazily created per user via the `get_or_create_uncategorized_trip` RPC.

## Code Style

**Mobile (TypeScript):** ESLint + Prettier (100 char, 2 space). Prefer `useMemo`/`useCallback`. Type-safe nav params. Single default export per component file.

**Backend (Python):** Ruff (88 char). Pydantic v2. Async/await throughout. Type hints required.

## Common Tasks

### Adding an API Endpoint

1. Add/update schema in `backend/app/schemas/`
2. Add route in `backend/app/api/<resource>.py`
3. Register router in `backend/app/api/__init__.py` if new file
4. Add corresponding hook in `mobile/src/hooks/`

### Adding a Screen

1. Create in `mobile/src/screens/<feature>/`
2. Add to navigation in `mobile/src/navigation/RootNavigator.tsx`
3. Update navigation types if needed

### Database Changes

1. Create migration in `supabase/migrations/`
2. Apply via Supabase dashboard
3. Update Pydantic schemas and TypeScript types

## Testing

- **Mobile:** Jest unit tests in `mobile/src/__tests__/`. Detox E2E configured but limited coverage.
- **Backend:** pytest with async support. Tests alongside modules or in `tests/`.

**When I report a bug, don't start by trying to fix it.** Start by writing a test that reproduces the bug. Then have subagents try to fix the bug and prove it with a passing test.

## Important Files

| File                                      | Purpose                       |
| ----------------------------------------- | ----------------------------- |
| `mobile/src/services/api.ts`              | Axios API client setup        |
| `mobile/src/services/supabase.ts`         | Supabase client init          |
| `mobile/src/stores/authStore.ts`          | Auth state management         |
| `mobile/src/navigation/RootNavigator.tsx` | App navigation                |
| `backend/app/main.py`                     | FastAPI app setup             |
| `backend/app/core/config.py`              | Environment config            |
| `backend/app/core/security.py`            | JWT validation                |
| `backend/app/db/session.py`               | Supabase client               |
| `STYLEGUIDE.md`                           | Design system reference       |
| `docs/travel-prd.md`                      | Product requirements          |
| `docs/travel-technical-design.md`         | Technical design              |
| `docs/photo-import.md`                    | Photo import + vision pipeline; "Photo Quality Signal Layer" (intent tags, ranking, signal consumers); "Library job runtime and continuation" (job runtime, drivers, iOS 26 continued-processing lease) |
| `docs/authentication.md`                  | Auth screens, flow, hooks     |
| `docs/environment-setup.md`               | Full env var reference        |
| `docs/SUBSCRIPTION.md`                    | Subscription system setup     |
| `docs/ONBOARDING_PAYWALL_FIX.md`          | Onboarding reorder design doc |
| `docs/ios-share-extension.md`             | iOS Share Extension build doc |
| `docs/place-extraction-algorithm.md`      | LLM extraction algorithm      |
| `docs/analytics.md`                       | Analytics tool split + events |

## Share Extension Architecture (IMPORTANT)

The share capture flow has **TWO implementations** that must be kept in sync:

| Platform              | Location                          | Language   |
| --------------------- | --------------------------------- | ---------- |
| React Native (in-app) | `mobile/src/screens/share/`       | TypeScript |
| iOS Share Extension   | `mobile/plugins/share-extension/` | Swift      |

**CRITICAL:** Swift source is in `mobile/plugins/share-extension/`, NOT in `mobile/ios/ShareExtension/`. The `mobile/ios/` directory is gitignored and regenerated during builds — any changes there will be lost.

**When modifying share capture behavior:**

1. Update React Native code in `mobile/src/screens/share/`
2. Update Swift code in `mobile/plugins/share-extension/`
3. Ensure both implementations have the same behavior
4. Run `npx expo prebuild --clean` to regenerate `mobile/ios/`
5. Rebuild the main app so the updated extension bundle is embedded

**Key parallel files:**

| React Native                   | Swift (in `mobile/plugins/share-extension/`)                              |
| ------------------------------ | ------------------------------------------------------------------------- |
| `useShareCapture.ts`           | `ViewModels/ShareCaptureViewModel.swift`                                  |
| `TripSelector.tsx`             | `Views/TripSelectorView.swift` + `ViewModels/TripSelectorViewModel.swift` |
| `useTrips.ts` (Trip interface) | `Models/Trip.swift`                                                       |
| `api.ts`                       | `Services/APIClient.swift`                                                |

## Authentication

Email/password auth via Supabase. **Magic links are NOT implemented — do not add them.** See `docs/authentication.md` for screens, flow, hooks, and post-signup flow ordering.

## Photo Import & Place Matching

See `docs/photo-import.md` for the mobile + backend pipeline, vision classification, place-matcher mixin layout, multi-cluster upload, and ranking weight tuning.

## LLM Place Extraction (Social Ingest)

See `docs/place-extraction-algorithm.md`. Set `LLM_PLACE_EXTRACTION_ENABLED=true` (and `OPENROUTER_API_KEY`) to opt in. The pipeline runs LLM and regex extraction in parallel and resolves Google Places only once for whichever method succeeds.

## Subscriptions

See `docs/SUBSCRIPTION.md`. Free-tier limits: 5 share-extension uses/month, 1 photo-import trip lifetime, 10 entries/trip. Use the `usePremiumGate` hook to gate features.

## Notes for AI Assistants

1. **NO EMOJIS OR ICONS:** Never add emojis or icons to the UI without explicit permission. This includes emoji characters, icon libraries (Ionicons, etc.), or any visual symbols. All iconography must be custom-designed and approved by the user. Standard system icons (like arrow-forward on buttons) that already exist in the codebase are acceptable.
2. **iOS Simulator Networking:** Use machine's IP address, not `localhost`.
3. **Bug-fix workflow:** Write a failing test that reproduces the bug *before* attempting a fix.
4. **Soft Deletes:** Trips and entries use `deleted_at` timestamp.
5. **Magic Links:** Forbidden. See `docs/authentication.md`.
6. **Version Management:** App uses `app.config.js` (dynamic config), so `autoIncrement` in `eas.json` is NOT supported. Manually update `version` in `app.config.js` before each App Store submission.
7. **Place Matcher Mixin Architecture:** PlaceMatcher uses a mixin pattern (`SearchMixin`, `RankingMixin`, `ClusterProcessingMixin`). When modifying matching behavior, identify the correct mixin file rather than editing `matcher.py` directly. See `docs/photo-import.md`.
8. **Onboarding Flow Order:** Account creation happens BEFORE the paywall. The `needsPostSignupFlow` flag in authStore keeps users in OnboardingNavigator after authentication until the paywall is complete. See `docs/ONBOARDING_PAYWALL_FIX.md`.
9. **Navigation freezing:** `App.tsx` calls `enableFreeze()` and stacks set `freezeOnBlur`. Do NOT add `detachPreviousScreen` to `PassportNavigator` or `RootNavigator` — on these 2-deep stacks it collapses `react-native-screen-transitions`' `activeScreensLimit` from 2→1 and freezes the screen that must co-animate during the pop, killing the pop animation and flashing on return. A tripwire test (`mainStackDetach.test.tsx`) guards this; `OnboardingNavigator` keeps its detach (forward-mostly, no symptom).
10. **React Compiler is enabled** (`experiments.reactCompiler`). Never write to a ref during render (`ref.current = fn` in the render body) — the compiler may memoize around it and hand back stale closures. Use `useStableCallback` (ref synced in an effect) for stable-identity callbacks; see `mobile/src/hooks/useStableCallback.ts`.
11. **Production console stripping:** `babel.config.js` strips `console.*` (except `error`/`warn`) from production bundles only. Use `console.error`/`console.warn` for logs that must survive in production.

## Pre-Commit Checklist (REQUIRED)

**Before committing any changes, ALWAYS run these checks:**

### Mobile

```bash
cd mobile
npm run lint                   # Must pass with 0 errors
npm run format:check           # Must pass (or run `npx prettier --write .` to fix)
npm test                       # Must pass all tests
```

### Backend

```bash
cd backend
poetry run ruff check .        # Must pass with 0 errors
poetry run ruff format --check . # Must pass
poetry run pytest              # Must pass all tests
```

Always run ruff through `poetry run` (currently pinned to `^0.15.0` in
`backend/pyproject.toml`, which is what CI installs). A bare `ruff` picks up the
Homebrew binary, which drifts to a different version and reports a different set
of lint rules and formatting.

### iOS Share Extension (if modifying Swift code)

```bash
# Install SwiftLint if not already installed: brew install swiftlint
swiftlint lint --strict mobile/plugins/share-extension/
```

### CSS (if modifying public page styles)

```bash
cd backend
node scripts/build-css.js      # Rebuild styles.css and styles.min.css from src/
git diff app/static/css/       # Verify generated files are committed
```

CSS source files live in `backend/app/static/css/src/`. After editing, run the build script to regenerate `styles.css` and `styles.min.css`, and commit the generated files.

**Common lint issues to avoid:**

- Unused imports (remove them)
- `require()` style imports in TypeScript (use ES6 `import` instead)
- Missing type annotations
- Unused variables (prefix with `_` if intentionally unused)
