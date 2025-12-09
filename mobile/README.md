# Border Badge Mobile App

React Native (Expo) mobile application for the Border Badge travel tracking platform.

## Prerequisites

- Node.js 18+
- npm or yarn
- Expo CLI (`npm install -g expo-cli`)
- iOS Simulator (macOS with Xcode) or Android Emulator
- Watchman (recommended for macOS: `brew install watchman`)

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your configuration:

```bash
# IMPORTANT: iOS Simulator cannot access localhost
# Use your machine's IP address instead
# Find your IP: ifconfig | grep "inet " | grep -v 127.0.0.1
EXPO_PUBLIC_API_URL=http://192.168.1.100:8000

EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
EXPO_PUBLIC_APP_ENV=development
EXPO_PUBLIC_GOOGLE_PLACES_API_KEY=your-google-places-key
EXPO_PUBLIC_WEB_BASE_URL=http://192.168.1.100:8000
```

### 3. Start Development Server

```bash
npx expo start
```

- Press `i` to open iOS Simulator
- Press `a` to open Android Emulator
- Scan QR code with Expo Go app for physical device

## Project Structure

```
mobile/src/
├── components/           # Reusable UI components
│   ├── ui/               # Base components
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Chip.tsx
│   │   ├── OTPInput.tsx
│   │   ├── PhoneInput.tsx
│   │   └── ...
│   ├── entries/          # Entry-specific components
│   ├── media/            # Media handling components
│   └── places/           # Google Places components
├── screens/              # App screens
│   ├── auth/             # Authentication screens
│   │   └── PhoneAuthScreen.tsx
│   ├── onboarding/       # Onboarding flow (12 screens)
│   │   ├── WelcomeCarouselScreen.tsx
│   │   ├── OnboardingSliderScreen.tsx
│   │   ├── MotivationScreen.tsx
│   │   ├── HomeCountryScreen.tsx
│   │   ├── DreamDestinationScreen.tsx
│   │   ├── ContinentIntroScreen.tsx
│   │   ├── ContinentCountryGridScreen.tsx
│   │   └── ...
│   ├── country/          # Country detail screens
│   ├── entries/          # Entry management
│   ├── lists/            # Shareable lists
│   ├── trips/            # Trip screens
│   ├── PassportScreen.tsx
│   ├── DreamsScreen.tsx
│   ├── MapScreen.tsx
│   └── ProfileScreen.tsx
├── navigation/           # React Navigation setup
│   └── RootNavigator.tsx
├── hooks/                # Custom React hooks
│   ├── useAuth.ts        # Authentication
│   ├── useTrips.ts       # Trip data
│   ├── useEntries.ts     # Entry data
│   ├── useCountries.ts   # Country data
│   ├── useMedia.ts       # Media handling
│   ├── useLists.ts       # Lists data
│   └── useProfile.ts     # User profile
├── services/             # External services
│   ├── api.ts            # Axios API client
│   ├── supabase.ts       # Supabase client
│   ├── mediaUpload.ts    # Media upload logic
│   ├── countriesDb.ts    # Local SQLite database
│   └── guestMigration.ts # Guest to user migration
├── stores/               # Zustand state stores
│   ├── authStore.ts      # Authentication state
│   └── onboardingStore.ts # Onboarding progress
├── constants/            # App constants
│   ├── colors.ts         # Color palette
│   ├── typography.ts     # Font styles
│   └── regions.ts        # Geographic regions
├── config/               # Configuration
│   └── env.ts            # Environment validation
├── utils/                # Utility functions
├── assets/               # Images, fonts, videos
└── __tests__/            # Test files
```

## Key Dependencies

| Package                    | Purpose                 |
| -------------------------- | ----------------------- |
| `expo`                     | React Native framework  |
| `@supabase/supabase-js`    | Supabase client         |
| `zustand`                  | State management        |
| `@tanstack/react-query`    | Server state management |
| `axios`                    | HTTP client             |
| `@react-navigation/native` | Navigation              |
| `expo-secure-store`        | Secure token storage    |
| `expo-sqlite`              | Local database          |

## Available Scripts

| Command                  | Description                   |
| ------------------------ | ----------------------------- |
| `npx expo start`         | Start Expo development server |
| `npm test`               | Run Jest tests                |
| `npm run lint`           | Run ESLint                    |
| `npx prettier --check .` | Check code formatting         |
| `npx prettier --write .` | Format code                   |

## Architecture Patterns

### State Management

**Zustand Stores:**

- `authStore` - Session, onboarding status, loading states
- `onboardingStore` - Persisted onboarding progress (AsyncStorage)

**React Query:**

- All server state (trips, entries, countries, media)
- Automatic caching and invalidation
- Optimistic updates where appropriate

### Data Fetching

Custom hooks wrap React Query for data operations:

```typescript
// Example usage
const { data: trips, isLoading } = useTrips();
const { mutate: createTrip } = useCreateTrip();
```

### Navigation

React Navigation with:

- Native stack navigator for performance
- Bottom tab navigator for main screens
- Conditional rendering based on auth state

```
RootNavigator
├── OnboardingNavigator (if !hasCompletedOnboarding)
└── MainTabNavigator (if authenticated)
    ├── PassportTab
    ├── DreamsTab
    ├── TripsTab
    └── ProfileTab
```

### API Client

Axios instance with automatic token injection:

```typescript
// services/api.ts handles:
// - Bearer token injection from SecureStore
// - Auto sign-out on 401 responses
// - 10 second timeout
```

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage
```

Test files are located in `src/__tests__/` and colocated with components.

## Building for Production

### Using EAS Build

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Build for iOS
eas build --platform ios

# Build for Android
eas build --platform android
```

### Configuration

See `eas.json` for build profiles:

- `development` - Internal testing builds
- `preview` - TestFlight/Internal testing
- `production` - App Store/Play Store releases

## Troubleshooting

### iOS Simulator Can't Connect to API

iOS Simulator cannot access `localhost`. Use your machine's IP address:

```bash
# Find your IP
ifconfig | grep "inet " | grep -v 127.0.0.1

# Update .env.local
EXPO_PUBLIC_API_URL=http://192.168.1.100:8000
```

### Metro Bundler Issues

```bash
# Clear cache and restart
npx expo start --clear
```

### Dependency Issues

```bash
# Clear node_modules and reinstall
rm -rf node_modules
npm install
```

### TypeScript Errors

```bash
# Check TypeScript compilation
npx tsc --noEmit
```

## Code Style

- ESLint with TypeScript and React rules
- Prettier for formatting (100 char line width, 2 space indent)
- Prefer functional components with hooks
- Use `useMemo` and `useCallback` for performance optimization
- Type-safe navigation params

## Related Documentation

- [Root README](../README.md)
- [CLAUDE.md](../CLAUDE.md) - AI assistant context
- [STYLEGUIDE.md](../STYLEGUIDE.md) - Design system
- [Backend README](../backend/README.md)
