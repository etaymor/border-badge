/**
 * E2E tests for trip management
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
  waitForEither,
} from '../init';

describe('Trip Flow', () => {
  beforeAll(async () => {
    // Create fresh user and complete onboarding
    await clearAppState();
    const email = testData.uniqueEmail();
    await signUp(email, testData.testPassword);
    await completeOnboarding();
  });

  beforeEach(async () => {
    // Ensure we're on the trips tab
    await navigateToTab('trips');
  });

  describe('Create Trip', () => {
    it('creates a trip with name', async () => {
      const tripName = testData.uniqueTripName();

      // Tap add button (FAB or empty state)
      try {
        await element(by.id('fab-add-trip')).tap();
      } catch {
        await element(by.id('empty-add-trip-button')).tap();
      }

      // Wait for form
      await waitFor(element(by.id('trip-name-input')))
        .toBeVisible()
        .withTimeout(5000);

      // Fill trip name
      await element(by.id('trip-name-input')).typeText(tripName);

      // Save
      await element(by.id('trip-save-button')).tap();

      // Should navigate back to trips list
      await waitForEither(by.id('trips-list'), by.text(tripName), 10000);

      // Verify trip appears in list
      await expect(element(by.text(tripName))).toBeVisible();
    });

    it('creates a trip with dates', async () => {
      const tripName = testData.uniqueTripName();

      // Tap add button
      try {
        await element(by.id('fab-add-trip')).tap();
      } catch {
        await element(by.id('empty-add-trip-button')).tap();
      }

      // Fill form
      await element(by.id('trip-name-input')).typeText(tripName);
      await element(by.id('trip-start-date-input')).typeText('2024-01-01');
      await element(by.id('trip-end-date-input')).typeText('2024-01-07');

      // Save
      await element(by.id('trip-save-button')).tap();

      // Verify trip is created
      await waitFor(element(by.text(tripName)))
        .toBeVisible()
        .withTimeout(10000);
    });

    it('shows validation error for empty name', async () => {
      // Tap add button
      try {
        await element(by.id('fab-add-trip')).tap();
      } catch {
        await element(by.id('empty-add-trip-button')).tap();
      }

      // Try to save without name
      await element(by.id('trip-save-button')).tap();

      // Should show error
      await waitFor(element(by.text('Trip name is required')))
        .toBeVisible()
        .withTimeout(5000);
    });
  });

  describe('View Trip Details', () => {
    let tripName: string;

    beforeAll(async () => {
      // Create a trip for testing
      tripName = testData.uniqueTripName();
      await navigateToTab('trips');

      try {
        await element(by.id('fab-add-trip')).tap();
      } catch {
        await element(by.id('empty-add-trip-button')).tap();
      }

      await element(by.id('trip-name-input')).typeText(tripName);
      await element(by.id('trip-save-button')).tap();
      await waitFor(element(by.text(tripName)))
        .toBeVisible()
        .withTimeout(10000);
    });

    it('navigates to trip detail from list', async () => {
      await navigateToTab('trips');

      // Tap on trip card
      await element(by.text(tripName)).tap();

      // Should see trip detail screen with action buttons
      await waitFor(element(by.id('view-entries-button')))
        .toBeVisible()
        .withTimeout(5000);
      await expect(element(by.id('add-entry-button'))).toBeVisible();
      await expect(element(by.id('edit-trip-button'))).toBeVisible();
      await expect(element(by.id('delete-trip-button'))).toBeVisible();
    });

    it('shows entry count on trip detail', async () => {
      await navigateToTab('trips');
      await element(by.text(tripName)).tap();

      // Should see entries count (0 initially)
      await waitFor(element(by.text('0')))
        .toBeVisible()
        .withTimeout(5000);
    });
  });

  describe('Edit Trip', () => {
    let tripName: string;

    beforeAll(async () => {
      // Create a trip for editing
      tripName = testData.uniqueTripName();
      await navigateToTab('trips');

      try {
        await element(by.id('fab-add-trip')).tap();
      } catch {
        await element(by.id('empty-add-trip-button')).tap();
      }

      await element(by.id('trip-name-input')).typeText(tripName);
      await element(by.id('trip-save-button')).tap();
      await waitFor(element(by.text(tripName)))
        .toBeVisible()
        .withTimeout(10000);
    });

    it('edits trip name', async () => {
      await navigateToTab('trips');

      // Navigate to trip detail
      await element(by.text(tripName)).tap();
      await waitFor(element(by.id('edit-trip-button')))
        .toBeVisible()
        .withTimeout(5000);

      // Tap edit
      await element(by.id('edit-trip-button')).tap();

      // Should see edit form with existing name
      await waitFor(element(by.id('trip-name-input')))
        .toBeVisible()
        .withTimeout(5000);

      // Clear and update name
      await element(by.id('trip-name-input')).clearText();
      const newName = tripName + ' Updated';
      await element(by.id('trip-name-input')).typeText(newName);

      // Save
      await element(by.id('trip-save-button')).tap();

      // Navigate back to trips list
      await navigateToTab('trips');

      // Verify updated name appears
      await waitFor(element(by.text(newName)))
        .toBeVisible()
        .withTimeout(10000);

      // Update reference for cleanup
      tripName = newName;
    });
  });

  describe('Delete Trip', () => {
    let tripName: string;

    beforeEach(async () => {
      // Create a fresh trip for each delete test
      tripName = testData.uniqueTripName();
      await navigateToTab('trips');

      try {
        await element(by.id('fab-add-trip')).tap();
      } catch {
        await element(by.id('empty-add-trip-button')).tap();
      }

      await element(by.id('trip-name-input')).typeText(tripName);
      await element(by.id('trip-save-button')).tap();
      await waitFor(element(by.text(tripName)))
        .toBeVisible()
        .withTimeout(10000);
    });

    it('shows delete confirmation dialog', async () => {
      // Navigate to trip detail
      await element(by.text(tripName)).tap();
      await waitFor(element(by.id('delete-trip-button')))
        .toBeVisible()
        .withTimeout(5000);

      // Tap delete
      await element(by.id('delete-trip-button')).tap();

      // Should show confirmation dialog
      await waitFor(element(by.text('Delete Trip')))
        .toBeVisible()
        .withTimeout(3000);
      await expect(element(by.id('delete-trip-dialog-confirm'))).toBeVisible();
      await expect(element(by.id('delete-trip-dialog-cancel'))).toBeVisible();

      // Cancel deletion
      await element(by.id('delete-trip-dialog-cancel')).tap();

      // Trip should still be visible
      await expect(element(by.id('delete-trip-button'))).toBeVisible();
    });

    it('deletes trip and shows undo snackbar', async () => {
      // Navigate to trip detail
      await element(by.text(tripName)).tap();
      await waitFor(element(by.id('delete-trip-button')))
        .toBeVisible()
        .withTimeout(5000);

      // Tap delete
      await element(by.id('delete-trip-button')).tap();

      // Confirm deletion
      await waitFor(element(by.id('delete-trip-dialog-confirm')))
        .toBeVisible()
        .withTimeout(3000);
      await element(by.id('delete-trip-dialog-confirm')).tap();

      // Should show undo snackbar
      await waitFor(element(by.id('trip-deleted-snackbar')))
        .toBeVisible()
        .withTimeout(3000);

      // Navigate to trips list
      await navigateToTab('trips');

      // Trip should no longer appear (after snackbar dismisses)
      await waitFor(element(by.text(tripName)))
        .not.toBeVisible()
        .withTimeout(10000);
    });

    it('restores trip on undo', async () => {
      // Navigate to trip detail
      await element(by.text(tripName)).tap();
      await waitFor(element(by.id('delete-trip-button')))
        .toBeVisible()
        .withTimeout(5000);

      // Delete
      await element(by.id('delete-trip-button')).tap();
      await waitFor(element(by.id('delete-trip-dialog-confirm')))
        .toBeVisible()
        .withTimeout(3000);
      await element(by.id('delete-trip-dialog-confirm')).tap();

      // Tap undo on snackbar
      await waitFor(element(by.id('trip-deleted-snackbar-action')))
        .toBeVisible()
        .withTimeout(3000);
      await element(by.id('trip-deleted-snackbar-action')).tap();

      // Navigate to trips list
      await navigateToTab('trips');

      // Trip should be restored
      await waitFor(element(by.text(tripName)))
        .toBeVisible()
        .withTimeout(10000);
    });
  });
});
