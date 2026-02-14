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

```
border-badge/
├── mobile/                 # React Native (Expo) mobile app
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   │   ├── ui/         # Base components (Button, Input, Chip, etc.)
│   │   │   ├── entries/    # Entry-specific components
│   │   │   ├── media/      # Media display components
│   │   │   └── places/     # Google Places components
│   │   ├── screens/        # App screens organized by feature
│   │   │   ├── auth/       # Authentication screens
│   │   │   ├── onboarding/ # Onboarding flow (12 screens)
│   │   │   ├── country/    # Country detail screens
│   │   │   ├── entries/    # Entry management
│   │   │   ├── lists/      # Shareable lists
│   │   │   ├── photos/     # Photo import & vision workflows
│   │   │   └── trips/      # Trip management
│   │   ├── navigation/     # React Navigation setup
│   │   ├── hooks/          # Custom React hooks (data fetching)
│   │   ├── services/       # API client, Supabase, media upload, photoImport/
│   │   ├── stores/         # Zustand stores (authStore, onboardingStore)
│   │   ├── constants/      # Colors, typography, regions
│   │   └── config/         # Environment configuration
│   └── package.json
├── backend/                # FastAPI Python backend
│   ├── app/
│   │   ├── api/            # API route modules
│   │   ├── core/           # Config, security, validators
│   │   ├── schemas/        # Pydantic models
│   │   ├── services/       # Business logic services
│   │   │   ├── place_matcher/    # Photo cluster → Google Places matching
│   │   │   ├── place_extractor/  # Social media place extraction
│   │   │   └── photo_vision/     # Vision classification (Gemini Flash Lite)
│   │   ├── db/             # Supabase client wrapper
│   │   └── main.py         # FastAPI app entry point
│   └── pyproject.toml      # Poetry dependencies
├── supabase/               # Database migrations and seeds
│   └── migrations/         # SQL migration files (57 migrations)
├── docs/                   # Product documentation
│   ├── travel-prd.md       # Product Requirements Document
│   ├── travel-technical-design.md  # Technical design
│   ├── travel-mvp-blueprint.md     # Implementation blueprint
│   ├── SUBSCRIPTION.md     # Subscription system setup & testing
│   ├── ONBOARDING_PAYWALL_FIX.md   # Onboarding reorder design doc
│   └── place-extraction-algorithm.md  # LLM extraction algorithm
├── instructions/           # Development task files
│   └── tasks/              # Phase-specific task breakdowns
└── STYLEGUIDE.md           # Design system (colors, typography)
```

## Quick Commands

### Mobile Development

```bash
cd mobile
npm install                    # Install dependencies
npx expo start                 # Start Expo dev server
npm test                       # Run Jest tests
npm run lint                   # Run ESLint
npx prettier --check .         # Check formatting
```

### Backend Development

```bash
cd backend
poetry install                 # Install dependencies
poetry run uvicorn app.main:app --reload --host 0.0.0.0  # Start server
poetry run pytest              # Run tests
poetry run ruff check .        # Lint code
poetry run ruff format .       # Format code
```

When I report a bug, don't start by trying to fix it. Instead, start by writing a test that reproduces the bug. Then, have subagents try to fix the bug and prove it with a passing test.

### Database

```bash
cd supabase
# Migrations are managed via Supabase dashboard or CLI
# See supabase/migrations/ for schema
```

### EAS Updates (Over-the-Air)

Push JavaScript/asset changes to TestFlight users without a new build:

```bash
cd mobile
eas update --branch production --message "Description of changes"
```

Users receive updates on next app restart (no active update prompts implemented).

**When you can use EAS Update:**

- JavaScript/TypeScript code changes
- Asset changes (images, fonts)
- Style changes

**When you need a new build (`eas build`):**

- Bump `version` in `app.config.js` (runtime version is tied to `appVersion`)
- Add/remove native packages
- Modify `plugins` array
- Change native config (`ios.buildNumber`, etc.)

## Environment Setup

### Mobile (`mobile/.env.local`)

```
EXPO_PUBLIC_API_URL=http://<your-ip>:8000  # iOS simulator needs IP, not localhost
EXPO_PUBLIC_SUPABASE_URL=<supabase-url>
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
EXPO_PUBLIC_APP_ENV=development
EXPO_PUBLIC_GOOGLE_PLACES_API_KEY=<google-places-key>
EXPO_PUBLIC_WEB_BASE_URL=http://<your-ip>:8000  # Base URL for public web pages (Terms, Privacy)
EXPO_PUBLIC_POSTHOG_API_KEY=<posthog-api-key>  # Optional: for production analytics
EXPO_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com  # Optional: defaults to US region
```

### Backend (`backend/.env`)

```
ENV=development
DEBUG=true
SUPABASE_URL=<supabase-url>
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_JWT_SECRET=<jwt-secret>
GOOGLE_ANALYTICS_ID=<ga4-measurement-id>  # Optional: GA4 ID for public pages (e.g., G-XXXXXXXXXX)
AFFILIATE_SIGNING_SECRET=<secret-key>  # Required in production: HMAC signing for affiliate redirect URLs
SKIMLINKS_API_KEY=<skimlinks-api-key>  # Optional: for affiliate link wrapping via Skimlinks
SKIMLINKS_PUBLISHER_ID=<publisher-id>  # Optional: your Skimlinks publisher ID
RESEND_API_KEY=<resend-api-key>  # Optional: for welcome email drip campaign (get key from resend.com)
WELCOME_EMAIL_FROM=Emerson <hello@atlasi.com>  # From address for welcome emails
POSTHOG_API_KEY=<posthog-api-key>  # Optional: same project key as mobile app, for LLM accuracy tracking
POSTHOG_HOST=https://us.i.posthog.com  # Optional: defaults to US region
PLACES_API_TIMEOUT_SECONDS=5.0  # Optional: timeout for Google Places API requests (default 5s)
PLACES_CLUSTER_TIMEOUT_SECONDS=15.0  # Optional: timeout for processing a single cluster (default 15s)
GOOGLE_PLACES_API_KEY=<google-places-key>  # Required: Google Places API key for place matching
PLACES_RANK_DISTANCE_WEIGHT=1.0  # Optional: ranking weight for distance penalty (0.0-5.0)
PLACES_RANK_REVIEW_WEIGHT=1.0  # Optional: ranking weight for review-count bonus (0.0-5.0)
PLACES_RANK_RATING_WEIGHT=1.0  # Optional: ranking weight for Bayesian rating bonus (0.0-5.0)
PLACES_RANK_FAME_WEIGHT=1.0  # Optional: ranking weight for fame bonus (0.0-5.0)
PLACES_RANK_DWELL_WEIGHT=1.0  # Optional: ranking weight for dwell/time-hint bonus (0.0-5.0)
PLACES_RANK_VISION_WEIGHT=1.0  # Optional: ranking weight for vision category bonus (0.0-5.0)
MULTIMODAL_MODEL=google/gemini-2.5-flash-lite  # Optional: model for photo vision classification
PLACE_EXTRACTION_MIN_CONFIDENCE=0.5  # Optional: minimum confidence for place extraction (0.0-1.0)
INSTAGRAM_OEMBED_TOKEN=<meta-app-token>  # Optional: Meta app token for Instagram oEmbed API
TIKTOK_PROXY_URL=<proxy-url>  # Optional: SOCKS5/HTTP proxy for TikTok requests
TURNSTILE_SITE_KEY=<cloudflare-key>  # Optional: Cloudflare Turnstile site key for contact form
TURNSTILE_SECRET_KEY=<cloudflare-secret>  # Optional: Cloudflare Turnstile secret key
CONTACT_EMAIL_TO=hello@atlasi.app  # Optional: recipient for contact form emails
```

## Key Architecture Patterns

### Mobile

**State Management:**

- `authStore` (Zustand) - Session, onboarding status, loading states, `needsPostSignupFlow` flag
- `onboardingStore` (Zustand + AsyncStorage) - Persisted onboarding progress
- `subscriptionStore` (Zustand) - Subscription status, usage tracking, App Group sync
- React Query - Server state for trips, entries, countries, media

**Data Fetching Hooks:**

- `useTrips()`, `useTripsByCountry()`, `useTrip()` - Trip queries (5min staleTime, 30min gcTime)
- `useUncategorizedTrip()` - Get/create the Saved Places system trip
- `useEntries()`, `useEntry()` - Entry queries (5min staleTime, 30min gcTime)
- `useInfiniteEntries()` - Paginated entry fetching with infinite scroll (20 entries per page)
- `useMoveEntry()`, `useBulkMoveEntries()` - Move entries between trips (scoped cache invalidation)
- `useCountries()`, `useUserCountries()` - Country data
- `useUploadMedia()` - Media upload with progress
- `usePhotoPermissions()` - Photo library permission handling
- `usePhotoTrips()` - Access photo-discovered trips from SQLite cache with search/filter
- `useMultiClusterUpload()` - Concurrent photo uploads from multiple location clusters
- `useSubscription()` - Subscription purchase/restore flows
- `usePremiumGate()` - Feature gating based on subscription status
- `usePostSignupNavigation()` - Navigate to post-signup flow after account creation

**API Client (`mobile/src/services/api.ts`):**

- Axios instance with JWT token injection
- Auto sign-out on 401 responses
- 10 second timeout

**Navigation:**

- React Navigation with native-stack and bottom-tabs
- Conditional rendering: OnboardingNavigator (unauthenticated OR `needsPostSignupFlow`) vs MainTabNavigator
- `needsPostSignupFlow` flag keeps authenticated users in OnboardingNavigator until paywall completes
- Type-safe navigation params
- Tab press preserves per-tab stack; double-tap returns to home (prevents unnecessary remounts)

### Backend

**API Routes (`backend/app/api/`):**
| Route | Purpose |
|-------|---------|
| `/countries` | Country reference data |
| `/user_countries` | User's visited/wishlist countries |
| `/trips` | Trip CRUD with tagging |
| `/trips/uncategorized` | Get/create Saved Places system trip |
| `/trips/{id}/entries` | Entry CRUD |
| `/entries/{id}/move` | Move entry to different trip |
| `/entries/bulk-move` | Bulk move entries to a trip |
| `/media/files` | Media upload URLs, status |
| `/ingest/social` | Social media URL processing with LLM-first place extraction |
| `/ingest/save-to-trip` | Save social ingest data to a trip |
| `/photos/suggest-places` | Photo import place suggestions |
| `/lists` | Shareable curated lists |
| `/profile` | User profile |
| `/public` | Public trip/list views |
| `/subscriptions/status` | Get user subscription status and usage |
| `/subscriptions/verify` | Verify subscription with RevenueCat |
| `/webhooks/revenuecat` | RevenueCat webhook endpoint |

**Authentication:**

- JWT tokens from Supabase Auth
- `CurrentUser` dependency extracts user from token
- RLS policies enforce data access at database level

**Database Client:**

- Custom `SupabaseClient` wrapper using httpx REST API
- User-scoped queries via JWT for RLS
- Service role key for admin operations

## Database Schema (Key Tables)

```
country          - Reference data (227 countries/territories)
user_countries   - User's visited/wishlist status
trip             - User trips (soft delete supported, is_system flag for system trips)
trip_tags        - Consent workflow for tagged friends
entry            - Trip entries (place/food/stay/experience)
place            - Google Places enrichment (trip_id denormalized for unique constraint)
media_files      - Uploaded photos
list             - Shareable curated lists
list_entries     - List to entry junction
user_profile     - Extended user data
```

**Mobile SQLite Tables (photo import cache):**

```
cached_photos          - GPS photo metadata cache (incremental import)
cached_trip_segments   - Pre-computed trip segment data for memory-optimized display
processed_clusters     - Tracks confirmed/hidden cluster suggestions
cached_suggestions     - Place suggestion cache with TTL
```

**System Trips:**

The `trip` table supports system trips (like "Saved Places") via the `is_system` boolean flag. System trips have nullable `country_id` and are excluded from normal trip listings by default. The uncategorized trip is lazily created per user via the `get_or_create_uncategorized_trip` RPC function.

**RLS Policies:**

- Users see only their own data
- Trip viewers: owner OR approved trip_tags
- Public lists: `is_public = true`

## Code Style

### Mobile (TypeScript)

- ESLint + Prettier (100 char line width, 2 space indent)
- Prefer `useMemo`/`useCallback` for performance
- Type-safe navigation params
- Component files export single default component

### Backend (Python)

- Ruff for linting and formatting (88 char line width)
- Pydantic v2 for validation
- Async/await throughout
- Type hints required

## Common Tasks

### Adding a New API Endpoint

1. Create/update schema in `backend/app/schemas/`
2. Add route in `backend/app/api/<resource>.py`
3. Register router in `backend/app/api/__init__.py` if new file
4. Add corresponding hook in `mobile/src/hooks/`

### Adding a New Screen

1. Create screen in `mobile/src/screens/<feature>/`
2. Add to navigation in `mobile/src/navigation/RootNavigator.tsx`
3. Update navigation types if needed

### Database Changes

1. Create migration in `supabase/migrations/`
2. Apply via Supabase dashboard
3. Update relevant Pydantic schemas
4. Update TypeScript types if needed

### Tuning Place Matcher Ranking Weights

Use the offline evaluator to tune ranking weights against a labeled dataset:

```bash
cd backend
poetry run python scripts/eval_place_matcher.py \
  --dataset docs/place_matcher_eval_dataset.sample.json \
  --trials 200 --optimize-for top1
```

The script runs random search over the 6 `PLACES_RANK_*_WEIGHT` env vars and prints the best configs with top-1 accuracy, MRR, and recommended env var values. Use `--no-search` to evaluate the current config without tuning. Use `--vision-mode none|single|aggregate` to test with/without vision data.

## Testing

### Mobile

- Jest for unit tests
- Detox for E2E tests (configured but limited coverage)
- Test files in `mobile/src/__tests__/`

### Backend

- pytest with async support
- Test files alongside modules or in `tests/`

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
| `docs/ios-share-extension.md`             | iOS Share Extension build doc |
| `docs/SUBSCRIPTION.md`                    | Subscription system setup     |
| `docs/ONBOARDING_PAYWALL_FIX.md`         | Onboarding reorder design doc |
| `backend/app/services/photo_vision/classifier.py` | Photo vision classification |
| `backend/app/services/place_matcher/_matcher_ranking.py` | Vision-integrated place ranking |
| `backend/app/services/place_matcher/_matcher_search.py` | Density-adaptive search logic |
| `mobile/src/services/photoImport/visionPhoto.ts` | Vision photo preparation |
| `mobile/src/services/revenueCat.ts`       | RevenueCat SDK + promise coordination |

## Share Extension Architecture (IMPORTANT)

The share capture flow has **TWO implementations** that must be kept in sync:

| Platform              | Location                          | Language   |
| --------------------- | --------------------------------- | ---------- |
| React Native (in-app) | `mobile/src/screens/share/`       | TypeScript |
| iOS Share Extension   | `mobile/plugins/share-extension/` | Swift      |

**CRITICAL:** The iOS Share Extension source files are in `mobile/plugins/share-extension/`, NOT in `mobile/ios/ShareExtension/`. The `mobile/ios/` directory is gitignored and regenerated during builds - any changes there will be lost!

**When modifying share capture behavior:**

1. Update React Native code in `mobile/src/screens/share/`
2. Update Swift code in `mobile/plugins/share-extension/`
3. Ensure both implementations have the same behavior
4. Run `npx expo prebuild --clean` to regenerate `mobile/ios/` with your changes
5. Rebuild the main app so the updated extension bundle is embedded

**Key parallel files:**

| React Native                   | Swift (in `mobile/plugins/share-extension/`)                              |
| ------------------------------ | ------------------------------------------------------------------------- |
| `useShareCapture.ts`           | `ViewModels/ShareCaptureViewModel.swift`                                  |
| `TripSelector.tsx`             | `Views/TripSelectorView.swift` + `ViewModels/TripSelectorViewModel.swift` |
| `useTrips.ts` (Trip interface) | `Models/Trip.swift`                                                       |
| `api.ts`                       | `Services/APIClient.swift`                                                |

## Authentication System (IMPORTANT)

The app uses **email/password authentication** for all users. Magic links are NOT supported.

### Authentication Screens

| Screen                    | File                                           | Purpose                                                                                                                                                                               |
| ------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AccountCreationScreen** | `screens/onboarding/AccountCreationScreen.tsx` | **New user sign-up** during onboarding. Collects email + password (password appears after valid email). Uses `useSignUpWithPassword` hook. Also supports Apple/Google social sign-in. |
| **AuthScreen**            | `screens/auth/AuthScreen.tsx`                  | **Returning user sign-in**. Collects email + password (password appears after valid email). Uses `useSignInWithPassword` hook. Also supports Apple/Google social sign-in.             |

### Authentication Flow

1. **New Users (Onboarding)**:

   - Complete onboarding steps (WelcomeCarousel through ProgressSummary) → NameEntry → `AccountCreationScreen`
   - Enter email → password field appears when email is valid
   - Submit → `useSignUpWithPassword` creates account, sets `needsPostSignupFlow` flag
   - Navigate to EmotionalHook → FunctionalHook → Paywall (post-signup flow)
   - PaywallScreen calls `finishOnboarding()` to complete the flow
   - See `docs/ONBOARDING_PAYWALL_FIX.md` for full design rationale

2. **Returning Users**:
   - Launch app → `AuthScreen`
   - Enter email → password field appears when email is valid
   - Submit → `useSignInWithPassword` authenticates

### Auth Hooks (`mobile/src/hooks/useAuth.ts`)

| Hook                    | Purpose                                           |
| ----------------------- | ------------------------------------------------- |
| `useSignUpWithPassword` | Create new account (email, password, displayName) |
| `useSignInWithPassword` | Sign in existing account (email, password)        |
| `useSignOut`            | Sign out and clear session                        |

### Key Implementation Details

- Password field only appears after entering a valid email (progressive disclosure)
- Minimum password length: 6 characters (Supabase default)
- Email validation uses RFC 5322 compliant regex
- Social auth (Apple, Google) available as alternatives
- **Magic links are NOT implemented** - do not add magic link functionality

## Launch Simplification

Most features have been re-enabled since initial launch. The remaining hidden features are:

### Still Hidden Features

| Feature                  | Status | Location                  | How to Re-enable                                      |
| ------------------------ | ------ | ------------------------- | ----------------------------------------------------- |
| **Friends Tab**          | Hidden | `MainTabNavigator.tsx`    | Uncomment Friends tab (line 176)                      |
| **TrackingPreference**   | Hidden | `OnboardingNavigator.tsx` | Uncomment TrackingPreference screen in onboarding     |
| **Welcome Screen**       | Hidden | `AuthNavigator.tsx`       | Uncomment WelcomeScreen route and remove initialRouteName |

### Current Navigation

```
RootNavigator
├── Auth → AuthNavigator (unauthenticated users, no onboarding needed)
├── Onboarding → OnboardingNavigator (first-time users OR needsPostSignupFlow)
│   └── ... → NameEntry → AccountCreation → EmotionalHook → FunctionalHook → Paywall
└── Main → MainTabNavigator (authenticated users)
    ├── Passport Tab → PassportNavigator
    │   ├── PassportHome (country grid)
    │   ├── CountryDetail (country details, trips, entries)
    │   ├── PhotoTrips, PhotoImport
    │   └── ProfileSettings
    ├── Dreams Tab → DreamsNavigator
    └── Trips Tab → TripsNavigator
```

### Code Markers

Remaining launch simplification changes are marked with:

- `// LAUNCH_SIMPLIFICATION:` - Indicates temporarily disabled code
- `// TODO:` - Describes what to do when re-enabling

## Notes for AI Assistants

1. **NO EMOJIS OR ICONS:** Never add emojis or icons to the UI without explicit permission. This includes emoji characters, icon libraries (Ionicons, etc.), or any visual symbols. All iconography must be custom-designed and approved by the user. Standard system icons (like arrow-forward on buttons) that already exist in the codebase are acceptable.
2. **iOS Simulator Networking:** Use machine's IP address, not `localhost`
3. **RLS:** Always consider Row-Level Security when working with database
4. **Soft Deletes:** Trips and entries use `deleted_at` timestamp
5. **Media Upload:** Three-step flow (request URL → upload to storage → confirm status)
6. **Consent Workflow:** Trip tags must be approved before appearing on tagged user's profile
7. **Design System:** Reference `STYLEGUIDE.md` for colors and typography
8. **Launch Simplification:** Most features re-enabled. Friends tab and TrackingPreference still hidden - see "Launch Simplification" section above
9. **Version Management:** App uses `app.config.js` (dynamic config), so `autoIncrement` in `eas.json` is NOT supported. Manually update `version` in `app.config.js` before each App Store submission.
10. **Photo Import Memory:** Photo import uses memory-optimized display types (`TripCandidateDisplay`, `LocationClusterDisplay`) that store IDs instead of full objects. A `cached_trip_segments` SQLite table stores pre-computed trip data, reducing memory from ~5-10MB to minimal. Users with 5k+ GPS photos see a warning suggesting country filtering.
11. **Query Caching:** Trips and entries queries use `staleTime` (5min) and `gcTime` (30min) to reduce redundant fetches. Mutations use scoped cache invalidation targeting only affected query keys.
12. **Scoped Invalidation:** Trip and entry mutations invalidate only the specific trip/entry queries affected, not the entire cache. This prevents unnecessary refetches during navigation.
13. **Photo Vision:** The photo import pipeline optionally classifies photos using Gemini Flash Lite via OpenRouter. Vision data is sent alongside cluster data in the suggest-places request. The backend runs vision classification in parallel with Google Places search for optimal latency.
14. **Place Matcher Mixin Architecture:** PlaceMatcher uses a mixin pattern (`SearchMixin`, `RankingMixin`, `ClusterProcessingMixin`) for separation of concerns. When modifying matching behavior, identify the correct mixin file rather than editing `matcher.py` directly.
15. **Onboarding Flow Order:** Account creation happens BEFORE the paywall. The `needsPostSignupFlow` flag in authStore keeps users in OnboardingNavigator after authentication until the paywall is complete. See `docs/ONBOARDING_PAYWALL_FIX.md` for the full design rationale.
16. **RevenueCat Promise Coordination:** `prepareLogIn()`, `settleLogIn()`, and `waitForLogIn()` in `revenueCat.ts` coordinate user identification with paywall presentation. The paywall waits for logIn to complete before allowing purchases.

## LLM Place Extraction System

The social ingest feature uses LLM-first place extraction to identify places from TikTok and Instagram URLs.

### Architecture

The extraction pipeline runs LLM and regex extraction in parallel for optimal latency, but only calls Google Places API once (cost optimization):

1. **LLM Extraction** (primary) - Uses Gemini 2.5 Flash-Lite via OpenRouter to extract structured place data
2. **Regex Extraction** (fallback) - CPU-only pattern matching, used when LLM fails or times out
3. **Google Places Resolution** - Called only once for whichever method succeeds

### Entry Type Classification

The LLM automatically classifies places into entry types:

- `Place` - Landmarks, attractions, museums, parks
- `Stay` - Hotels, Airbnbs, hostels
- `Food` - Restaurants, cafes, bars
- `Experience` - Tours, activities, classes

### Configuration

LLM extraction is opt-in via environment variable:

```bash
LLM_PLACE_EXTRACTION_ENABLED=true  # Enable LLM-first extraction
```

Requires `OPENROUTER_API_KEY` to be set (reuses existing OpenRouter config).

### Key Files

| File                                                 | Purpose                                        |
| ---------------------------------------------------- | ---------------------------------------------- |
| `backend/app/services/place_extractor/extractor.py`  | Main extraction orchestration + LLM extraction |
| `backend/app/services/place_extractor/llm_client.py` | OpenRouter API client                          |
| `backend/app/api/ingest.py`                          | Social ingest endpoints                        |
| `docs/place-extraction-algorithm.md`                 | Detailed algorithm documentation               |

### API Response Fields

The `/ingest/social` endpoint returns extraction metadata:

- `extraction_method_used`: `"llm"`, `"regex"`, or `"none"`
- `extraction_latency_ms`: Time taken for extraction
- `detected_place.llm_entry_type`: LLM-predicted entry type (when LLM succeeds)

### Cross-Reference: Photo Vision Classification

The photo import feature uses a separate vision classification system (`backend/app/services/photo_vision/`) that shares the same OpenRouter infrastructure and `MULTIMODAL_MODEL` config. See the "Photo Vision Classification System" section below for details.

---

## Photo Import System

The photo import feature allows users to scan their device photo library and automatically create trip entries based on GPS location clustering, with optional vision classification for improved accuracy.

### Architecture

**Mobile Services (`mobile/src/services/photoImport/` — 12 files):**

- `photoImportService.ts` - Photo extraction with permission handling and batch paging
- `photoClustering.ts` - Geohash-based clustering (precision 7 ~153m) with adjacent cell merging (union-find)
- `photoClusteringCache.ts` - Bridges SQLite cache with clustering pipeline
- `photoClusteringDisplay.ts` - Memory-optimized display types (IDs instead of full objects)
- `photoClusteringTrips.ts` - Trip segmentation from clusters
- `photoCacheDb.ts` - SQLite caching for incremental imports (photos, metadata)
- `photoCacheDbSuggestions.ts` - Processed clusters, cached suggestions with TTL
- `photoBackgroundSync.ts` - Silent background cache refresh on app foreground (1hr interval)
- `visionPhoto.ts` - Select representative photos, resize to 768px, base64 encode for vision API
- `types.ts` - Type definitions (PhotoWithLocation, TripCandidate, PlaceSuggestion, etc.)
- `errors.ts` - Custom error types for photo import
- `index.ts` - Re-exports

**Mobile Screen Components (`mobile/src/screens/photos/components/`):**

- `IdlePhase.tsx` - Initial state before scan begins
- `ScanningPhase.tsx` - Scan progress display
- `SuggestionsPhase.tsx` - Place suggestion review
- `PlaceSuggestionCard.tsx` - Individual suggestion with alternative place cycling (prev/next)
- `ClusterListItem.tsx` - Cluster display in lists
- `PhotoGalleryModal.tsx` - Full-screen photo gallery
- `ManualPlaceSearch.tsx` - Manual Google Places search for unmatched clusters
- `PhotoTripSwitcherSheet.tsx` - Bottom sheet for switching between photo trips
- `PhotoTripCard.tsx` - Trip card for photo trips list
- `PhotoClusterCard.tsx` - Cluster card with photos and suggestions

**Mobile Hooks (`mobile/src/screens/photos/`):**

- `usePhotoScan.ts` - Scan workflow with progress tracking
- `usePlaceSuggestions.ts` - Fetch place suggestions with chunking, caching, and vision data
- `useEntryCreation.ts` - Create entries from confirmed suggestions
- `usePhotoImportWorkflow.ts` - Orchestrates multi-phase workflow
- `useWorkflowAnalytics.ts` - Analytics event tracking for workflow phases
- `useAutoStartWorkflow.ts` - Auto-start workflow from navigation params
- `useClusterItems.ts` - Transform cluster suggestions into UI-ready items
- `useScanLifecycle.ts` - Manage scan lifecycle and state transitions
- `useWorkflowNavigation.ts` - Workflow phase navigation logic

**Mobile Hooks (`mobile/src/hooks/`):**

- `usePhotoTrips.ts` - Access photo-discovered trips from SQLite cache with search/filter by country
- `useMultiClusterUpload.ts` - Manage concurrent photo uploads from multiple location clusters

**Backend Place Matcher (`backend/app/services/place_matcher/` — mixin architecture):**

- `matcher.py` - PlaceMatcher orchestrator (inherits SearchMixin, RankingMixin, ClusterProcessingMixin)
- `_matcher_search.py` - Density-adaptive tiered radius search, Text Search API fallback, tourist relevance filter
- `_matcher_ranking.py` - Vision-integrated scoring with 6 configurable weights (distance, reviews, rating, fame, dwell, vision)
- `_matcher_cluster_processing.py` - Parallel cluster processing with vision result integration
- `cache.py` - LRU cache with TTL and single-flight pattern for deduplication
- `constants.py` - Search radii, density thresholds, place type mappings, quality filters
- `utils.py` - Haversine distance, coordinate utilities, name/address sanitization

**Backend Photo Vision (`backend/app/services/photo_vision/`):**

- `classifier.py` - PhotoClassifier using Gemini Flash Lite via OpenRouter; classifies into 8 categories; extracts visible text from signage/menus
- `constants.py` - Vision categories, confidence levels, LLM prompt templates, category-to-place-type mappings

### Workflow Phases

1. **Scan** - Extract photos with GPS data, cluster by geohash with adjacent cell merging, geocode centroids
2. **Candidates** - Display trip candidates grouped by country and time
3. **Vision** (optional) - Select representative photos per cluster, resize/encode, classify via Gemini Flash Lite
4. **Suggestions** - Fetch place suggestions from backend (vision data sent alongside clusters); text search fallback for detected business names
5. **Confirmation** - User reviews suggestions with alternative place cycling (prev/next), creates entries

### Photo Trips Feature

The Photo Trips screen (`PhotoTripsScreen.tsx`) displays all photo-discovered trips from the SQLite cache, allowing users to browse and select trips for import without re-scanning their photo library.

**Key Features:**

- FlashList for performant rendering with year-based section headers
- Animated search bar for country filtering
- Pull-to-refresh for cache reload
- Grouped by year (most recent first) with trips sorted by date within each year
- Memory-optimized: uses `cached_trip_segments` SQLite table instead of re-clustering in memory

**Navigation:** Accessible via `PhotoTrips` route in PassportNavigator, typically reached from the PhotoTripsCallout component.

### Multi-Cluster Upload

The `useMultiClusterUpload` hook enables concurrent photo uploads from multiple location clusters:

- Per-cluster upload state with progress tracking
- AbortController support for per-cluster cancellation
- Automatic URI conversion from `ph://` to `file://` for upload
- Temp file cleanup after upload completion or cancellation

### Key Files

| File                                                            | Purpose                                 |
| --------------------------------------------------------------- | --------------------------------------- |
| `mobile/src/screens/photos/PhotoImportScreen.tsx`               | Main photo import UI                    |
| `mobile/src/screens/photos/PhotoTripsScreen.tsx`                | Browse photo-discovered trips           |
| `mobile/src/services/photoImport/visionPhoto.ts`               | Vision photo selection and preparation  |
| `mobile/src/services/photoImport/photoBackgroundSync.ts`        | Background cache refresh                |
| `mobile/src/services/photoImport/photoClustering.ts`           | Geohash clustering with adjacent merge  |
| `mobile/src/hooks/usePhotoTrips.ts`                             | SQLite cache access for photo trips     |
| `mobile/src/hooks/useMultiClusterUpload.ts`                     | Concurrent cluster uploads              |
| `backend/app/api/photos.py`                                     | `/photos/suggest-places` endpoint       |
| `backend/app/services/place_matcher/matcher.py`                 | PlaceMatcher orchestrator               |
| `backend/app/services/place_matcher/_matcher_ranking.py`        | Vision-integrated place ranking         |
| `backend/app/services/place_matcher/_matcher_search.py`         | Density-adaptive search logic           |
| `backend/app/services/photo_vision/classifier.py`              | Photo classification via Gemini         |

## Photo Vision Classification System

The photo import pipeline optionally uses computer vision to improve place matching accuracy.

### Architecture

1. **Mobile (preparation)**: `visionPhoto.ts` selects up to 3 representative photos per cluster (closest-to-centroid + temporal extremes), resizes to 768px max dimension, and base64-encodes as JPEG (~50-80KB per image)
2. **Transport**: Vision images sent in `vision_images_base64` field of the `/photos/suggest-places` request (2M char payload cap)
3. **Backend (classification)**: `PhotoClassifier` sends images to Gemini Flash Lite via OpenRouter with structured output schema
4. **Backend (integration)**: Vision classification runs in parallel with Google Places search; results are merged before ranking

### Vision Categories

| Category  | Maps to Entry Type | Example Places                  |
| --------- | ------------------ | ------------------------------- |
| food      | Food               | Restaurants, cafes, bars        |
| landmark  | Place              | Museums, monuments, temples     |
| stay      | Stay               | Hotels, resorts, hostels        |
| shopping  | Experience         | Markets, malls, stores          |
| nature    | Experience         | Parks, beaches, gardens         |
| nightlife | Experience         | Clubs, casinos, bars            |
| transport | (no mapping)       | Airports, stations              |
| unknown   | (no mapping)       | Unclear photos                  |

### How Vision Improves Matching

- **Category bonus in ranking**: Places matching the vision category get a score boost (configurable via `PLACES_RANK_VISION_WEIGHT`)
- **Text detection**: Signage/menu text triggers Google Places Text Search API as fallback when nearby search fails
- **Multi-photo aggregation**: Confidence-weighted voting across up to 3 photos per cluster
- **Request-level cap**: Maximum 50 vision images per request to prevent payload bloat

### Configuration

- Requires `OPENROUTER_API_KEY` env var
- Uses `MULTIMODAL_MODEL` for model selection (default: `google/gemini-2.5-flash-lite`)
- Cost: ~$0.00008 per photo at 768px via OpenRouter

---

## Subscription System

The app uses RevenueCat for subscription management with a freemium model.

### Architecture

The subscription system has three main components:

- **Mobile**: RevenueCat SDK + Zustand store + App Group sync for Share Extension
- **Backend**: Webhook processing + usage tracking + entry limit enforcement
- **Database**: Subscription fields on user_profile + atomic usage increment functions

### Free Tier Limits

| Feature              | Limit        |
| -------------------- | ------------ |
| Share Extension Uses | 5 per month  |
| Photo Import Trips   | 1 (lifetime) |
| Entries per Trip     | 10           |

### Key Files

| File                                     | Purpose                                           |
| ---------------------------------------- | ------------------------------------------------- |
| `mobile/src/stores/subscriptionStore.ts` | Central subscription state (FREE_LIMITS constant) |
| `mobile/src/hooks/useSubscription.ts`    | Purchase/restore flows                            |
| `mobile/src/hooks/usePremiumGate.ts`     | Feature gating hook                               |
| `mobile/src/services/revenueCat.ts`      | SDK initialization and helpers                    |
| `mobile/src/services/appGroupSync.ts`    | App Group sync for Share Extension                |
| `backend/app/api/webhooks.py`            | RevenueCat webhook endpoint                       |
| `backend/app/api/subscriptions.py`       | Status/usage endpoints                            |
| `backend/app/api/entries.py`             | Entry limit enforcement (403 for over-limit)      |
| `docs/SUBSCRIPTION.md`                   | Comprehensive setup and testing guide             |

### Environment Variables

**Mobile (`mobile/.env.local`):**

```
EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=appl_xxx
EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=goog_xxx  # Optional
```

**Backend (`backend/.env`):**

```
REVENUECAT_WEBHOOK_AUTH_HEADER=secure-random-string
REVENUECAT_API_KEY=sk_xxx
```

### Feature Gating Pattern

Use the `usePremiumGate` hook to gate features:

```typescript
const { canCreateEntry, showPaywall } = usePremiumGate();

if (!canCreateEntry) {
  showPaywall("entry_limit");
  return;
}
```

---

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

**Note:** The CSS source files are in `backend/app/static/css/src/`. After editing, run the build script to regenerate `styles.css` and `styles.min.css`. Always commit the generated files.

**Common lint issues to avoid:**

- Unused imports (remove them)
- `require()` style imports in TypeScript (use ES6 `import` instead)
- Missing type annotations
- Unused variables (prefix with `_` if intentionally unused)
