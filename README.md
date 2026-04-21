# Border Badge

A travel tracking mobile application that lets travelers mark countries they've visited, build wishlists of future destinations, log trips with rich entries, and share curated recommendations with friends.

## Features

- **Passport Grid** - Visual country tracking with visited/wishlist status and travel tier badges
- **Trip Management** - Create trips with cover photos, dates, and tagged companions
- **Entry Logging** - Log places, restaurants, stays, and experiences with photos and notes
- **Photo Import** - Scan device photos to automatically suggest trip entries based on GPS location clustering, and surface nearby library photos as tappable suggestions when logging a place
- **Social Layer** - Connect with friends, compare travel maps, consent-based trip tagging
- **Shareable Lists** - Curate and share city-specific recommendations via public links
- **Offline Support** - Local SQLite caching for country data
- **Premium Animations** - Shared element transitions, micro-interactions, and staggered entrances with accessibility support
- **Premium Subscription** - RevenueCat-powered freemium model with feature gating (entry limits, share extension usage, photo import trips)
- **Ad Attribution** - Facebook & TikTok conversion tracking with client-side SDK (Meta) and server-side APIs (Meta CAPI + TikTok Events API)

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Mobile App    │────▶│  FastAPI        │────▶│   Supabase      │
│   (Expo/RN)     │     │  Backend        │     │   (PostgreSQL)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        ▼                       ▼                       ▼
   Supabase Auth         JWT Validation           RLS Policies
   (Phone OTP)           + Rate Limiting          + Storage
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Mobile | React Native 0.81, Expo 54, TypeScript |
| State | Zustand, React Query |
| Backend | FastAPI (Python 3.12+) |
| Database | Supabase (PostgreSQL + RLS) |
| Storage | Supabase Storage |
| Auth | Supabase Phone OTP |

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.12+
- Poetry
- iOS Simulator (macOS) or Android Emulator
- Supabase project

### 1. Clone and Setup

```bash
git clone <repository-url>
cd border-badge
```

### 2. Backend Setup

```bash
cd backend
cp .env.example .env
# Edit .env with your Supabase credentials
poetry install
poetry run uvicorn app.main:app --reload --host 0.0.0.0
```

The API will be available at http://localhost:8000

### 3. Mobile Setup

```bash
cd mobile
cp .env.example .env.local
# Edit .env.local - use your machine's IP for API_URL (not localhost for iOS simulator)
npm install
npx expo start
```

Press `i` for iOS Simulator or `a` for Android Emulator.

## Project Structure

```
border-badge/
├── mobile/              # React Native (Expo) app
│   └── src/
│       ├── components/  # UI components
│       ├── screens/     # App screens
│       ├── navigation/  # React Navigation setup
│       ├── hooks/       # Custom hooks (data fetching)
│       ├── services/    # API client, Supabase
│       ├── stores/      # Zustand state stores
│       └── constants/   # Colors, typography
├── backend/             # FastAPI Python backend
│   └── app/
│       ├── api/         # API route handlers
│       ├── core/        # Config, security, utilities
│       ├── schemas/     # Pydantic models
│       └── db/          # Database client
├── supabase/            # Database migrations
│   └── migrations/      # SQL migration files
├── docs/                # Product documentation
└── instructions/        # Development task files
```

## Documentation

| Document | Description |
|----------|-------------|
| [CLAUDE.md](./CLAUDE.md) | AI assistant context and quick reference |
| [STYLEGUIDE.md](./STYLEGUIDE.md) | Design system (colors, typography) |
| [Product Requirements](./docs/travel-prd.md) | Full PRD with user stories |
| [Technical Design](./docs/travel-technical-design.md) | Architecture and API contracts |
| [MVP Blueprint](./docs/travel-mvp-blueprint.md) | Phase-by-phase implementation |
| [API Reference](./docs/API.md) | Backend API documentation |
| [Subscription System](./docs/SUBSCRIPTION.md) | RevenueCat subscription setup and testing |
| [Ad Tracking Setup](./docs/AD_TRACKING_SETUP.md) | Facebook & TikTok ad attribution setup guide |
| [Mobile README](./mobile/README.md) | Mobile app development guide |
| [Backend README](./backend/README.md) | Backend development guide |
| [Contributing](./CONTRIBUTING.md) | Contribution guidelines |

## Development

### Running Tests

```bash
# Mobile
cd mobile && npm test

# Backend
cd backend && poetry run pytest
```

### Code Quality

```bash
# Mobile
cd mobile
npm run lint
npx prettier --check .

# Backend
cd backend
poetry run ruff check .
poetry run ruff format --check .
```

## Environment Variables

### Mobile (`mobile/.env.local`)

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_API_URL` | Backend API URL (use IP for iOS simulator) |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `EXPO_PUBLIC_APP_ENV` | Environment (development/staging/production) |
| `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` | Google Places API key |
| `EXPO_PUBLIC_WEB_BASE_URL` | Base URL for public web pages (Terms, Privacy) |
| `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` | RevenueCat iOS API key (for subscriptions) |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` | RevenueCat Android API key (optional) |
| `EXPO_PUBLIC_FB_APP_ID` | Facebook App ID for client-side SDK |
| `EXPO_PUBLIC_FB_CLIENT_TOKEN` | Facebook Client Token for client-side SDK |

### Backend (`backend/.env`)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `SUPABASE_JWT_SECRET` | JWT secret for token validation |
| `RESEND_API_KEY` | Resend API key for welcome emails (optional) |
| `WELCOME_EMAIL_FROM` | From address for welcome emails (default: hello@atlasi.app) |
| `REVENUECAT_WEBHOOK_AUTH_HEADER` | Auth header for RevenueCat webhook verification |
| `REVENUECAT_API_KEY` | RevenueCat secret API key for server-side verification |
| `FACEBOOK_PIXEL_ID` | Meta Pixel/Dataset ID for Conversions API |
| `FACEBOOK_CAPI_ACCESS_TOKEN` | Meta system user access token for Conversions API |
| `TIKTOK_PIXEL_CODE` | TikTok Pixel code for Events API |
| `TIKTOK_ACCESS_TOKEN` | TikTok access token for Events API |

## CI/CD

All pull requests must pass CI checks before merging:

- **Backend:** Ruff lint, format check, pytest
- **Mobile:** ESLint, Prettier check, Jest tests

## License

Private - All rights reserved
