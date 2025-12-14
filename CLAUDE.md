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
| Auth     | Supabase Phone OTP Authentication             |

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
```

### Backend (`backend/.env`)

```
ENV=development
DEBUG=true
SUPABASE_URL=<supabase-url>
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_JWT_SECRET=<jwt-secret>
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
country          - Reference data (197 countries)
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

| File                                      | Purpose                 |
| ----------------------------------------- | ----------------------- |
| `mobile/src/services/api.ts`              | Axios API client setup  |
| `mobile/src/services/supabase.ts`         | Supabase client init    |
| `mobile/src/stores/authStore.ts`          | Auth state management   |
| `mobile/src/navigation/RootNavigator.tsx` | App navigation          |
| `backend/app/main.py`                     | FastAPI app setup       |
| `backend/app/core/config.py`              | Environment config      |
| `backend/app/core/security.py`            | JWT validation          |
| `backend/app/db/session.py`               | Supabase client         |
| `STYLEGUIDE.md`                           | Design system reference |
| `docs/travel-prd.md`                      | Product requirements    |
| `docs/travel-technical-design.md`         | Technical design        |

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

## Notes for AI Assistants

1. **iOS Simulator Networking:** Use machine's IP address, not `localhost`
2. **RLS:** Always consider Row-Level Security when working with database
3. **Soft Deletes:** Trips and entries use `deleted_at` timestamp
4. **Media Upload:** Three-step flow (request URL → upload to storage → confirm status)
5. **Consent Workflow:** Trip tags must be approved before appearing on tagged user's profile
6. **Design System:** Reference `STYLEGUIDE.md` for colors and typography
7. **Launch Simplification:** Tab bar and some features are hidden - see "Launch Simplification" section above

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

**Common lint issues to avoid:**
- Unused imports (remove them)
- `require()` style imports in TypeScript (use ES6 `import` instead)
- Missing type annotations
- Unused variables (prefix with `_` if intentionally unused)
