# Border Badge - AI Assistant Context

## Project Overview

Border Badge is a travel tracking mobile application that lets users mark countries they've visited, build wishlists of future destinations, log trips with rich entries (places, food, stays, experiences), and share curated lists with friends. The app features a "passport grid" visual interface and a consent-based social layer.

## Tech Stack

| Layer    | Technology                                    |
| -------- | --------------------------------------------- |
| Mobile   | React Native 0.81.5, Expo 54, TypeScript      |
| State    | Zustand (auth), React Query (server state)    |
| Backend  | FastAPI (Python 3.12+), Uvicorn               |
| Database | Supabase (PostgreSQL with Row-Level Security) |
| Storage  | Supabase Storage (media files)                |
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
│   │   │   └── trips/      # Trip management
│   │   ├── navigation/     # React Navigation setup
│   │   ├── hooks/          # Custom React hooks (data fetching)
│   │   ├── services/       # API client, Supabase, media upload
│   │   ├── stores/         # Zustand stores (authStore, onboardingStore)
│   │   ├── constants/      # Colors, typography, regions
│   │   └── config/         # Environment configuration
│   └── package.json
├── backend/                # FastAPI Python backend
│   ├── app/
│   │   ├── api/            # API route modules
│   │   ├── core/           # Config, security, validators
│   │   ├── schemas/        # Pydantic models
│   │   ├── db/             # Supabase client wrapper
│   │   └── main.py         # FastAPI app entry point
│   └── pyproject.toml      # Poetry dependencies
├── supabase/               # Database migrations and seeds
│   └── migrations/         # SQL migration files (17 migrations)
├── docs/                   # Product documentation
│   ├── travel-prd.md       # Product Requirements Document
│   ├── travel-technical-design.md  # Technical design
│   └── travel-mvp-blueprint.md     # Implementation blueprint
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

### Database

```bash
cd supabase
# Migrations are managed via Supabase dashboard or CLI
# See supabase/migrations/ for schema
```

## Environment Setup

### Mobile (`mobile/.env.local`)

```
EXPO_PUBLIC_API_URL=http://<your-ip>:8000  # iOS simulator needs IP, not localhost
EXPO_PUBLIC_SUPABASE_URL=<supabase-url>
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
EXPO_PUBLIC_APP_ENV=development
EXPO_PUBLIC_GOOGLE_PLACES_API_KEY=<google-places-key>
EXPO_PUBLIC_WEB_BASE_URL=http://<your-ip>:8000
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
```

## Key Architecture Patterns

### Mobile

**State Management:**

- `authStore` (Zustand) - Session, onboarding status, loading states
- `onboardingStore` (Zustand + AsyncStorage) - Persisted onboarding progress
- React Query - Server state for trips, entries, countries, media

**Data Fetching Hooks:**

- `useTrips()`, `useTripsByCountry()`, `useTrip()` - Trip queries
- `useEntries()`, `useEntry()` - Entry queries
- `useCountries()`, `useUserCountries()` - Country data
- `useUploadMedia()` - Media upload with progress

**API Client (`mobile/src/services/api.ts`):**

- Axios instance with JWT token injection
- Auto sign-out on 401 responses
- 10 second timeout

**Navigation:**

- React Navigation with native-stack and bottom-tabs
- Conditional rendering: OnboardingNavigator vs MainTabNavigator
- Type-safe navigation params

### Backend

**API Routes (`backend/app/api/`):**
| Route | Purpose |
|-------|---------|
| `/countries` | Country reference data |
| `/user_countries` | User's visited/wishlist countries |
| `/trips` | Trip CRUD with tagging |
| `/trips/{id}/entries` | Entry CRUD |
| `/media/files` | Media upload URLs, status |
| `/lists` | Shareable curated lists |
| `/profile` | User profile |
| `/public` | Public trip/list views |

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
trip             - User trips (soft delete supported)
trip_tags        - Consent workflow for tagged friends
entry            - Trip entries (place/food/stay/experience)
place            - Google Places enrichment
media_files      - Uploaded photos
list             - Shareable curated lists
list_entries     - List to entry junction
user_profile     - Extended user data
```

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

## Authentication System (IMPORTANT)

The app uses **email/password authentication** for all users. Magic links are NOT supported.

### Authentication Screens

| Screen | File | Purpose |
|--------|------|---------|
| **AccountCreationScreen** | `screens/onboarding/AccountCreationScreen.tsx` | **New user sign-up** during onboarding. Collects email + password (password appears after valid email). Uses `useSignUpWithPassword` hook. Also supports Apple/Google social sign-in. |
| **AuthScreen** | `screens/auth/AuthScreen.tsx` | **Returning user sign-in**. Collects email + password (password appears after valid email). Uses `useSignInWithPassword` hook. Also supports Apple/Google social sign-in. |

### Authentication Flow

1. **New Users (Onboarding)**:
   - Complete onboarding steps → `AccountCreationScreen`
   - Enter email → password field appears when email is valid
   - Submit → `useSignUpWithPassword` creates account with displayName from onboarding

2. **Returning Users**:
   - Launch app → `AuthScreen`
   - Enter email → password field appears when email is valid
   - Submit → `useSignInWithPassword` authenticates

### Auth Hooks (`mobile/src/hooks/useAuth.ts`)

| Hook | Purpose |
|------|---------|
| `useSignUpWithPassword` | Create new account (email, password, displayName) |
| `useSignInWithPassword` | Sign in existing account (email, password) |
| `useSignOut` | Sign out and clear session |

### Key Implementation Details

- Password field only appears after entering a valid email (progressive disclosure)
- Minimum password length: 6 characters (Supabase default)
- Email validation uses RFC 5322 compliant regex
- Social auth (Apple, Google) available as alternatives
- **Magic links are NOT implemented** - do not add magic link functionality

## Launch Simplification (IMPORTANT)

The app has been simplified for initial launch. Several features are **temporarily hidden** but fully implemented and ready to re-enable.

### Hidden Features

| Feature | Status | Location | How to Re-enable |
|---------|--------|----------|------------------|
| **Tab Bar** | Hidden | `RootNavigator.tsx` | Replace `PassportNavigator` with `MainTabNavigator` |
| **Dreams Tab** | Hidden | `MainTabNavigator.tsx` | Part of tab bar - will return when tabs enabled |
| **Trips List Tab** | Hidden | `MainTabNavigator.tsx` | Part of tab bar - will return when tabs enabled |
| **Friends Tab** | Hidden | `MainTabNavigator.tsx` | Part of tab bar - will return when tabs enabled |
| **Paywall Screen** | Hidden | `OnboardingNavigator.tsx` | Uncomment PaywallScreen route and update ProgressSummaryScreen navigation |
| **Welcome Screen** | Hidden | `AuthNavigator.tsx` | Uncomment WelcomeScreen route and remove initialRouteName |

### Current Launch Navigation

```
RootNavigator
├── Auth → AuthNavigator (unauthenticated users)
├── Onboarding → OnboardingNavigator (first-time users)
└── Main → PassportNavigator (authenticated users)
    ├── PassportHome (country grid)
    ├── CountryDetail (country details, trips, entries)
    └── ProfileSettings (user settings)
```

### Re-enabling the Full App

To restore all features after launch, update `mobile/src/navigation/RootNavigator.tsx`:

1. Uncomment the `MainTabNavigator` import
2. Replace `PassportNavigator` with `MainTabNavigator` in the `Main` screen
3. Search for `LAUNCH_SIMPLIFICATION` comments throughout the codebase

### Code Markers

All launch simplification changes are marked with:
- `// LAUNCH_SIMPLIFICATION:` - Indicates temporarily disabled code
- `// TODO:` - Describes what to do when re-enabling

## Test User Seeding

A Python script creates test users with realistic content for demoing friend functionality, feeds, trips, and social features.

### Quick Commands

```bash
cd backend

# Create 8 test users with trips, entries, follows, and trip tags
poetry run python scripts/seed_test_users.py

# Connect test users to your real account (follow relationships + pending trip tags)
poetry run python scripts/seed_test_users.py --real-user-id "YOUR-UUID-HERE"

# Cleanup only (remove all test users and their data)
poetry run python scripts/seed_test_users.py --cleanup-only

# Verbose output
poetry run python scripts/seed_test_users.py -v
```

### Test Users Created

| Username | Email | Home | Travel Style |
|----------|-------|------|--------------|
| alex_chen | alex_chen+test@example.com | US | Backpacker |
| sofia_travels | sofia_travels+test@example.com | ES | Luxury |
| yuki_adventures | yuki_adventures+test@example.com | JP | Photographer |
| marcus_j | marcus_j+test@example.com | GB | Food Explorer |
| priya_world | priya_world+test@example.com | IN | Cultural |
| lars_nordic | lars_nordic+test@example.com | SE | Outdoor |
| bella_costa | bella_costa+test@example.com | BR | Beach & Party |
| david_explores | david_explores+test@example.com | KR | Digital Nomad |

**Password for all test users:** `TestUser123!`

### What Gets Created

- **8 users** with unique travel personas and home countries
- **2-3 trips per user** with realistic destinations and dates
- **3-5 entries per trip** (places, food, stays, experiences)
- **Follow network** between test users (first 4 follow each other, others follow some)
- **Trip tags** between users (some approved)
- **Country visits** in `user_countries` table

### Real User Integration (`--real-user-id`)

When you provide your real user ID:
- 4 test users follow you (populates your followers)
- You follow 4 test users (populates your feed)
- 2 test users tag you on trips with pending status (for testing tag acceptance)

### How Test Users Are Identified

Test users are auto-detected by the `+test@` pattern in their email. The `handle_new_user` trigger sets `is_test=true` on their `user_profile`.

### Script Structure

```
backend/scripts/
├── seed_test_users.py      # Main runner script
└── seed/
    ├── __init__.py
    ├── personas.py         # 8 test user definitions with trips/entries
    ├── auth.py             # Supabase Admin API (create/delete users)
    ├── database.py         # DB operations (trips, entries, follows, tags)
    └── cleanup.py          # Delete test data in FK order
```

### Cleanup Order

The script cleans up in foreign key order to avoid constraint violations:
1. `trip_tags` → 2. `entry` → 3. `trip` → 4. `user_countries` → 5. `user_follow` → 6. `pending_invite` → 7. auth users (via Admin API)

## Notes for AI Assistants

1. **iOS Simulator Networking:** Use machine's IP address, not `localhost`
2. **RLS:** Always consider Row-Level Security when working with database
3. **Soft Deletes:** Trips and entries use `deleted_at` timestamp
4. **Media Upload:** Three-step flow (request URL → upload to storage → confirm status)
5. **Consent Workflow:** Trip tags must be approved before appearing on tagged user's profile
6. **Design System:** Reference `STYLEGUIDE.md` for colors and typography
7. **Launch Simplification:** Tab bar and some features are hidden - see "Launch Simplification" section above
8. **Test Users:** Use the seed script to create test data for social features - see "Test User Seeding" section

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
