# Passport Loading Flash Fix

## Tasks
- [x] Stabilize `useUserCountries` fallback during migration (prefer SQLite, avoid empty API flashes)
- [x] Adjust passport loading/skeleton logic to hide empty states until data ready
- [x] Add tests for migration + loading behavior
- [x] Verify: run targeted tests/lint for touched areas

## Relevant Files
- `mobile/src/hooks/useUserCountries.ts` — user countries with SQLite + API merge
- `mobile/src/hooks/usePassportData.ts` — passport data/loading computation
- `mobile/src/__tests__/hooks/useUserCountries.test.tsx` — coverage for migration and fallback
