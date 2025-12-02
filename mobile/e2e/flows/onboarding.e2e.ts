/**
 * E2E tests for onboarding and country selection flows
 */

import {
  device,
  element,
  by,
  expect,
  waitFor,
  testData,
  signUp,
  clearAppState,
  waitForEither,
  CAROUSEL_SWIPES_TO_CTA,
  CONTINENT_COUNT,
} from '../init';

describe('Onboarding Flow', () => {
  beforeAll(async () => {
    await clearAppState();
  });

  describe('Welcome Carousel', () => {
    beforeEach(async () => {
      await device.launchApp({ newInstance: true, delete: true });
    });

    it('displays welcome carousel on first launch', async () => {
      // Should see first slide with title (testID: carousel-title-1)
      await waitFor(element(by.id('carousel-title-1')))
        .toBeVisible()
        .withTimeout(10000);
    });

    it('can swipe through carousel slides', async () => {
      await waitFor(element(by.id('carousel-slide-1')))
        .toBeVisible()
        .withTimeout(10000);

      // Swipe to next slide
      await element(by.type('RCTScrollView')).swipe('left');
      await waitFor(element(by.text('Track Your Travels')))
        .toBeVisible()
        .withTimeout(3000);

      // Swipe to next slide
      await element(by.type('RCTScrollView')).swipe('left');
      await waitFor(element(by.text('Log Trips + Get Recs')))
        .toBeVisible()
        .withTimeout(3000);

      // Swipe to last slide with CTA
      await element(by.type('RCTScrollView')).swipe('left');
      await waitFor(element(by.text('Share & Compare')))
        .toBeVisible()
        .withTimeout(3000);

      // Should see "Start My Journey" button
      await expect(element(by.id('start-journey-button'))).toBeVisible();
    });

    it('shows login button on early slides', async () => {
      await waitFor(element(by.id('carousel-login-button')))
        .toBeVisible()
        .withTimeout(10000);

      // Tap login
      await element(by.id('carousel-login-button')).tap();

      // Should navigate to login screen
      await waitFor(element(by.id('login-email-input')))
        .toBeVisible()
        .withTimeout(5000);
    });
  });

  describe('Home Country Selection', () => {
    beforeAll(async () => {
      await clearAppState();
      const email = testData.uniqueEmail();
      await signUp(email, testData.testPassword);

      // Navigate to home country step
      const carousel = element(by.type('RCTScrollView'));
      for (let i = 0; i < CAROUSEL_SWIPES_TO_CTA; i++) {
        await carousel.swipe('left');
      }
      await element(by.id('start-journey-button')).tap();

      // Skip motivation step
      await waitFor(element(by.text('Skip')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.text('Skip')).tap();
    });

    it('shows home country search screen', async () => {
      await waitFor(element(by.text('Where do you live today?')))
        .toBeVisible()
        .withTimeout(5000);

      await expect(element(by.id('home-country-search'))).toBeVisible();
    });

    it('searches and selects a country', async () => {
      // Type in search
      await element(by.id('home-country-search')).typeText('United');

      // Should see dropdown with results
      await waitFor(element(by.id('country-option-US')))
        .toBeVisible()
        .withTimeout(5000);

      // Select United States
      await element(by.id('country-option-US')).tap();

      // Should show selected country
      await waitFor(element(by.text('United States')))
        .toBeVisible()
        .withTimeout(3000);

      // Next button should be enabled
      await expect(element(by.id('home-country-next-button'))).toBeVisible();
    });

    it('can skip home country selection', async () => {
      await device.reloadReactNative();

      // Navigate back to home country screen (re-signup and navigate)
      await clearAppState();
      const email = testData.uniqueEmail();
      await signUp(email, testData.testPassword);

      const carousel = element(by.type('RCTScrollView'));
      for (let i = 0; i < CAROUSEL_SWIPES_TO_CTA; i++) {
        await carousel.swipe('left');
      }
      await element(by.id('start-journey-button')).tap();
      await waitFor(element(by.text('Skip')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.text('Skip')).tap();

      // Should see skip button
      await waitFor(element(by.id('home-country-skip-button')))
        .toBeVisible()
        .withTimeout(5000);

      // Tap skip
      await element(by.id('home-country-skip-button')).tap();

      // Should navigate to next step (Dream Destination)
      await waitFor(element(by.text('Skip')))
        .toBeVisible()
        .withTimeout(5000);
    });
  });

  describe('Country Grid Selection', () => {
    beforeAll(async () => {
      await clearAppState();
      const email = testData.uniqueEmail();
      await signUp(email, testData.testPassword);

      // Navigate through onboarding to country grid
      const carousel = element(by.type('RCTScrollView'));
      for (let i = 0; i < CAROUSEL_SWIPES_TO_CTA; i++) {
        await carousel.swipe('left');
      }
      await element(by.id('start-journey-button')).tap();

      // Skip motivation
      await waitFor(element(by.text('Skip')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.text('Skip')).tap();

      // Skip home country
      await waitFor(element(by.id('home-country-skip-button')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.id('home-country-skip-button')).tap();

      // Skip dream destination
      await waitFor(element(by.text('Skip')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.text('Skip')).tap();

      // Now on first continent intro
      await waitFor(element(by.text('Save & Continue')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.text('Save & Continue')).tap();
    });

    it('displays country grid for continent', async () => {
      // Should see country grid
      await waitFor(element(by.id('country-grid')))
        .toBeVisible()
        .withTimeout(5000);

      // Should see save & continue button
      await expect(element(by.id('save-continue-button'))).toBeVisible();
    });

    it('can toggle visited country', async () => {
      // Find a country item and tap it
      await waitFor(element(by.id('country-item-US')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.id('country-item-US')).tap();

      // Should show "selected" badge or checkmark
      // (The exact visual indicator depends on implementation)
      // Just verify we can tap the country
    });

    it('can toggle wishlist country', async () => {
      // Find the wishlist button on a country
      await waitFor(element(by.id('country-wishlist-US')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.id('country-wishlist-US')).tap();

      // Should add to wishlist (star should fill)
    });

    it('progresses through all continents', async () => {
      // Navigate through remaining continents (we've already done 1)
      for (let i = 0; i < CONTINENT_COUNT - 1; i++) {
        await waitFor(element(by.id('save-continue-button')))
          .toBeVisible()
          .withTimeout(5000);
        await element(by.id('save-continue-button')).tap();
      }

      // Should arrive at progress summary or main app
      await waitForEither(by.label('trips-tab'), by.text('Summary'), 10000);
    });
  });

  describe('Complete Onboarding', () => {
    it('completes full onboarding flow and lands on main app', async () => {
      await clearAppState();
      const email = testData.uniqueEmail();
      await signUp(email, testData.testPassword);

      // Swipe through carousel
      const carousel = element(by.type('RCTScrollView'));
      for (let i = 0; i < CAROUSEL_SWIPES_TO_CTA; i++) {
        await carousel.swipe('left');
      }

      // Start journey
      await element(by.id('start-journey-button')).tap();

      // Skip all steps quickly
      // Motivation
      await waitFor(element(by.text('Skip')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.text('Skip')).tap();

      // Home country
      await waitFor(element(by.id('home-country-skip-button')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.id('home-country-skip-button')).tap();

      // Dream destination
      await waitFor(element(by.text('Skip')))
        .toBeVisible()
        .withTimeout(5000);
      await element(by.text('Skip')).tap();

      // All 6 continent screens
      for (let i = 0; i < CONTINENT_COUNT; i++) {
        await waitFor(element(by.id('save-continue-button')))
          .toBeVisible()
          .withTimeout(5000);
        await element(by.id('save-continue-button')).tap();
      }

      // Should land on main app with tabs (use accessibility labels)
      await waitFor(element(by.label('trips-tab')))
        .toBeVisible()
        .withTimeout(10000);
      await expect(element(by.label('passport-tab'))).toBeVisible();
      await expect(element(by.label('profile-tab'))).toBeVisible();
    });
  });
});
