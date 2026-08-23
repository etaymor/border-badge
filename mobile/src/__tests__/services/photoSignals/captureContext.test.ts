import {
  computeCaptureContexts,
  MOVING_CAPTURE_SPEED_MPS,
  solarElevationDeg,
} from '@services/photoSignals/captureContext';

import type { PhotoIntentTag } from '@services/photoImport/photoTagDb';
import type { CaptureContextPhoto } from '@services/photoSignals/captureContext';

function photo(id: string, overrides: Partial<CaptureContextPhoto> = {}): CaptureContextPhoto {
  return {
    id,
    creationTime: Date.UTC(2024, 5, 20, 12, 0, 0),
    latitude: 0,
    longitude: 0,
    countryCode: 'FR',
    ...overrides,
  };
}

function intent(id: string, overrides: Partial<PhotoIntentTag> = {}): PhotoIntentTag {
  return {
    id,
    metaVersion: 1,
    isFavorite: false,
    hasAdjustments: false,
    subtypes: [],
    burstId: null,
    burstIsRepresentative: false,
    sourceUserLibrary: true,
    inUserAlbum: false,
    altitude: null,
    gpsSpeed: null,
    refreshedAt: 0,
    ...overrides,
  };
}

const intentMap = (...tags: PhotoIntentTag[]) => new Map(tags.map((t) => [t.id, t]));

describe('solarElevationDeg', () => {
  it('puts the June solstice noon sun high over the equator', () => {
    expect(solarElevationDeg(0, 0, Date.UTC(2024, 5, 20, 12, 0, 0))).toBeGreaterThan(60);
  });

  it('puts the midnight sun far below the horizon at the equator', () => {
    expect(solarElevationDeg(0, 0, Date.UTC(2024, 5, 20, 0, 0, 0))).toBeLessThan(-55);
  });

  it('reads near zero at equinox sunset', () => {
    const elevation = solarElevationDeg(0, 0, Date.UTC(2024, 2, 20, 18, 0, 0));
    expect(Math.abs(elevation)).toBeLessThan(6);
  });
});

describe('computeCaptureContexts', () => {
  it('reports dwell as the gap to the previous photo, null for the first', () => {
    const t0 = Date.UTC(2024, 5, 20, 12, 0, 0);
    const contexts = computeCaptureContexts([
      photo('a', { creationTime: t0 }),
      photo('b', { creationTime: t0 + 45_000 }),
    ]);
    expect(contexts.get('a')?.dwellBeforeSec).toBeNull();
    expect(contexts.get('b')?.dwellBeforeSec).toBe(45);
  });

  it('counts same-scene retries but not photos elsewhere in the same minute', () => {
    const t0 = Date.UTC(2024, 5, 20, 12, 0, 0);
    const contexts = computeCaptureContexts([
      photo('a', { creationTime: t0 }),
      photo('b', { creationTime: t0 + 5_000 }),
      photo('c', { creationTime: t0 + 10_000, latitude: 1 }), // ~111km away
    ]);
    expect(contexts.get('a')?.retryCount).toBe(2);
    expect(contexts.get('b')?.retryCount).toBe(2);
    expect(contexts.get('c')?.retryCount).toBe(1);
  });

  it('bands golden hour and night off the sun elevation', () => {
    const sunset = photo('sunset', { creationTime: Date.UTC(2024, 2, 20, 18, 0, 0) });
    const midnight = photo('midnight', { creationTime: Date.UTC(2024, 2, 20, 0, 0, 0) });
    const contexts = computeCaptureContexts([sunset, midnight]);
    expect(contexts.get('sunset')?.goldenHour).toBe(true);
    expect(contexts.get('midnight')?.night).toBe(true);
    expect(contexts.get('midnight')?.goldenHour).toBe(false);
  });

  it('computes altitude delta against the country-day median, given enough samples', () => {
    const t0 = Date.UTC(2024, 5, 20, 12, 0, 0);
    const photos = ['a', 'b', 'c', 'd'].map((id, i) =>
      // Spread beyond the retry window; same country-day group.
      photo(id, { creationTime: t0 + i * 3_600_000 })
    );
    const contexts = computeCaptureContexts(
      photos,
      intentMap(
        intent('a', { altitude: 10 }),
        intent('b', { altitude: 20 }),
        intent('c', { altitude: 30 }),
        intent('d', { altitude: 90 })
      )
    );
    // Median of [10, 20, 30, 90] = 25.
    expect(contexts.get('d')?.altitudeDelta).toBe(65);
    expect(contexts.get('a')?.altitudeDelta).toBe(-15);
  });

  it('leaves altitude delta null without enough measured neighbors', () => {
    const contexts = computeCaptureContexts([photo('a')], intentMap(intent('a', { altitude: 50 })));
    expect(contexts.get('a')?.altitudeDelta).toBeNull();
  });

  it('flags moving capture only above the speed threshold', () => {
    const contexts = computeCaptureContexts(
      [photo('walk'), photo('bus', { creationTime: Date.UTC(2024, 5, 20, 13, 0, 0) })],
      intentMap(
        intent('walk', { gpsSpeed: 1.2 }),
        intent('bus', { gpsSpeed: MOVING_CAPTURE_SPEED_MPS + 1 })
      )
    );
    expect(contexts.get('walk')?.movingCapture).toBe(false);
    expect(contexts.get('bus')?.movingCapture).toBe(true);
  });

  describe('savedFromSocialLikely', () => {
    it('fires on a non-library source', () => {
      const contexts = computeCaptureContexts(
        [photo('a')],
        intentMap(intent('a', { sourceUserLibrary: false }))
      );
      expect(contexts.get('a')?.savedFromSocialLikely).toBe(true);
    });

    it('fires on exact social dimensions with no capture subtype', () => {
      const contexts = computeCaptureContexts(
        [photo('a', { width: 1080, height: 1350 })],
        intentMap(intent('a'))
      );
      expect(contexts.get('a')?.savedFromSocialLikely).toBe(true);
    });

    it('does not fire on social dimensions when a deliberate capture mode is present', () => {
      const contexts = computeCaptureContexts(
        [photo('a', { width: 1080, height: 1350 })],
        intentMap(intent('a', { subtypes: ['live'] }))
      );
      expect(contexts.get('a')?.savedFromSocialLikely).toBe(false);
    });

    it('never fires without an intent row - dimensions alone are not enough', () => {
      const contexts = computeCaptureContexts([photo('a', { width: 1080, height: 1920 })]);
      expect(contexts.get('a')?.savedFromSocialLikely).toBe(false);
    });
  });
});
