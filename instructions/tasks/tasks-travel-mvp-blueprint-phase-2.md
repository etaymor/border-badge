## Relevant Files

- `mobile/app.json` or `mobile/app.config.(js|ts)` - Expo app configuration (name, slug, bundle identifiers, runtime env) for the mobile client.
- `mobile/package.json` - Mobile app dependencies and scripts, including Expo, React Navigation, React Query, Jest, and React Native Testing Library.
- `mobile/tsconfig.json` - TypeScript configuration for the React Native app (paths, strictness, JSX settings).
- `mobile/src/App.tsx` - Root React Native component that wires the navigation container, providers (React Query, auth), and top-level layout.
- `mobile/src/navigation/index.tsx` - Navigation entry point that creates the root `NavigationContainer` and composes stacks/tabs (`docs/travel-mvp-blueprint.md` L281–288).
- `mobile/src/navigation/types.ts` - Route name and param list types for React Navigation, ensuring type-safe navigation.
- `mobile/src/screens/Auth/WelcomeScreen.tsx` - Shell for the initial welcome screen that routes into login, signup, or guest/onboarding per PRD flows (`docs/travel-prd.md` L209–221).
- `mobile/src/screens/Auth/LoginScreen.tsx` - Shell for the login screen (full auth behavior implemented in Phase 3).
- `mobile/src/screens/Auth/SignupScreen.tsx` - Shell for the signup screen (full auth behavior implemented in Phase 3).
- `mobile/src/screens/Onboarding/MotivationScreen.tsx` - Shell for the motivation/personality tags screen (`docs/travel-prd.md` L217–221).
- `mobile/src/screens/Onboarding/CountrySelectionScreen.tsx` - Shell for country selection UI (visited + wishlist) per onboarding (`docs/travel-prd.md` L217–221, L233–241).
- `mobile/src/screens/Onboarding/ProgressSummaryScreen.tsx` - Shell for the passport progress summary screen (`docs/travel-prd.md` L217–221, L523–529).
- `mobile/src/screens/Tabs/PassportScreen.tsx` - Shell for the main passport grid home tab (`docs/travel-mvp-blueprint.md` L281–288).
- `mobile/src/screens/Tabs/TripsScreen.tsx` - Shell for trips list tab.
- `mobile/src/screens/Tabs/FriendsScreen.tsx` - Shell for friends/requests tab (social logic implemented in Phase 5).
- `mobile/src/screens/Tabs/ProfileScreen.tsx` - Shell for profile/settings tab.
- `mobile/src/components/ui/Button.tsx` - Shared button component following neutral “template iOS” styling (`docs/travel-mvp-blueprint.md` L296–300).
- `mobile/src/components/ui/Text.tsx` - Shared text/typography wrapper enforcing consistent fonts and sizes.
- `mobile/src/components/ui/Input.tsx` - Shared text input component with labels, errors, and accessibility hooks.
- `mobile/src/components/layout/Screen.tsx` - Shared screen wrapper handling safe area, padding, and background (`docs/travel-mvp-blueprint.md` L296–303).
- `mobile/src/theme/colors.ts` - Neutral color and spacing tokens to keep Phase 2 UI consistent and accessible (`docs/travel-prd.md` L223–231).
- `mobile/src/state/authStore.ts` or `mobile/src/state/authContext.tsx` - Minimal global store/context for auth token and user info (to be fully wired in Phase 3).
- `mobile/src/api/client.ts` - API client wrapping HTTP calls to `/auth`, `/countries`, `/user_countries`, `/trips`, `/entries`, `/media/*`, `/places` (`docs/travel-technical-design.md` L196–470).
- `mobile/src/api/hooks/useCountries.ts` - React Query hook for `/countries` (`docs/travel-technical-design.md` L234–244).
- `mobile/src/api/hooks/useUserCountries.ts` - Hook for `/user_countries` (`docs/travel-technical-design.md` L253–277).
- `mobile/src/api/hooks/useTrips.ts` - Hook scaffold for `/trips` (list and detail; `docs/travel-technical-design.md` L279–326).
- `mobile/src/api/hooks/useTripEntries.ts` - Hook scaffold for `/trips/:trip_id/entries` (`docs/travel-technical-design.md` L362–377).
- `mobile/src/config/env.ts` - Environment configuration helper for API base URL, Supabase URL, and feature flags (`docs/travel-mvp-blueprint.md` L315–323).
- `mobile/jest.config.(js|ts)` - Jest configuration for the mobile app (using `jest-expo` or equivalent preset).
- `mobile/src/__tests__/App.smoke.test.tsx` - Smoke test that renders `App` with providers and asserts the presence of core navigation structure.
- `mobile/src/components/ui/__tests__/Button.test.tsx` - Unit tests for the shared `Button` component.
- `mobile/src/components/layout/__tests__/Screen.test.tsx` - Unit tests for the shared `Screen` layout component.

### Notes

- Phase 2 is scoped to **navigation, screen shells, a minimal design system, and the data layer scaffolding**, not full end-to-end flows; most business logic and UX will land in Phases 3–5 (`docs/travel-mvp-blueprint.md` L277–325).
- Navigation and screen names should reflect the core flows described in the PRD onboarding and core experience sections (`docs/travel-prd.md` L209–221, L233–285).
- Use **Expo (managed workflow)** with TypeScript for the mobile app, and **React Navigation + React Query** for navigation and server state management; this aligns well with the API contracts in `docs/travel-technical-design.md` L196–470.
- Tests in this phase are **smoke and basic component tests** to ensure that navigation renders and core primitives behave sensibly; deeper E2E flows will be added in later phases.

## Tasks

- [ ] 1.0 Establish `mobile/` app structure with Expo and TypeScript

  - [ ] 1.1 Create a `mobile/` directory (if it does not exist) and initialize an Expo React Native app with TypeScript support, following the monorepo layout suggested in `docs/travel-mvp-blueprint.md` L166–171.
  - [ ] 1.2 Configure `mobile/app.json` or `mobile/app.config.(js|ts)` with the app name, slug, iOS bundle identifier, and a custom URL scheme that will be used later for auth and deep-links.
  - [ ] 1.3 Add core dependencies to `mobile/package.json`: React Navigation (core + stack + bottom-tabs), React Native Reanimated, React Query, Axios or a similar HTTP client, and basic testing libraries (Jest, React Native Testing Library).
  - [ ] 1.4 Set up `mobile/tsconfig.json` with strict type checking, JSX settings for React Native, and path aliases (e.g., `@screens`, `@components`, `@api`) to keep imports clean for junior developers.
  - [ ] 1.5 Verify that `expo start` runs and that a trivial “Hello, world” view renders on the iOS simulator before adding navigation and other complexity.

- [ ] 2.0 Implement navigation container with auth stack, onboarding stack, and main tab navigator

  - [ ] 2.1 Create `mobile/src/navigation/types.ts` defining TypeScript route name enums and param list types for: `AuthStack`, `OnboardingStack`, and `MainTabs` (Passport, Trips, Friends, Profile).
  - [ ] 2.2 Implement `mobile/src/navigation/index.tsx` that exports a `RootNavigator` wrapped in a `NavigationContainer`, using a bottom tab navigator for the main app and stack navigators for auth and onboarding (`docs/travel-mvp-blueprint.md` L281–288).
  - [ ] 2.3 Create placeholder screen components under `mobile/src/screens/Auth` for `WelcomeScreen`, `LoginScreen`, and `SignupScreen`; each should use the shared `Screen` layout and `Text` components and show simple placeholder content.
  - [ ] 2.4 Create placeholder onboarding screen components under `mobile/src/screens/Onboarding` for `MotivationScreen`, `CountrySelectionScreen`, and `ProgressSummaryScreen`, named and commented to match PRD flows (`docs/travel-prd.md` L217–221, L233–241).
  - [ ] 2.5 Create placeholder main tab screens under `mobile/src/screens/Tabs` for `PassportScreen`, `TripsScreen`, `FriendsScreen`, and `ProfileScreen`, each wired into the tab navigator with appropriate tab labels and icons (icons can be generic for now).
  - [ ] 2.6 In `mobile/src/App.tsx`, render the `RootNavigator` inside `NavigationContainer` and confirm that you can navigate between auth, onboarding, and main tabs using navigation actions (hard-code an initial route for now; auth logic will be refined in Phase 3).

- [ ] 3.0 Create shared UI primitives and a minimal neutral design system

  - [ ] 3.1 Add `mobile/src/theme/colors.ts` exporting a small set of neutral colors (white, black, grays) and spacing constants, ensuring contrast and tap targets align with accessibility guidance (`docs/travel-prd.md` L223–231).
  - [ ] 3.2 Implement `mobile/src/components/layout/Screen.tsx` as a reusable layout wrapper using `SafeAreaView` or `SafeAreaProvider`, basic padding, scroll behavior, and a consistent background color (`docs/travel-mvp-blueprint.md` L296–303).
  - [ ] 3.3 Implement `mobile/src/components/ui/Text.tsx` as a wrapper around React Native `Text` that supports variants (e.g., `title`, `subtitle`, `body`, `caption`) and uses consistent font sizes, weights, and colors derived from the theme.
  - [ ] 3.4 Implement `mobile/src/components/ui/Button.tsx` with primary and secondary variants, disabled/loading states, and a minimum height/touch area of at least 44px to meet accessibility requirements (`docs/travel-prd.md` L223–231).
  - [ ] 3.5 Implement `mobile/src/components/ui/Input.tsx` wrapping `TextInput` with labels, helper/error text, and props for keyboard type, secure entry, and accessibility labels.
  - [ ] 3.6 Refactor the auth, onboarding, and tab screen shells created in Task 2.0 to exclusively use `Screen`, `Text`, `Button`, and `Input` primitives instead of raw React Native components, so future visual polish (Phase 8) can be done centrally.

- [ ] 4.0 Implement API client and React Query–based data layer scaffolding

  - [ ] 4.1 Install and configure React Query in the mobile app, creating a `QueryClient` and wrapping the app in `QueryClientProvider` at the top level (`mobile/src/App.tsx`), with sensible defaults for retries and stale times.
  - [ ] 4.2 Create `mobile/src/config/env.ts` (or similar) that reads environment variables for API base URL and environment (dev/prod), consistent with the backend endpoints described in `docs/travel-technical-design.md` L196–470 and blueprint Phase 2 (`docs/travel-mvp-blueprint.md` L315–323).
  - [ ] 4.3 Implement `mobile/src/api/client.ts` that centralizes HTTP logic using `fetch` or Axios: configure base URL from `env`, set JSON headers, and attach an Authorization header using a token from `authStore` (when available).
  - [ ] 4.4 Create a minimal auth store or context in `mobile/src/state/authStore.ts` or `authContext.tsx` that can hold `accessToken` and basic user info, with stubbed `login`/`logout` methods (actual wiring to `/auth` is handled in Phase 3).
  - [ ] 4.5 Implement React Query hooks in `mobile/src/api/hooks/useCountries.ts` and `useUserCountries.ts` that call `/countries` and `/user_countries` respectively, using the response shapes from `docs/travel-technical-design.md` L234–279.
  - [ ] 4.6 Implement scaffold hooks `useTrips.ts` and `useTripEntries.ts` that call `/trips` and `/trips/:trip_id/entries` per `docs/travel-technical-design.md` L279–377, even if they are only used in simple debug UIs or logs in this phase.
  - [ ] 4.7 Add basic error and loading state handling to these hooks (e.g., return `isLoading`, `isError`, `error` objects) and ensure the hooks surface enough information for future screens in Phases 3 and 4.

- [ ] 5.0 Wire environment configuration and basic feature flags

  - [ ] 5.1 Decide on an environment configuration strategy for Expo (e.g., `app.config.(js|ts)` `extra` fields or dotenv with `expo-env`-style tooling) and document expected variables like `API_BASE_URL`, `ENVIRONMENT`, and `FEATURE_PAYWALL_ENABLED`.
  - [ ] 5.2 Implement `mobile/src/config/env.ts` so it reads and validates these environment variables at startup, throwing a clear error in development if any required values are missing.
  - [ ] 5.3 Expose a small `featureFlags` object (e.g., `isPaywallEnabled`, `isAnalyticsEnabled`) from the env module so Phase 6 can toggle behavior without code changes (`docs/travel-prd.md` L317–323, L349–359).
  - [ ] 5.4 Update `mobile/src/api/client.ts` and any other modules that make network calls to use `env.API_BASE_URL` rather than hard-coded URLs.
  - [ ] 5.5 Add a simple debug display (e.g., a developer-only panel or console logs) that prints the current environment and base URL when running in development mode to help junior developers verify configuration.

- [ ] 6.0 Set up Jest and React Native Testing Library for smoke and component tests

  - [ ] 6.1 Add Jest-related dev dependencies to `mobile/package.json` (e.g., `jest`, `@testing-library/react-native`, `@testing-library/jest-native`, `jest-expo` or `expo-jest`, `react-test-renderer`) and ensure versions are compatible with the Expo SDK.
  - [ ] 6.2 Create `mobile/jest.config.(js|ts)` using the `jest-expo` (or equivalent) preset, setting up moduleNameMapper to resolve TypeScript path aliases and a `setupFilesAfterEnv` entry for test initialization.
  - [ ] 6.3 Add a `mobile/src/setupTests.ts` (or similar) that configures React Native Testing Library, extends Jest with `jest-native` matchers, and mocks React Native/Expo modules that do not work in a Node test environment (e.g., `react-native-reanimated`, `expo-linking`).
  - [ ] 6.4 Implement `mobile/src/__tests__/App.smoke.test.tsx` that renders `App` wrapped with providers (navigation, React Query, auth) and asserts that core screens (e.g., the initial stack and tab names) render without throwing.
  - [ ] 6.5 Add small unit tests for `Button` and `Screen` in `mobile/src/components/ui/__tests__/Button.test.tsx` and `mobile/src/components/layout/__tests__/Screen.test.tsx`, verifying basic rendering, press handling, and layout behavior.
  - [ ] 6.6 Add a `"test"` script to `mobile/package.json` (e.g., `"test": "jest"`) and run the suite to confirm all Phase 2 tests pass before moving on to feature-specific phases.


