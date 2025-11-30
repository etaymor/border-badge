## Relevant Files

- `mobile/app.json` - Expo app configuration (name, slug, bundle identifiers, runtime env) for the mobile client.
- `mobile/package.json` - Mobile app dependencies and scripts, including Expo, React Navigation, React Query, Jest, and React Native Testing Library.
- `mobile/tsconfig.json` - TypeScript configuration for the React Native app (paths, strictness, JSX settings).
- `mobile/babel.config.js` - Babel configuration with module-resolver plugin for path aliases.
- `mobile/App.tsx` - Root React Native component that wires the navigation container, providers (React Query, auth), and top-level layout.
- `mobile/src/navigation/index.ts` - Navigation exports barrel file.
- `mobile/src/navigation/types.ts` - Route name and param list types for React Navigation, ensuring type-safe navigation.
- `mobile/src/navigation/RootNavigator.tsx` - Root navigator that conditionally shows Auth, Onboarding, or Main tabs based on auth state.
- `mobile/src/navigation/AuthNavigator.tsx` - Auth stack navigator (Login, SignUp, ForgotPassword).
- `mobile/src/navigation/MainTabNavigator.tsx` - Bottom tab navigator (Map, Trips, Profile).
- `mobile/src/navigation/TripsNavigator.tsx` - Trips stack navigator (TripsList, TripDetail, TripForm).
- `mobile/src/screens/auth/LoginScreen.tsx` - Login screen shell.
- `mobile/src/screens/auth/SignUpScreen.tsx` - Sign up screen shell.
- `mobile/src/screens/auth/ForgotPasswordScreen.tsx` - Forgot password screen shell.
- `mobile/src/screens/OnboardingScreen.tsx` - Onboarding welcome screen shell.
- `mobile/src/screens/MapScreen.tsx` - Map tab screen shell.
- `mobile/src/screens/ProfileScreen.tsx` - Profile tab screen shell.
- `mobile/src/screens/trips/TripsListScreen.tsx` - Trips list screen shell.
- `mobile/src/screens/trips/TripDetailScreen.tsx` - Trip detail screen shell.
- `mobile/src/screens/trips/TripFormScreen.tsx` - Trip form screen shell (create/edit).
- `mobile/src/components/ui/Button.tsx` - Shared button component with primary/secondary/outline/ghost variants.
- `mobile/src/components/ui/Text.tsx` - Shared text/typography wrapper with variants (title, subtitle, body, label, caption).
- `mobile/src/components/ui/Input.tsx` - Shared text input component with labels, errors, and focus states.
- `mobile/src/components/ui/Screen.tsx` - Shared screen wrapper handling safe area and background.
- `mobile/src/stores/authStore.ts` - Zustand store for auth state (session, onboarding status).
- `mobile/src/services/api.ts` - API client with Axios, auth token interceptors, and refresh token logic.
- `mobile/src/hooks/useTrips.ts` - React Query hooks for trips CRUD operations.
- `mobile/src/hooks/useProfile.ts` - React Query hooks for profile operations.
- `mobile/src/hooks/useCountries.ts` - React Query hooks for countries and visited countries.
- `mobile/src/config/env.ts` - Environment configuration helper for API base URL and app environment.
- `mobile/src/config/features.ts` - Feature flags for gradual rollout.
- `mobile/.env.example` - Example environment variables file.
- `mobile/jest.config.js` - Jest configuration using jest-expo preset.
- `mobile/jest.setup.js` - Jest setup file with mocks for react-native-safe-area-context, react-native-screens, and expo-secure-store.
- `mobile/src/__tests__/App.smoke.test.tsx` - Smoke tests for LoginScreen.
- `mobile/src/__tests__/components/Button.test.tsx` - Unit tests for Button component.
- `mobile/src/__tests__/components/Input.test.tsx` - Unit tests for Input component.
- `mobile/src/__tests__/stores/authStore.test.ts` - Unit tests for auth store.
- `mobile/src/__tests__/config/features.test.ts` - Unit tests for feature flags.
- `mobile/src/__tests__/utils/testUtils.tsx` - Test utilities with providers wrapper.

### Notes

- Phase 2 is scoped to **navigation, screen shells, a minimal design system, and the data layer scaffolding**, not full end-to-end flows; most business logic and UX will land in Phases 3–5.
- Navigation structure: Auth stack (Login, SignUp, ForgotPassword) -> Onboarding -> Main tabs (Map, Trips, Profile).
- Uses **Expo (managed workflow)** with TypeScript, **React Navigation** for navigation, **React Query** for server state, **Zustand** for auth state, and **Axios** for HTTP.
- Tests are **smoke and basic component tests** to ensure navigation renders and core primitives behave sensibly.
- **iOS Simulator note**: Cannot access localhost. Use machine's IP address (e.g., `192.168.x.x:8000`) for API_URL.

## Tasks

- [x] 1.0 Establish `mobile/` app structure with Expo and TypeScript

  - [x] 1.1 ~~Create a `mobile/` directory~~ Mobile directory already exists. Removed nested `.git` to integrate into monorepo.
  - [x] 1.2 Configure `mobile/app.json` with app name (Border Badge), slug, iOS bundle identifier (com.borderbadge.app), and custom URL scheme (borderbadge).
  - [x] 1.3 Add core dependencies: React Navigation (native + native-stack + bottom-tabs), React Query (@tanstack/react-query), Axios, Zustand, expo-secure-store, react-native-screens, react-native-gesture-handler.
  - [x] 1.4 Set up `mobile/tsconfig.json` with strict type checking and path aliases (@screens, @components, @hooks, @services, @stores, @utils, @config, @navigation). Added babel.config.js with module-resolver.
  - [x] 1.5 Verified `npm test` runs successfully (3 smoke tests pass) and TypeScript compiles without errors.

- [x] 2.0 Implement navigation container with auth stack, onboarding, and main tab navigator

  - [x] 2.1 Created `mobile/src/navigation/types.ts` defining TypeScript route types for RootStack, AuthStack, MainTabs, and TripsStack.
  - [x] 2.2 Implemented `RootNavigator` that conditionally renders Auth, Onboarding, or Main based on auth state from Zustand store.
  - [x] 2.3 Created auth screen shells: LoginScreen, SignUpScreen, ForgotPasswordScreen under `mobile/src/screens/auth/`.
  - [x] 2.4 Created OnboardingScreen shell at `mobile/src/screens/OnboardingScreen.tsx`.
  - [x] 2.5 Created main tab screens: MapScreen, ProfileScreen, and trips screens (TripsListScreen, TripDetailScreen, TripFormScreen).
  - [x] 2.6 Updated `mobile/App.tsx` to render RootNavigator with NavigationContainer, QueryClientProvider, and SafeAreaProvider.

- [x] 3.0 Create shared UI primitives and a minimal neutral design system

  - [x] 3.1 Created color tokens and spacing constants inline in components (neutral template iOS design - no branding until Phase 8).
  - [x] 3.2 Implemented `mobile/src/components/ui/Screen.tsx` as SafeAreaView wrapper with consistent background.
  - [x] 3.3 Implemented `mobile/src/components/ui/Text.tsx` with variants: title, subtitle, body, label, caption.
  - [x] 3.4 Implemented `mobile/src/components/ui/Button.tsx` with primary/secondary/outline/ghost variants, disabled/loading states, 44px min height.
  - [x] 3.5 Implemented `mobile/src/components/ui/Input.tsx` with labels, error text, focus states.
  - [x] 3.6 Screen shells use shared primitives (SafeAreaView, Text, StyleSheet patterns).

- [x] 4.0 Implement API client and React Query–based data layer scaffolding

  - [x] 4.1 Configured React Query with QueryClient in App.tsx (5min staleTime, 2 retries).
  - [x] 4.2 Created `mobile/src/config/env.ts` for API base URL and environment variables using EXPO_PUBLIC_ prefix.
  - [x] 4.3 Implemented `mobile/src/services/api.ts` with Axios, auth token interceptor, and refresh token logic.
  - [x] 4.4 Created Zustand auth store in `mobile/src/stores/authStore.ts` with session, onboarding status, and actions.
  - [x] 4.5 Implemented `mobile/src/hooks/useCountries.ts` with useCountries and useVisitedCountries hooks.
  - [x] 4.6 Implemented `mobile/src/hooks/useTrips.ts` with useTrips, useTrip, useCreateTrip, useUpdateTrip, useDeleteTrip hooks.
  - [x] 4.7 Implemented `mobile/src/hooks/useProfile.ts` with useProfile and useUpdateProfile hooks. All hooks return isLoading/isError/error.

- [x] 5.0 Wire environment configuration and basic feature flags

  - [x] 5.1 Using Expo's EXPO_PUBLIC_ environment variable prefix strategy. Documented in .env.example.
  - [x] 5.2 Implemented `mobile/src/config/env.ts` that reads env variables (API_URL, SUPABASE_URL, APP_ENV, ENABLE_DEV_TOOLS).
  - [x] 5.3 Created `mobile/src/config/features.ts` with feature flags (enableInteractiveMap, enableTripPhotos, enablePremiumBadges, etc.).
  - [x] 5.4 API client uses env.apiUrl from config instead of hardcoded URL.
  - [x] 5.5 Added note in api.ts and .env.example about iOS Simulator localhost limitation.

- [x] 6.0 Set up Jest and React Native Testing Library for smoke and component tests

  - [x] 6.1 Jest dependencies already in package.json (jest, @testing-library/react-native, jest-expo). Added babel-preset-expo.
  - [x] 6.2 jest.config.js already configured with jest-expo preset and moduleNameMapper for path aliases.
  - [x] 6.3 Created jest.setup.js with mocks for react-native-safe-area-context, react-native-screens, expo-secure-store.
  - [x] 6.4 Implemented smoke tests in `mobile/src/__tests__/App.smoke.test.tsx` for LoginScreen.
  - [x] 6.5 Added unit tests for Button (`Button.test.tsx`) and Input (`Input.test.tsx`) components.
  - [x] 6.6 Test script exists in package.json. All 19 tests pass: `npm test`.

## Summary

Phase 2 is **complete**. The mobile app now has:
- Full navigation structure (Auth -> Onboarding -> Main tabs with nested trips stack)
- Screen shells for all routes
- Reusable UI primitives (Screen, Text, Button, Input)
- API client with auth token handling
- React Query hooks for trips, profile, and countries
- Zustand auth store
- Environment configuration and feature flags
- 19 passing tests

Next steps (Phase 3): Implement actual auth flows with Supabase, full onboarding experience, and country selection.
