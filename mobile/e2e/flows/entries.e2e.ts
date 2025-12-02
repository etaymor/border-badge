/**
 * E2E tests for entry management
 * Note: Media tests are skipped per user request
 */

import {
  element,
  by,
  expect,
  waitFor,
  testData,
  signUp,
  clearAppState,
  completeOnboarding,
  navigateToTab,
  createTrip,
  waitForEither,
} from '../init';

describe('Entry Flow', () => {
  let tripName: string;

  beforeAll(async () => {
    // Create fresh user, complete onboarding, and create a trip
    await clearAppState();
    const email = testData.uniqueEmail();
    await signUp(email, testData.testPassword);
    await completeOnboarding();

    // Create a trip to add entries to
    tripName = testData.uniqueTripName();
    await createTrip(tripName);
  });

  describe('Create Entry', () => {
    beforeEach(async () => {
      // Navigate to trip detail and add entry
      await navigateToTab('trips');
      await element(by.text(tripName)).tap();
      await waitFor(element(by.id('add-entry-button')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('creates entry with title and type', async () => {
      const entryName = testData.uniqueEntryName();

      // Tap add entry
      await element(by.id('add-entry-button')).tap();

      // Wait for form
      await waitFor(element(by.id('entry-title-input')))
        .toBeVisible()
        .withTimeout(5000);

      // Select entry type (Food)
      await element(by.id('entry-type-food')).tap();

      // Fill title
      await element(by.id('entry-title-input')).typeText(entryName);

      // Save
      await element(by.id('entry-save-button')).tap();

      // Navigate to entries list to verify
      await waitFor(element(by.id('view-entries-button')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.id('view-entries-button')).tap();

      // Verify entry appears
      await waitFor(element(by.text(entryName)))
        .toBeVisible()
        .withTimeout(10000);
    });

    it('creates entry with notes', async () => {
      const entryName = testData.uniqueEntryName();
      const notes = 'This was an amazing experience!';

      await element(by.id('add-entry-button')).tap();
      await waitFor(element(by.id('entry-title-input')))
        .toBeVisible()
        .withTimeout(5000);

      // Select Experience type
      await element(by.id('entry-type-experience')).tap();

      // Fill title and notes
      await element(by.id('entry-title-input')).typeText(entryName);
      await element(by.id('entry-notes-input')).typeText(notes);

      // Save
      await element(by.id('entry-save-button')).tap();

      // Verify
      await waitFor(element(by.id('view-entries-button')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.id('view-entries-button')).tap();
      await waitFor(element(by.text(entryName)))
        .toBeVisible()
        .withTimeout(10000);
    });

    it('creates entry with manual place entry', async () => {
      const entryName = testData.uniqueEntryName();
      const placeName = 'My Favorite Restaurant';
      const placeAddress = '123 Main St, Tokyo, Japan';

      await element(by.id('add-entry-button')).tap();
      await waitFor(element(by.id('entry-title-input')))
        .toBeVisible()
        .withTimeout(5000);

      // Select Place type
      await element(by.id('entry-type-place')).tap();

      // Fill title
      await element(by.id('entry-title-input')).typeText(entryName);

      // Places search - type to trigger manual entry option
      await element(by.id('places-search-input')).typeText('xyz');

      // Wait for "Enter manually" option
      await waitFor(element(by.text('Enter manually')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.text('Enter manually')).tap();

      // Fill manual place details
      await waitFor(element(by.id('places-search-manual-name')))
        .toBeVisible()
        .withTimeout(3000);
      await element(by.id('places-search-manual-name')).typeText(placeName);
      await element(by.id('places-search-manual-address')).typeText(placeAddress);
      await element(by.id('places-search-manual-submit')).tap();

      // Save entry
      await element(by.id('entry-save-button')).tap();

      // Verify
      await waitFor(element(by.id('view-entries-button')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.id('view-entries-button')).tap();
      await waitFor(element(by.text(entryName)))
        .toBeVisible()
        .withTimeout(10000);
    });

    it('shows validation error for empty title', async () => {
      await element(by.id('add-entry-button')).tap();
      await waitFor(element(by.id('entry-title-input')))
        .toBeVisible()
        .withTimeout(5000);

      // Try to save without title
      await element(by.id('entry-save-button')).tap();

      // Should show error (use testID for resilience against text changes)
      await waitFor(element(by.id('error-title-required')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('shows validation error for place entry without location', async () => {
      await element(by.id('add-entry-button')).tap();
      await waitFor(element(by.id('entry-title-input')))
        .toBeVisible()
        .withTimeout(5000);

      // Select Place type
      await element(by.id('entry-type-place')).tap();

      // Fill title but no place
      await element(by.id('entry-title-input')).typeText('Test Entry');

      // Try to save
      await element(by.id('entry-save-button')).tap();

      // Should show error about location (use testID for resilience against text changes)
      await waitFor(element(by.id('error-location-required')))
        .toBeVisible()
        .withTimeout(5000);
    });
  });

  describe('Entry Types', () => {
    beforeEach(async () => {
      await navigateToTab('trips');
      await element(by.text(tripName)).tap();
      await waitFor(element(by.id('add-entry-button')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.id('add-entry-button')).tap();
      await waitFor(element(by.id('entry-title-input')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('can create Place type entry', async () => {
      await element(by.id('entry-type-place')).tap();
      // Place type requires location
      await expect(element(by.id('places-search-input'))).toBeVisible();
    });

    it('can create Food type entry', async () => {
      await element(by.id('entry-type-food')).tap();
      // Food type also requires location
      await expect(element(by.id('places-search-input'))).toBeVisible();
    });

    it('can create Stay type entry', async () => {
      await element(by.id('entry-type-stay')).tap();
      // Stay type requires location
      await expect(element(by.id('places-search-input'))).toBeVisible();
    });

    it('can create Experience type entry', async () => {
      await element(by.id('entry-type-experience')).tap();
      // Experience type does NOT require location
      // Save button should work without location
      const entryName = testData.uniqueEntryName();
      await element(by.id('entry-title-input')).typeText(entryName);
      await element(by.id('entry-save-button')).tap();

      // Should save successfully
      await waitFor(element(by.id('view-entries-button')))
        .toBeVisible()
        .withTimeout(10000);
    });
  });

  describe('View Entries', () => {
    it('shows empty state when no entries', async () => {
      // Create a new trip with no entries
      const emptyTripName = testData.uniqueTripName();
      await createTrip(emptyTripName);

      // Navigate to trip and view entries
      await navigateToTab('trips');
      await element(by.text(emptyTripName)).tap();
      await waitFor(element(by.id('view-entries-button')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.id('view-entries-button')).tap();

      // Should see empty state
      await waitFor(element(by.id('empty-add-entry-button')))
        .toBeVisible()
        .withTimeout(5000);
      await expect(element(by.text('No entries yet'))).toBeVisible();
    });

    it('shows entries list with FAB', async () => {
      // Navigate to trip with entries
      await navigateToTab('trips');
      await element(by.text(tripName)).tap();
      await waitFor(element(by.id('view-entries-button')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.id('view-entries-button')).tap();

      // Should see entries list and FAB
      await waitForEither(by.id('entries-list'), by.id('fab-add-entry'), 10000);
    });
  });
});
