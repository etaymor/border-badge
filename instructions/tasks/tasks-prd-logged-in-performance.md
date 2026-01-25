## Relevant Files

- `mobile/src/hooks/useTrips.ts` - Trip queries and cache invalidation logic to scope updates.
- `mobile/src/hooks/useEntries.ts` - Entry queries, pagination, and cache keys.
- `mobile/src/screens/trips/TripsListScreen.tsx` - Trips list loading, header rendering, and performance.
- `mobile/src/screens/trips/TripDetailScreen.tsx` - Trip detail entries list and loading strategy.
- `mobile/src/components/ui/TripCard.tsx` - Trip list card rendering and memoization targets.
- `mobile/src/screens/lists/TripListsScreen.tsx` - Shared lists rendering and list item memoization.
- `mobile/src/screens/photos/PhotoImportScreen.tsx` - Photo import list rendering and FlashList configuration.
- `mobile/src/screens/photos/usePhotoImportWorkflow.ts` - Workflow state, large Maps handling, analytics counts.
- `mobile/src/screens/photos/usePlaceSuggestions.ts` - Suggestion request batching and coordinate truncation.
- `mobile/src/hooks/usePhotoTrips.ts` - Photo cache loading and segmentation strategy.
- `mobile/src/navigation/MainTabNavigator.tsx` - Tab press behavior and navigation preservation.
- `mobile/src/screens/passport/PassportScreen.tsx` - FlatList config and view recycling.
- `mobile/src/hooks/usePassportData.ts` - Heavy filtering/sorting and memoization work.
- `mobile/src/assets/countryImages.ts` - Image loading strategy considerations.
- `mobile/src/services/analytics.ts` - Performance instrumentation events (if added).
- `mobile/src/screens/trips/TripDetailScreen.test.tsx` - Tests for trip detail pagination behavior (to add).
- `mobile/src/hooks/useTrips.test.ts` - Tests for scoped invalidations (to add).

### Notes

- Unit tests should typically be placed alongside the code files they are testing (e.g., `MyComponent.tsx` and `MyComponent.test.tsx` in the same directory).
- Use `npx jest [optional/path/to/test/file]` to run tests. Running without a path executes all tests found by the Jest configuration.

## Tasks

- [x] 1.0 Optimize trips/entries data fetching and invalidation scopes
- [x] 1.1 Scope trip invalidations to affected query keys only (create/update/delete/restore).
- [x] 1.2 Narrow entry invalidations on move/bulk move to source/target trip IDs.
- [x] 1.3 Add/tune `staleTime` and `gcTime` for trips and entries queries where safe.
- [ ] 1.4 Audit and consolidate duplicate data fetches in trips-related screens.
- [x] 2.0 Introduce incremental loading and list virtualization improvements
- [x] 2.1 Replace `useEntries` with `useInfiniteEntries` in trip detail and wire pagination.
- [x] 2.2 Add list optimizations (estimated sizes, item types, render thresholds) for trips lists.
- [x] 2.3 Memoize trip list items, headers, and formatting helpers to reduce re-renders.
- [x] 2.4 Verify empty/loading states do not cause extra layout passes or flashes.
- [x] 3.0 Reduce photo import memory/computation overhead
- [x] 3.1 Move large lookup Maps to refs and minimize state updates from them.
- [x] 3.2 Optimize suggestion merging to avoid per-render Map builds and Set checks.
- [x] 3.3 Add FlashList perf props (`estimatedItemSize`, `getItemType`) in import lists.
- [x] 3.4 Reduce repeated analytics recomputation for suggestion counts.
- [ ] 3.5 Review coordinate truncation and batching for suggestion requests.
- [x] 4.0 Improve navigation and image-loading performance
- [x] 4.1 Preserve tab stacks on tab press (avoid full stack resets).
- [x] 4.2 Enable view recycling on Passport list (`removeClippedSubviews`).
- [x] 4.3 Add progressive loading/placeholder strategy for hero and large images.
- [ ] 4.4 Consider prefetching core data after login to reduce first-screen latency.
- [ ] 5.0 Add performance instrumentation and validation steps
- [ ] 5.1 Define baseline metrics (TTI for TripsList/TripDetail, scroll FPS, memory).
- [ ] 5.2 Add instrumentation events around key screens and long operations.
- [ ] 5.3 Validate improvements on-device and record before/after results.
