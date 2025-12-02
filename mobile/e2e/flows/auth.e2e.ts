/**
 * E2E tests for authentication flows
 */

import {
  device,
  element,
  by,
  expect,
  waitFor,
  testData,
  signUp,
  logout,
  clearAppState,
  completeOnboarding,
  waitForEither,
} from '../init';

describe('Authentication', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  describe('Sign Up', () => {
    it('creates a new account successfully', async () => {
      const email = testData.uniqueEmail();
      const password = testData.testPassword;

      // Navigate to sign up
      await element(by.id('welcome-get-started-button')).tap();

      // Fill in the form
      await element(by.id('signup-email-input')).typeText(email);
      await element(by.id('signup-password-input')).typeText(password);
      await element(by.id('signup-confirm-password-input')).typeText(password);

      // Submit
      await element(by.id('signup-submit-button')).tap();

      // Should arrive at onboarding or main screen
      await waitForEither(by.id('start-journey-button'), by.label('trips-tab'), 15000);
    });

    it('shows error for weak password', async () => {
      await device.reloadReactNative();

      // Navigate to sign up
      await element(by.id('welcome-get-started-button')).tap();

      // Fill with weak password
      await element(by.id('signup-email-input')).typeText('test@example.com');
      await element(by.id('signup-password-input')).typeText('weak');
      await element(by.id('signup-confirm-password-input')).typeText('weak');

      // Submit
      await element(by.id('signup-submit-button')).tap();

      // Should show validation error (password too short)
      await waitFor(element(by.text('Password must be at least 8 characters')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('shows error for mismatched passwords', async () => {
      await device.reloadReactNative();

      // Navigate to sign up
      await element(by.id('welcome-get-started-button')).tap();

      // Fill with mismatched passwords
      await element(by.id('signup-email-input')).typeText('test@example.com');
      await element(by.id('signup-password-input')).typeText('Password123!');
      await element(by.id('signup-confirm-password-input')).typeText('DifferentPassword123!');

      // Submit
      await element(by.id('signup-submit-button')).tap();

      // Should show validation error
      await waitFor(element(by.text('Passwords do not match')))
        .toBeVisible()
        .withTimeout(5000);
    });
  });

  describe('Sign In', () => {
    let testEmail: string;
    const testPassword = testData.testPassword;

    beforeAll(async () => {
      // Create a test account first
      await clearAppState();
      testEmail = testData.uniqueEmail();
      await signUp(testEmail, testPassword);
      await logout();
    });

    it('logs in with valid credentials', async () => {
      await device.reloadReactNative();

      // Navigate to login
      await element(by.id('welcome-login-button')).tap();

      // Fill credentials
      await element(by.id('login-email-input')).typeText(testEmail);
      await element(by.id('login-password-input')).typeText(testPassword);

      // Submit
      await element(by.id('login-submit-button')).tap();

      // Should arrive at main app (either onboarding or tabs)
      await waitForEither(by.id('start-journey-button'), by.label('trips-tab'), 15000);
    });

    it('shows error for invalid credentials', async () => {
      await device.reloadReactNative();

      // Navigate to login
      await element(by.id('welcome-login-button')).tap();

      // Fill with wrong password
      await element(by.id('login-email-input')).typeText('nonexistent@example.com');
      await element(by.id('login-password-input')).typeText('WrongPassword123!');

      // Submit
      await element(by.id('login-submit-button')).tap();

      // Should show error
      await waitFor(element(by.text('Invalid login credentials')))
        .toBeVisible()
        .withTimeout(10000);
    });

    it('navigates between login and signup', async () => {
      await device.reloadReactNative();

      // Navigate to login
      await element(by.id('welcome-login-button')).tap();

      // Should see login form
      await expect(element(by.id('login-email-input'))).toBeVisible();

      // Navigate to signup
      await element(by.id('login-signup-link')).tap();

      // Should see signup form
      await expect(element(by.id('signup-email-input'))).toBeVisible();

      // Navigate back to login
      await element(by.id('signup-login-link')).tap();

      // Should see login form again
      await expect(element(by.id('login-email-input'))).toBeVisible();
    });
  });

  describe('Sign Out', () => {
    beforeAll(async () => {
      // Set up logged in state
      await clearAppState();
      const email = testData.uniqueEmail();
      await signUp(email, testData.testPassword);
      await completeOnboarding();
    });

    it('signs out and returns to welcome screen', async () => {
      // Navigate to profile
      await element(by.label('profile-tab')).tap();

      // Verify email is shown
      await expect(element(by.id('profile-email'))).toBeVisible();

      // Sign out
      await element(by.id('sign-out-button')).tap();

      // Should return to welcome or login screen
      await waitForEither(by.id('welcome-get-started-button'), by.id('login-submit-button'), 10000);
    });
  });
});
