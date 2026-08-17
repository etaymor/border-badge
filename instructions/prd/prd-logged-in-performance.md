# Logged-In Performance Improvements PRD

## Introduction/Overview
The logged-in experience currently feels clunky, with noticeable jank in trips, photo import, and navigation flows. This project focuses on improving perceived and actual performance across core authenticated journeys so the app feels premium, responsive, and stable even on large datasets (many trips, large photo libraries, heavy entry lists).

## Goals
- Reduce UI jank and frame drops in trips and photo import flows.
- Decrease time-to-interactive on trips list and trip detail screens.
- Minimize unnecessary data refetches and heavy computations during navigation.
- Keep memory usage stable during large photo imports and release memory promptly on exit.

## User Stories
- As a logged-in user, I want the Trips list to load quickly and scroll smoothly so I can browse my trips without lag.
- As a user opening a trip, I want entries to appear quickly with smooth scrolling, even for large trips.
- As a user importing photos, I want the scan and suggestions screens to remain responsive with no UI freezes.
- As a user switching tabs or returning to previous screens, I want navigation to feel instant and preserve my place.

## Functional Requirements
1. Trip and entry query invalidations must be scoped to affected IDs and avoid broad cache invalidation.
2. Trip detail entries must load incrementally (pagination/infinite scrolling) instead of fetching all entries at once.
3. Trips list must not load the full photo cache on initial mount; photo trip data should load lazily or on demand.
4. Trip list item components (including list headers) must be memoized and avoid per-render formatting work.
5. Photo import suggestion building must avoid recreating large Maps and repeated Set checks during render.
6. Photo import lists must include FlashList performance props (`estimatedItemSize`, `getItemType`).
7. Large photo import lookup Maps should live in refs where possible; state updates should be minimal and explicit.
8. Suggestion analytics should avoid full-array recomputation on every suggestion change.
9. Tab presses must preserve stack state (avoid full stack resets) to prevent remounts and refetches.
10. Passport list rendering must allow view recycling for smoother scrolling.
11. Core data (countries, user countries, trips) should use tuned `staleTime` and be prefetched after login.
12. Hero and large images must load progressively with placeholders to avoid blocking layout.
13. Performance instrumentation must capture key screen timings and high-memory events for validation.

## Non-Goals (Out of Scope)
- New features or visual redesign beyond performance-oriented improvements.
- Backend API changes or new endpoints (unless required for pagination or caching).
- Share extension behavior changes (except if it directly impacts logged-in performance).
- Analytics schema redesign beyond adding performance-related events.

## Design Considerations (Optional)
- Maintain premium feel with smooth transitions and minimal loading flashes.
- Use existing design system (colors/typography) for any new loading indicators or placeholders.
- Prefer subtle skeletons or shimmer placeholders over spinners for heavy lists.

## Technical Considerations (Optional)
- Trips/entries data fetch and invalidation logic: `mobile/src/hooks/useTrips.ts`, `mobile/src/hooks/useEntries.ts`.
- Trip screens: `mobile/src/screens/trips/TripsListScreen.tsx`, `mobile/src/screens/trips/TripDetailScreen.tsx`.
- Trip list components: `mobile/src/components/ui/TripCard.tsx`, `mobile/src/screens/lists/TripListsScreen.tsx`.
- Photo import workflow and lists: `mobile/src/screens/photos/PhotoImportScreen.tsx`, `mobile/src/screens/photos/usePhotoImportWorkflow.ts`, `mobile/src/screens/photos/usePlaceSuggestions.ts`.
- Navigation and Passport list rendering: `mobile/src/navigation/MainTabNavigator.tsx`, `mobile/src/screens/passport/PassportScreen.tsx`, `mobile/src/hooks/usePassportData.ts`.
- Consider `useDeferredValue` or `InteractionManager` for heavy filter/search work in passport and trips.
- Ensure large in-memory Maps are cleared on unmount and avoid storing them in state when not needed.

## Success Metrics
- Establish baseline for TripsList and TripDetail time-to-interactive, then improve by at least 30%.
- Reduce visible frame drops during trips and photo import scrolling to under 1% of frames.
- Avoid memory growth over time in photo import; memory should return to baseline after exit.
- Reduce redundant network requests for trips/entries by 50% on common flows.

## Open Questions
- What is the primary target device profile (latest iPhone vs older devices)?
- What is the expected size of photo libraries to target (5k, 10k, 20k+ GPS photos)?
- Are there specific flows that feel worst in practice that should be prioritized?
- Should we instrument performance metrics with a specific analytics provider or internal logging?
