# Trips create

An onboarded user creates a trip with a name and sees it on the trips list.

## Sub-features

- `trip-create-name` — save named trip from FAB or empty state.
- `trip-create-dates` — optional date fields (see full `e2e/flows/trips.e2e.ts`).
- `trip-delete` — delete from trip detail (separate spec examples in repo).

## How to get to it (user POV)

- Complete signup + onboarding → **Trips** tab → tap **+** (FAB `fab-add-trip` or empty `empty-add-trip-button`) → enter name → save.

## Driving it with Detox

Preconditions:

- Doctor passes.
- Test suite calls `clearAppState()`, `signUp()`, `completeOnboarding()` in `beforeAll` (`e2e/flows/trips.e2e.ts`).

- **Navigate to trips.** `navigateToTab('trips')`.
- **Add trip.** `tapAddButton('trip')` — tries `fab-add-trip` then `empty-add-trip-button`.
- **Fill and save.** Type into `trip-name-input`, tap `trip-save-button`.
- **Observe list.** Trip name text visible; or `trips-list` container visible.
- **Drive.** Run `bash .cursor/skills/verify-atlasi/scripts/drive.sh trips-create`.
- **Proof.** `creates a trip with name` passes; `drive.log` + screenshot on failure.

## Gotchas

- Onboarding is long (carousel swipes + continent skips); failures often mean a skipped onboarding step ID changed.
- Free-tier limits may affect entry counts; trip creation itself is not gated at create time in E2E helpers.
- Trip names must be unique when re-running against a persistent simulator without `clearAppState`.
