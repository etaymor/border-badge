/**
 * U12 — Heavy main-screen detach/freeze.
 *
 * The passport grid (PassportHome, ~200 image cards) and the Main tab tree must
 * stop staying attached + unfrozen underneath pushed screens. We reuse the same
 * mechanism U2 proved for the OnboardingNavigator: on a blank-stack navigator,
 * `detachPreviousScreen: true` (alongside `freezeOnBlur: true`) caps the
 * active-screens window so buried screens reach `activityState: 0` and
 * react-freeze suspends their re-renders. See
 * react-native-screen-transitions active-screens-limit helper:
 *   options?.detachPreviousScreen !== true  -> keeps previous screen active.
 *
 * react-freeze / native activityState is not observable under jest, so — exactly
 * like the U2 onboarding test — we assert the CONFIG: we introspect the
 * `screenOptions` handed to each blank-stack `Navigator` via a local blank-stack
 * mock that captures it. We also smoke-render each navigator and verify the
 * Trips stack is registered exactly once inside the Passport blank-stack.
 */
import { render } from '@testing-library/react-native';
import React from 'react';
import { View } from 'react-native';

// --- Local blank-stack mock: capture screenOptions + Screen registrations. ---
// This OVERRIDES the global jest.setup.js mock for this file so we can inspect
// the screenOptions object (the global mock discards it).
type CapturedNavigator = {
  screenOptions: Record<string, unknown> | undefined;
  screens: string[];
};

const capturedNavigators: CapturedNavigator[] = [];

jest.mock('react-native-screen-transitions/blank-stack', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mockReact = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mockRN = require('react-native') as typeof import('react-native');

  return {
    createBlankStackNavigator: () => {
      // Each createBlankStackNavigator() call owns one Navigator instance.
      const record: CapturedNavigator = { screenOptions: undefined, screens: [] };
      capturedNavigators.push(record);

      return {
        Navigator: ({
          children,
          screenOptions,
        }: {
          children?: React.ReactNode;
          screenOptions?: Record<string, unknown>;
        }) => {
          record.screenOptions = screenOptions;
          return mockReact.createElement(
            mockRN.View,
            { testID: 'blank-stack-navigator' },
            children
          );
        },
        // Record every registered screen name; render nothing heavy.
        Screen: ({ name }: { name: string }) => {
          record.screens.push(name);
          return null;
        },
      };
    },
  };
});

// --- Stub child screens / nested navigators so importing the navigators is cheap.
// We only care about the navigator config, not the screen internals.
const Stub = () => <View testID="stub-screen" />;

jest.mock('@screens/passport/PassportScreen', () => ({ PassportScreen: () => null }));
jest.mock('@screens/country/CountryDetailScreen', () => ({ CountryDetailScreen: () => null }));
jest.mock('@screens/photos/PhotoImportScreen', () => ({ PhotoImportScreen: () => null }));
jest.mock('@screens/photos/PhotoTripsScreen', () => ({ PhotoTripsScreen: () => null }));
jest.mock('@screens/profile/ProfileSettingsScreen', () => ({ ProfileSettingsScreen: () => null }));
jest.mock('@screens/share/ShareCaptureScreen', () => ({ ShareCaptureScreen: () => null }));
jest.mock('@screens/share/ShareCaptureErrorBoundary', () => ({
  ShareCaptureErrorBoundary: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock('@screens/trips/TripFormScreen', () => ({ TripFormScreen: () => null }));
jest.mock('@screens/paywall', () => ({ PaywallModalScreen: () => null }));
jest.mock('@components/share', () => ({ ClipboardBannerOverlay: () => null }));

// Nested navigators referenced by Root/Passport — stub to keep the tree shallow.
jest.mock('@navigation/TripsNavigator', () => ({ TripsNavigator: () => null }));
jest.mock('@navigation/MainTabNavigator', () => ({ MainTabNavigator: () => null }));
jest.mock('@navigation/OnboardingNavigator', () => ({ OnboardingNavigator: () => null }));
jest.mock('@navigation/AuthNavigator', () => ({ AuthNavigator: () => null }));

// ErrorBoundary just renders children.
jest.mock('@components/ui/ErrorBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

import { useAuthStore } from '@stores/authStore';

import { PassportNavigator } from '@navigation/PassportNavigator';
import { RootNavigator } from '@navigation/RootNavigator';

// Suppress unused stub warning if a mock path changes; keep reference.
void Stub;

/**
 * `createBlankStackNavigator()` runs at module-import time (module-level
 * `const Stack = ...`), so each navigator owns exactly one persistent record in
 * `capturedNavigators`. Rendering re-invokes that record's `Navigator`/`Screen`
 * factories, refreshing `screenOptions` + `screens`. We locate the right record
 * after render by the screen names it registered (`PassportHome` vs `Main`).
 */
function findNavigatorWithScreen(screenName: string): CapturedNavigator {
  const match = capturedNavigators.find((n) => n.screens.includes(screenName));
  if (!match) {
    throw new Error(
      `No captured blank-stack navigator registered a "${screenName}" screen. ` +
        `Captured: ${JSON.stringify(capturedNavigators.map((n) => n.screens))}`
    );
  }
  return match;
}

// Reset per-record capture buffers between tests without dropping the
// import-time records (which are never recreated).
beforeEach(() => {
  for (const rec of capturedNavigators) {
    rec.screenOptions = undefined;
    rec.screens = [];
  }
});

describe('U12 main-navigator detach/freeze config', () => {
  describe('PassportNavigator (blank-stack)', () => {
    it('sets detachPreviousScreen + freezeOnBlur on screenOptions so PassportHome freezes under pushed screens', () => {
      render(<PassportNavigator />);

      const record = findNavigatorWithScreen('PassportHome');
      expect(record.screenOptions).toBeDefined();
      expect(record.screenOptions?.detachPreviousScreen).toBe(true);
      expect(record.screenOptions?.freezeOnBlur).toBe(true);
    });

    it('renders (smoke) and registers PassportHome as the initial screen', () => {
      const { getByTestId } = render(<PassportNavigator />);
      expect(getByTestId('blank-stack-navigator')).toBeTruthy();

      const record = findNavigatorWithScreen('PassportHome');
      expect(record.screens[0]).toBe('PassportHome');
    });

    it('registers the Trips stack exactly once in the Passport blank-stack (active nested Trips path)', () => {
      render(<PassportNavigator />);

      const record = findNavigatorWithScreen('PassportHome');
      const tripsRegistrations = record.screens.filter((n) => n === 'Trips');
      expect(tripsRegistrations).toHaveLength(1);
    });
  });

  describe('RootNavigator (blank-stack)', () => {
    const authenticate = () =>
      useAuthStore.setState({
        session: { user: { id: 'u1' } } as never,
        hasCompletedOnboarding: true,
        isLoading: false,
        needsPostSignupFlow: false,
      });

    it('sets detachPreviousScreen + freezeOnBlur on screenOptions so the Main tab tree freezes under Auth/Paywall', () => {
      authenticate();
      render(<RootNavigator />);

      const record = findNavigatorWithScreen('Main');
      expect(record.screenOptions).toBeDefined();
      expect(record.screenOptions?.detachPreviousScreen).toBe(true);
      expect(record.screenOptions?.freezeOnBlur).toBe(true);
    });

    it('renders (smoke) with the Main stack when authenticated', () => {
      authenticate();
      const { getByTestId } = render(<RootNavigator />);
      expect(getByTestId('blank-stack-navigator')).toBeTruthy();

      const record = findNavigatorWithScreen('Main');
      expect(record.screens).toContain('Main');
    });
  });
});
