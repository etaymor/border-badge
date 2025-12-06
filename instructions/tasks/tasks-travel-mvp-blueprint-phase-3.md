## Relevant Files

- `mobile/src/App.tsx` - Root app component; orchestrates whether the user sees auth, onboarding, or main tabs based on session and onboarding completion state.
- `mobile/src/navigation/index.tsx` - Navigation configuration that wires together the auth stack, onboarding stack, and main tab navigator (`docs/travel-mvp-blueprint.md` L281–288).
- `mobile/src/navigation/types.ts` - Typed route and param lists for auth, onboarding, and main tab navigators.
- `mobile/src/state/authStore.ts` or `mobile/src/state/authContext.tsx` - Global auth/session store responsible for holding `accessToken`, current user, and auth status (`loggedOut`, `guest`, `authenticated`).
- `mobile/src/state/onboardingStore.ts` - Store for temporary onboarding data such as motivation tags, selected countries, and current onboarding step.
- `mobile/src/screens/Auth/WelcomeScreen.tsx` - Entry screen handling “Continue as guest”, “Log in”, and “Sign up” choices (`docs/travel-prd.md` L209–221).
- `mobile/src/screens/Auth/LoginScreen.tsx` - Login screen wired to `/auth/login` per `docs/travel-technical-design.md` L224–232.
- `mobile/src/screens/Auth/SignupScreen.tsx` - Signup screen wired to `/auth/signup` per `docs/travel-technical-design.md` L198–220.
- `mobile/src/screens/Onboarding/MotivationScreen.tsx` - Motivation/personality tag selection UI corresponding to PRD onboarding screen 2 (`docs/travel-prd.md` L217–221).
- `mobile/src/screens/Onboarding/CountrySelectionScreen.tsx` - Onboarding flow screen(s) for current country, dream destination, and continent grid selection (`docs/travel-prd.md` L217–221, L233–241, L277–279).
- `mobile/src/screens/Onboarding/ProgressSummaryScreen.tsx` - Summary + reveal screen for passport progress (visited count, wishlist count, percentage) (`docs/travel-prd.md` L217–221, L523–529).
- `mobile/src/screens/Tabs/PassportScreen.tsx` - Main passport grid tab, now backed by real `user_countries` data (`docs/travel-mvp-blueprint.md` L367–373).
- `mobile/src/api/client.ts` - HTTP client used to call `/auth`, `/countries`, `/user_countries` and attach auth tokens (`docs/travel-technical-design.md` L196–279).
- `mobile/src/api/hooks/useAuth.ts` - New hook that wraps `/auth/signup` and `/auth/login` and updates the auth store with tokens and user info.
- `mobile/src/api/hooks/useCountries.ts` - Hook for `/countries` search/region filtering, used in onboarding autocomplete and continent views (`docs/travel-technical-design.md` L234–244).
- `mobile/src/api/hooks/useUserCountries.ts` - Hook for `/user_countries` GET/POST to sync visited/wishlist selections, including guest migration (`docs/travel-technical-design.md` L253–277).
- `backend/app/api/auth.py` - Backend auth routes used by the mobile app; may require alignment with mobile expectations (error format, fields) per `docs/travel-technical-design.md` L198–232.
- `backend/app/api/countries.py` - Backend country and user-country routes used in onboarding (autocomplete, continent grids, and status updates).
- `mobile/src/__tests__/flows/AuthOnboardingFlow.test.tsx` - Integration-style test covering the core guest → signup → passport flow.
- `mobile/src/__tests__/hooks/useAuth.test.tsx` - Unit tests for the `useAuth` hook’s success and error paths.

### Notes

- Phase 3 is about delivering the **first compelling end-to-end user flow**: guest logs countries → signs up → sees passport grid and progress (`docs/travel-mvp-blueprint.md` L329–329).
- This phase implements key user stories: **US-001/002/019** (country + wishlist + progress) and **US-003/004** (auth) from `docs/travel-prd.md` L381–409, L523–529.
- Backend contracts for `/auth`, `/countries`, and `/user_countries` are defined in `docs/travel-technical-design.md` L198–279; the mobile app should rely on those interfaces and the shared error format in L486–495.
- Motivation/personality tags are stored locally during guest onboarding and then persisted as user metadata on signup, as described in `docs/travel-mvp-blueprint.md` L344–352.
- Aim for a smooth, low-friction onboarding experience; while detailed analytics are in Phase 6, this phase should keep performance within the P75 < 2.5s target mentioned in `docs/travel-prd.md` L317–321.

## Tasks

- [ ] 1.0 Wire mobile auth flows (login/signup) to backend `/auth` endpoints and manage session state
  - [ ] 1.1 Implement `mobile/src/api/hooks/useAuth.ts` that exposes `signup`, `login`, and `logout` functions, calling `/auth/signup` and `/auth/login` using `mobile/src/api/client.ts` and types matching `docs/travel-technical-design.md` L198–232.
  - [ ] 1.2 Extend `mobile/src/state/authStore.ts` (or `authContext.tsx`) to store `accessToken`, current user profile data, and an auth status enum (e.g., `unauthenticated`, `authenticating`, `authenticated`).
  - [ ] 1.3 Update `mobile/src/api/client.ts` so that it reads the latest `accessToken` from the auth store on each request and attaches it as an `Authorization: Bearer <token>` header for authenticated endpoints.
  - [ ] 1.4 Wire `LoginScreen` to `useAuth().login` so that submitting valid credentials calls `/auth/login`, updates the auth store on success, surfaces validation/error messages on failure, and navigates to the main app flow.
  - [ ] 1.5 Wire `SignupScreen` to `useAuth().signup` so that submitting valid fields calls `/auth/signup`, handles any verification/pending states described in `docs/travel-technical-design.md` L200–220, and then logs the user in (or prompts them appropriately).
  - [ ] 1.6 Ensure `App.tsx` or `RootNavigator` conditionally renders the auth stack vs onboarding/main tabs based on auth status from the auth store (e.g., unauthenticated → auth stack, authenticated but not onboarded → onboarding stack, authenticated and onboarded → main tabs).

- [ ] 2.0 Implement guest mode and guest → registered migration
  - [ ] 2.1 Update `WelcomeScreen` to present clear options for “Continue as Guest”, “Log in”, and “Sign up”, matching copy and intent from `docs/travel-prd.md` L209–221.
  - [ ] 2.2 When a user chooses “Continue as Guest”, set the auth status to a `guest` state in the auth store and navigate directly into the onboarding stack (starting at `MotivationScreen`).
  - [ ] 2.3 Implement `mobile/src/state/onboardingStore.ts` to hold guest-onboarding data: selected motivation/personality tags, visited countries, wishlist countries, and onboarding progress flags.
  - [ ] 2.4 Ensure onboarding screens read from and write to `onboardingStore` so that a guest can backtrack between steps without losing selections.
  - [ ] 2.5 Add logic to `useAuth().signup` so that, when called from a guest context, it triggers a **migration step** that posts all locally stored country selections to `/user_countries` (using `useUserCountries` or a dedicated helper), handling the response semantics in `docs/travel-technical-design.md` L253–277.
  - [ ] 2.6 After successful signup and migration, clear guest-only data from `onboardingStore` and mark a flag in the auth or onboarding store indicating that onboarding has been completed for this user.

- [ ] 3.0 Build motivation/personality tag onboarding screen and persist captured tags through signup
  - [ ] 3.1 Design the `MotivationScreen` UI to reflect the “Why I Travel” and “I Am A…” bubble-tag UX described in `docs/travel-prd.md` L217–221, using the shared `Screen`, `Text`, and `Button` components.
  - [ ] 3.2 Implement local state on `MotivationScreen` that allows selecting/deselecting tags, with clear visual feedback for selected vs unselected states.
  - [ ] 3.3 On continue/next, persist the selected tags into `onboardingStore` so they are available later at signup time and can survive navigation back/forward.
  - [ ] 3.4 Extend `useAuth().signup` to accept an optional metadata payload (e.g., motivation/personality tags) and ensure it is sent to the backend either as part of the signup request body or via a follow-up profile update call, consistent with how the backend stores user metadata in `docs/travel-technical-design.md` L178–193.
  - [ ] 3.5 Add validation and UX safeguards (e.g., at least one tag per category or a sensible default) so that the user cannot accidentally proceed without capturing meaningful preference data.

- [ ] 4.0 Implement onboarding country selection flow backed by `/countries` and `/user_countries`
  - [ ] 4.1 Extend `CountrySelectionScreen` to support the three onboarding steps from the PRD: current country autocomplete, dream destination autocomplete, and continent-based grid selection (`docs/travel-prd.md` L217–221, L233–241, L277–279).
  - [ ] 4.2 Use `useCountries` to power the autocomplete fields, wiring query text to the `search` parameter and, where applicable, region filters to the `region` parameter in `/countries` (`docs/travel-technical-design.md` L234–244).
  - [ ] 4.3 Implement continent grid views that group countries by region, allow toggling visited vs wishlist, and visually distinguish between the two statuses using neutral styles consistent with Phase 2.
  - [ ] 4.4 For guests, write country selections into `onboardingStore` only; for authenticated users, immediately persist selections via `useUserCountries` POST calls to `/user_countries` with the `status` field (`visited` or `wishlist`) as defined in `docs/travel-technical-design.md` L268–273.
  - [ ] 4.5 Implement optimistic updates for `user_countries` so that the UI reflects selections instantly while API calls are in-flight, resolving optimistic state based on success or error (e.g., 409 duplicate or 400 validation).
  - [ ] 4.6 Ensure that the onboarding flow properly advances from country selection to the progress summary only when required data (at least one visited country) is available, matching the intent of user stories US-001/002 in `docs/travel-prd.md` L381–393.

- [ ] 5.0 Implement passport summary and map reveal powered by `user_countries`
  - [ ] 5.1 Implement `ProgressSummaryScreen` to compute and display: total visited countries, wishlist count, and visited percentage out of ~195 countries, as described in `docs/travel-prd.md` L217–221 and L523–529.
  - [ ] 5.2 Use `useUserCountries` to fetch the current user’s countries after migration or onboarding is complete, and derive summary metrics directly from the response shape in `docs/travel-technical-design.md` L261–263.
  - [ ] 5.3 Add basic celebratory UX (e.g., simple text feedback or small confetti placeholder) when the user reaches the summary screen, keeping heavy visual polish (custom animations, final art) for Phase 8.
  - [ ] 5.4 Update `PassportScreen` in the main tabs to use the same `user_countries` data, ensuring that the grid view and the onboarding summary remain consistent in counts and status.
  - [ ] 5.5 Ensure performance of the summary and passport views by minimizing unnecessary re-queries (e.g., using React Query caching and appropriate `staleTime`) and keeping perceived latency within the P75 < 2.5s target (`docs/travel-prd.md` L317–321).

- [ ] 6.0 Add basic tests and instrumentation for the Phase 3 auth + onboarding + passport flow
  - [ ] 6.1 Create `mobile/src/__tests__/hooks/useAuth.test.tsx` to cover success and failure cases for `signup` and `login`, mocking the underlying HTTP client and verifying that the auth store is updated correctly on success and untouched on error.
  - [ ] 6.2 Add `mobile/src/__tests__/flows/AuthOnboardingFlow.test.tsx` that renders a test harness around `App`, steps through a simplified flow (guest → motivation → country selection → signup), and asserts that, at the end, the passport summary or main passport view is shown.
  - [ ] 6.3 Add smaller tests for `CountrySelectionScreen` to verify that toggling a country updates local state and, when authenticated, triggers a call to `/user_countries` with the correct `status` value.
  - [ ] 6.4 Add tests for `ProgressSummaryScreen` to ensure that given a mocked `user_countries` response, the correct visited and wishlist counts and percentages are displayed.
  - [ ] 6.5 Optionally, introduce a lightweight analytics or logging helper (e.g., `analytics.track(event, props)`) with a no-op implementation in this phase so that later phases (especially Phase 6) can attach real analytics without changing screen logic; log at least onboarding started/completed events to help with debugging.
  - [ ] 6.6 Run the mobile test suite (`cd mobile && npm test` or `npx jest`) and document any remaining gaps in coverage or known edge cases (e.g., offline onboarding) as TODOs in the tests or code comments for later phases.
