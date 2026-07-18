/**
 * Module-graph regression test (PERF U10).
 *
 * Guards the app-boot path: importing the photo-import service modules that
 * `useAppStateTracking` transitively pulls in must NOT evaluate the ~2.2 MB
 * `@rapideditor/country-coder` dataset at module-eval time. country-coder is only
 * meant to load when a geocoding function actually runs (after the user imports
 * photos), never at import time.
 *
 * We prove this by mocking the package with a factory whose `iso1A2Code` is a spy.
 * Importing the modules (and the barrel) must leave the spy uncalled; only calling
 * a geocoding function may trigger it.
 *
 * `require()` (not `import`) is used deliberately so we control exactly when each
 * module is evaluated — an ES `import` would be hoisted and defeat the timing
 * assertion.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// Type-only import: erased at compile time, so it cannot evaluate the module
// graph this test is measuring.
import type { LocationCluster } from '@services/photoImport/types';

// Spy factory for country-coder. jest.mock is hoisted; the spy is created inside
// the factory and re-read after import via requireMock so we can assert call state.
jest.mock('@rapideditor/country-coder', () => ({
  __esModule: true,
  iso1A2Code: jest.fn(() => 'JP'),
}));

// Silence unrelated native-module noise pulled in by the barrel's leaf modules.
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}));

function getCountryCoderSpy(): jest.Mock {
  // Re-read the mocked module to inspect the spy's call state.
  const mocked = jest.requireMock('@rapideditor/country-coder') as {
    iso1A2Code: jest.Mock;
  };
  return mocked.iso1A2Code;
}

describe('country-coder lazy loading (U10 boot-path guard)', () => {
  beforeEach(() => {
    getCountryCoderSpy().mockClear();
  });

  it('does not evaluate country-coder when importing the geocoding module', () => {
    // Importing the module that defines geocodeClusterCentroids must not touch
    // country-coder. (require() here mirrors module-eval; the lazy wrapper defers
    // the country-coder require() until the function body runs.)
    require('@services/photoImport/photoClustering');
    require('@services/photoImport/photoClusteringCache');
    require('@services/photoImport/countryCoder');

    expect(getCountryCoderSpy()).not.toHaveBeenCalled();
  });

  it('does not evaluate country-coder when importing the @services/photoImport barrel', () => {
    // The barrel is what useAppStateTracking transitively imports (via the 4
    // foreground functions detectStuckScan/performBackgroundPhotoSync/
    // resetForUserChange/tryResumeScan). Merely importing it must not parse
    // country-coder.
    require('@services/photoImport');

    expect(getCountryCoderSpy()).not.toHaveBeenCalled();
  });

  it('evaluates country-coder only when a geocoding function is invoked', () => {
    const { geocodeClusterCentroids } = require('@services/photoImport/photoClustering');

    expect(getCountryCoderSpy()).not.toHaveBeenCalled();

    const clusters: LocationCluster[] = [
      {
        id: 'c1',
        geohash: 'c1',
        centroid: { latitude: 35.68, longitude: 139.76 },
        photos: [],
        timeRange: { start: new Date(), end: new Date() },
      },
    ];
    geocodeClusterCentroids(clusters);

    // Now — and only now — country-coder is used.
    expect(getCountryCoderSpy()).toHaveBeenCalledTimes(1);
    expect(clusters[0].countryCode).toBe('JP');
  });
});
