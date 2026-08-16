/**
 * Tests for quiz candidate selection (pure logic).
 *
 * Covers KTD2 (border/no-fix exclusion), KTD3 (sampling caps + country
 * stratification), KTD12 (freshness: no repeats from existing quizzes until
 * the fresh pool is exhausted), and AE2 pick sizing.
 */

import {
  BORDER_PROBE_DELTA_DEG,
  FIRST_BATCH_MAX,
  QUIZ_MAX_PHOTOS,
  isBorderAmbiguous,
  orderByCountrySpread,
  pickQuizPhotos,
  resolveCandidateCountry,
  selectEligibilityBatch,
  type CountryCoderFn,
  type GeoEligibleCandidate,
  type QuizPhotoCandidate,
} from '@services/quiz/candidateSelection';

const VALID_CODES = new Set(['FR', 'IT', 'JP', 'US', 'PT', 'DE']);

let idCounter = 0;

function makePhoto(overrides: Partial<QuizPhotoCandidate> = {}): QuizPhotoCandidate {
  idCounter += 1;
  return {
    id: `photo-${idCounter}`,
    uri: `file:///photo-${idCounter}.jpg`,
    // Hours apart by default: fixtures are distinct shots, never burst frames.
    creationTime: 1_700_000_000_000 + idCounter * 3_600_000,
    latitude: 48.85,
    longitude: 2.35,
    countryCode: 'FR',
    ...overrides,
  };
}

/** Coder that always agrees with the cached country code (FR-only pools). */
const agreeingCoder: CountryCoderFn = () => 'FR';

/**
 * Probe coder that never disagrees (returns null everywhere). Used for
 * multi-country pools where the probe outcome is not the thing under test.
 */
const neutralCoder: CountryCoderFn = () => null;

describe('resolveCandidateCountry', () => {
  it('excludes photos with no country fix (KTD2: null coder result)', () => {
    const photo = makePhoto({ countryCode: null });
    const nullCoder: CountryCoderFn = () => null;

    const result = resolveCandidateCountry(photo, nullCoder, VALID_CODES);

    expect(result).toEqual({ eligible: false, reason: 'no-country' });
  });

  it('excludes territory codes that do not map to the country table (KTD2)', () => {
    const photo = makePhoto({ countryCode: 'ZZ' });

    const result = resolveCandidateCountry(photo, agreeingCoder, VALID_CODES);

    expect(result).toEqual({ eligible: false, reason: 'unmapped-territory' });
  });

  it('excludes border-ambiguous photos when the probe resolves two countries (KTD2)', () => {
    // Photo sits just west of a border: eastward probe lands in IT.
    const photo = makePhoto({ countryCode: 'FR', latitude: 45.0, longitude: 6.0 });
    const borderCoder: CountryCoderFn = ([lon]) => (lon > 6.01 ? 'IT' : 'FR');

    const result = resolveCandidateCountry(photo, borderCoder, VALID_CODES);

    expect(result).toEqual({ eligible: false, reason: 'border-ambiguous' });
  });

  it('keeps photos whose probe stays within one country', () => {
    const photo = makePhoto({ countryCode: 'JP' });
    const coder: CountryCoderFn = () => 'JP';

    const result = resolveCandidateCountry(photo, coder, VALID_CODES);

    expect(result).toEqual({ eligible: true, countryCode: 'JP' });
  });

  it('ignores null probe points (coastline: ocean is not a second country)', () => {
    const photo = makePhoto({ countryCode: 'PT', latitude: 38.7, longitude: -9.4 });
    // Westward probes fall into the Atlantic (null); the rest agree.
    const coastCoder: CountryCoderFn = ([lon]) => (lon < -9.41 ? null : 'PT');

    const result = resolveCandidateCountry(photo, coastCoder, VALID_CODES);

    expect(result).toEqual({ eligible: true, countryCode: 'PT' });
  });

  it('probes four points at the documented delta', () => {
    const photo = makePhoto({ countryCode: 'FR', latitude: 45, longitude: 6 });
    const coder = jest.fn<string | null, Parameters<CountryCoderFn>>(() => 'FR');

    resolveCandidateCountry(photo, coder, VALID_CODES);

    const probedPoints = coder.mock.calls.map(([coordinate]) => coordinate);
    expect(probedPoints).toEqual(
      expect.arrayContaining([
        [6, 45 + BORDER_PROBE_DELTA_DEG],
        [6, 45 - BORDER_PROBE_DELTA_DEG],
        [6 + BORDER_PROBE_DELTA_DEG, 45],
        [6 - BORDER_PROBE_DELTA_DEG, 45],
      ])
    );
  });
});

describe('isBorderAmbiguous', () => {
  it('returns false when every probe agrees or is null', () => {
    const photo = makePhoto({ countryCode: 'US' });
    expect(
      isBorderAmbiguous(photo as QuizPhotoCandidate & { countryCode: string }, () => 'US')
    ).toBe(false);
  });

  it('returns true when any probe disagrees', () => {
    const photo = makePhoto({ countryCode: 'US', latitude: 49.0, longitude: -122.0 });
    const coder: CountryCoderFn = ([, lat]) => (lat > 49.01 ? 'CA' : 'US');
    expect(isBorderAmbiguous(photo as QuizPhotoCandidate & { countryCode: string }, coder)).toBe(
      true
    );
  });
});

describe('selectEligibilityBatch', () => {
  it('caps the batch at the given limit (KTD3: first batch <= 50)', () => {
    const pool = [
      ...Array.from({ length: 40 }, () => makePhoto({ countryCode: 'FR' })),
      ...Array.from({ length: 40 }, () => makePhoto({ countryCode: 'IT' })),
      ...Array.from({ length: 40 }, () => makePhoto({ countryCode: 'JP' })),
    ];

    const batch = selectEligibilityBatch({
      pool,
      validCodes: VALID_CODES,
      coder: neutralCoder,
      limit: FIRST_BATCH_MAX,
    });

    expect(batch).toHaveLength(FIRST_BATCH_MAX);
    // Country spread: the first cycle covers every country once.
    expect(new Set(batch.slice(0, 3).map((c) => c.countryCode)).size).toBe(3);
  });

  it('stratifies evenly across countries (R1 spread)', () => {
    const pool = [
      ...Array.from({ length: 10 }, () => makePhoto({ countryCode: 'FR' })),
      ...Array.from({ length: 10 }, () => makePhoto({ countryCode: 'IT' })),
      ...Array.from({ length: 10 }, () => makePhoto({ countryCode: 'JP' })),
    ];

    const batch = selectEligibilityBatch({
      pool,
      validCodes: VALID_CODES,
      coder: neutralCoder,
      limit: 6,
    });

    const counts = new Map<string, number>();
    for (const c of batch) counts.set(c.countryCode, (counts.get(c.countryCode) ?? 0) + 1);
    expect(counts.get('FR')).toBe(2);
    expect(counts.get('IT')).toBe(2);
    expect(counts.get('JP')).toBe(2);
  });

  it('defers used asset ids until the fresh pool is exhausted (KTD12/R17)', () => {
    const fresh = Array.from({ length: 4 }, () => makePhoto({ countryCode: 'FR' }));
    const used = Array.from({ length: 10 }, () => makePhoto({ countryCode: 'FR' }));
    const usedAssetIds = new Set(used.map((p) => p.id));

    const batch = selectEligibilityBatch({
      pool: [...used, ...fresh],
      validCodes: VALID_CODES,
      coder: agreeingCoder,
      usedAssetIds,
      limit: 6,
    });

    expect(batch).toHaveLength(6);
    // All 4 fresh photos come first; only then do used photos appear.
    const freshIds = new Set(fresh.map((p) => p.id));
    expect(batch.slice(0, 4).every((c) => freshIds.has(c.id))).toBe(true);
    expect(batch.slice(4).every((c) => usedAssetIds.has(c.id))).toBe(true);
  });

  it('skips already-classified photos via excludeIds', () => {
    const pool = Array.from({ length: 5 }, () => makePhoto({ countryCode: 'FR' }));
    const excludeIds = new Set([pool[0].id, pool[1].id]);

    const batch = selectEligibilityBatch({
      pool,
      validCodes: VALID_CODES,
      coder: agreeingCoder,
      excludeIds,
      limit: 10,
    });

    expect(batch).toHaveLength(3);
    expect(batch.every((c) => !excludeIds.has(c.id))).toBe(true);
  });

  it('orders unclassified countries before deprioritized ones (KTD3 resample)', () => {
    const classifiedCountry = Array.from({ length: 3 }, () => makePhoto({ countryCode: 'FR' }));
    const freshCountry = Array.from({ length: 3 }, () => makePhoto({ countryCode: 'JP' }));

    const batch = selectEligibilityBatch({
      pool: [...classifiedCountry, ...freshCountry],
      validCodes: VALID_CODES,
      coder: neutralCoder,
      deprioritizedCountries: new Set(['FR']),
      limit: 4,
    });

    expect(batch.slice(0, 3).every((c) => c.countryCode === 'JP')).toBe(true);
    expect(batch[3].countryCode).toBe('FR');
  });

  it('replaces border-ambiguous candidates with the next in line (KTD2)', () => {
    const borderPhoto = makePhoto({ countryCode: 'FR', latitude: 45.0, longitude: 6.0 });
    const inland = [
      makePhoto({ countryCode: 'FR', latitude: 48.85, longitude: 2.35 }),
      makePhoto({ countryCode: 'FR', latitude: 48.86, longitude: 2.36 }),
    ];
    const borderCoder: CountryCoderFn = ([lon]) => (lon > 6.01 ? 'IT' : 'FR');

    const batch = selectEligibilityBatch({
      pool: [borderPhoto, ...inland],
      validCodes: VALID_CODES,
      coder: borderCoder,
      limit: 2,
    });

    expect(batch).toHaveLength(2);
    expect(batch.map((c) => c.id)).not.toContain(borderPhoto.id);
  });

  it('drops photos with no cached country fix without calling the coder for them', () => {
    const noFix = makePhoto({ countryCode: null });
    const good = makePhoto({ countryCode: 'FR' });

    const batch = selectEligibilityBatch({
      pool: [noFix, good],
      validCodes: VALID_CODES,
      coder: agreeingCoder,
      limit: 10,
    });

    expect(batch.map((c) => c.id)).toEqual([good.id]);
  });
});

describe('orderByCountrySpread', () => {
  it('produces the identical prefix of the full ordering when limited', () => {
    // Representative pool: uneven country sizes, used photos, and a
    // deprioritized country, so all four freshness segments are exercised.
    const pool = [
      ...Array.from({ length: 7 }, () => makePhoto({ countryCode: 'FR' })),
      ...Array.from({ length: 4 }, () => makePhoto({ countryCode: 'IT' })),
      ...Array.from({ length: 5 }, () => makePhoto({ countryCode: 'JP' })),
      ...Array.from({ length: 3 }, () => makePhoto({ countryCode: 'DE' })),
    ] as GeoEligibleCandidate[];
    const usedAssetIds = new Set(pool.filter((_, index) => index % 3 === 0).map((p) => p.id));
    const deprioritizedCountries = new Set(['JP']);

    const full = orderByCountrySpread(pool, usedAssetIds, deprioritizedCountries);

    expect(full).toHaveLength(pool.length);
    for (const limit of [0, 1, 3, 6, 10, pool.length, pool.length + 5]) {
      expect(orderByCountrySpread(pool, usedAssetIds, deprioritizedCountries, limit)).toEqual(
        full.slice(0, limit)
      );
    }
  });
});

describe('pickQuizPhotos', () => {
  it('returns all eligible photos when fewer than the max (AE2: 6 eligible -> 6 picks)', () => {
    const eligible = Array.from({ length: 6 }, () => makePhoto({ countryCode: 'FR' })) as Array<
      QuizPhotoCandidate & { countryCode: string }
    >;

    const picks = pickQuizPhotos(eligible);

    expect(picks).toHaveLength(6);
  });

  it('caps picks at the quiz max and spreads across countries (R1)', () => {
    const eligible = ['FR', 'IT', 'JP', 'US'].flatMap((code) =>
      Array.from({ length: 3 }, () => makePhoto({ countryCode: code }))
    ) as Array<QuizPhotoCandidate & { countryCode: string }>;

    const picks = pickQuizPhotos(eligible);

    expect(picks).toHaveLength(QUIZ_MAX_PHOTOS);
    expect(new Set(picks.map((p) => p.countryCode)).size).toBe(4);
  });

  it('prefers fresh photos over previously used ones (KTD12)', () => {
    const fresh = Array.from({ length: 5 }, () => makePhoto({ countryCode: 'FR' }));
    const used = Array.from({ length: 8 }, () => makePhoto({ countryCode: 'FR' }));
    const usedAssetIds = new Set(used.map((p) => p.id));

    const picks = pickQuizPhotos(
      [...used, ...fresh] as Array<QuizPhotoCandidate & { countryCode: string }>,
      usedAssetIds
    );

    expect(picks).toHaveLength(QUIZ_MAX_PHOTOS);
    const freshIds = new Set(fresh.map((p) => p.id));
    expect(picks.slice(0, 5).every((p) => freshIds.has(p.id))).toBe(true);
  });
});

describe('near-duplicate collapse (BUG-2)', () => {
  const BURST_START = 1_700_000_000_000;

  /** A burst: frames seconds apart at effectively the same coordinate. */
  function makeBurst(count: number, overrides: Partial<QuizPhotoCandidate> = {}) {
    return Array.from({ length: count }, (_, i) =>
      makePhoto({
        creationTime: BURST_START + i * 5_000,
        latitude: 41.9029 + i * 0.00005,
        longitude: 12.4534 + i * 0.00005,
        countryCode: 'IT',
        ...overrides,
      })
    );
  }

  it('selectEligibilityBatch keeps only the newest frame of a burst', () => {
    const burst = makeBurst(4);
    const distinct = [
      makePhoto({ countryCode: 'IT', latitude: 45.44, longitude: 12.33 }),
      makePhoto({ countryCode: 'FR' }),
    ];

    const batch = selectEligibilityBatch({
      pool: [...burst, ...distinct],
      validCodes: VALID_CODES,
      coder: neutralCoder,
      limit: 10,
    });

    const ids = batch.map((photo) => photo.id);
    // Newest burst frame survives; the three older frames are collapsed away.
    expect(ids).toContain(burst[3].id);
    expect(ids).not.toContain(burst[0].id);
    expect(ids).not.toContain(burst[1].id);
    expect(ids).not.toContain(burst[2].id);
    expect(ids).toContain(distinct[0].id);
    expect(ids).toContain(distinct[1].id);
  });

  it('does not collapse same-country photos far apart in time or space', () => {
    const anchor = makePhoto({
      creationTime: BURST_START,
      latitude: 41.9029,
      longitude: 12.4534,
      countryCode: 'IT',
    });
    // Same minute but a different venue kilometres away.
    const farAway = makePhoto({
      creationTime: BURST_START + 60_000,
      latitude: 41.95,
      longitude: 12.5,
      countryCode: 'IT',
    });
    // Same spot, revisited hours later.
    const muchLater = makePhoto({
      creationTime: BURST_START + 2 * 3_600_000,
      latitude: 41.9029,
      longitude: 12.4534,
      countryCode: 'IT',
    });

    const batch = selectEligibilityBatch({
      pool: [anchor, farAway, muchLater],
      validCodes: VALID_CODES,
      coder: neutralCoder,
      limit: 10,
    });

    expect(batch.map((photo) => photo.id).sort()).toEqual(
      [anchor.id, farAway.id, muchLater.id].sort()
    );
  });

  it('pickQuizPhotos never picks two frames of the same burst', () => {
    // Bursts that were classified in separate batches can BOTH reach the
    // eligible pool - the final pick must still collapse them.
    const burst = makeBurst(3) as GeoEligibleCandidate[];
    const others = ['FR', 'JP', 'US', 'PT'].map(
      (code) => makePhoto({ countryCode: code }) as GeoEligibleCandidate
    );

    const picks = pickQuizPhotos([...burst, ...others]);

    const burstPicks = picks.filter((photo) => burst.some((frame) => frame.id === photo.id));
    expect(burstPicks).toHaveLength(1);
    expect(burstPicks[0].id).toBe(burst[2].id);
  });

  it('pickQuizPhotos never returns the same asset id twice', () => {
    const photo = makePhoto({ countryCode: 'FR' }) as GeoEligibleCandidate;
    const others = ['IT', 'JP'].map(
      (code) => makePhoto({ countryCode: code }) as GeoEligibleCandidate
    );

    const picks = pickQuizPhotos([photo, photo, ...others]);

    expect(picks.filter((candidate) => candidate.id === photo.id)).toHaveLength(1);
  });
});

describe('day and country-year diversity (game variety)', () => {
  const DAY_MS = 24 * 3_600_000;
  // Noon UTC anchor: fixtures stay on one UTC calendar day regardless of offsets.
  const NOON = Date.UTC(2023, 5, 15, 12, 0, 0);

  /** Same UTC day, hours apart, kilometres apart: distinct shots, one day. */
  function makeSameDayTrio(countryCode: string, dayOffset: number) {
    return [0, 1, 2].map((i) =>
      makePhoto({
        countryCode,
        creationTime: NOON + dayOffset * DAY_MS + i * 4 * 3_600_000,
        latitude: 41.0 + i * 0.5,
        longitude: 12.0 + i * 0.5,
      })
    );
  }

  it('never picks two photos from the same day when other days exist', () => {
    // One day holds three distinct shots; five other days hold one each.
    const busyDay = makeSameDayTrio('IT', 0);
    const otherDays = [1, 2, 3, 4, 5].map(
      (d) =>
        makePhoto({
          countryCode: 'FR',
          creationTime: NOON + d * DAY_MS,
          latitude: 48.0 + d,
          longitude: 2.0 + d,
        }) as GeoEligibleCandidate
    );

    const picks = pickQuizPhotos(
      [...busyDay, ...otherDays] as GeoEligibleCandidate[],
      new Set(),
      6
    );

    const fromBusyDay = picks.filter((p) => busyDay.some((b) => b.id === p.id));
    expect(fromBusyDay).toHaveLength(1);
    expect(picks).toHaveLength(6);
  });

  it('never repeats a (country, year) pair when enough distinct pairs exist', () => {
    // Five distinct (country, year) pairs, plus three extra FR photos in the
    // same year on different days.
    const YEAR_MS = 366 * DAY_MS;
    const distinct = ['FR', 'IT', 'JP', 'US', 'PT'].map(
      (code, i) =>
        makePhoto({
          countryCode: code,
          creationTime: NOON - i * YEAR_MS,
          latitude: 20 + i * 5,
          longitude: 10 + i * 5,
        }) as GeoEligibleCandidate
    );
    const frRepeats = [10, 20, 30].map(
      (d) =>
        makePhoto({
          countryCode: 'FR',
          creationTime: NOON + d * DAY_MS,
          latitude: 43,
          longitude: 5,
        }) as GeoEligibleCandidate
    );

    const picks = pickQuizPhotos([...distinct, ...frRepeats], new Set(), 5);

    expect(picks).toHaveLength(5);
    const pairs = picks.map((p) => `${p.countryCode}:${new Date(p.creationTime).getUTCFullYear()}`);
    expect(new Set(pairs).size).toBe(5);
  });

  it('relaxes to same-year (then same-day) repeats only to fill a thin game', () => {
    // A single-trip library: one country, one year, four days, plus one
    // same-day extra. The game still fills rather than shrinking.
    const trip = [0, 1, 2, 3].map(
      (d) =>
        makePhoto({
          countryCode: 'IT',
          creationTime: NOON + d * DAY_MS,
          latitude: 41 + d,
          longitude: 12 + d,
        }) as GeoEligibleCandidate
    );
    const sameDayExtra = makePhoto({
      countryCode: 'IT',
      creationTime: NOON + 6 * 3_600_000,
      latitude: 45.5,
      longitude: 9.2,
    }) as GeoEligibleCandidate;

    const picks = pickQuizPhotos([...trip, sameDayExtra], new Set(), 5);

    expect(picks).toHaveLength(5);
    // Four distinct days for five slots: the one unavoidable same-day repeat
    // is the LAST pick - a day never repeats before every day has had a turn.
    const dayKeys = picks.map((p) => new Date(p.creationTime).toISOString().slice(0, 10));
    expect(new Set(dayKeys).size).toBe(4);
    expect(dayKeys.slice(0, 4)).toEqual([...new Set(dayKeys.slice(0, 4))]);
    expect(dayKeys.slice(0, 4)).toContain(dayKeys[4]);
  });

  it('spreads the classification batch across days before repeating one (sparingly)', () => {
    // Four days, three distinct shots each, one country: the first four batch
    // slots must cover four distinct days, not one busy day.
    const pool = [0, 1, 2, 3].flatMap((d) => makeSameDayTrio('FR', d));

    const batch = selectEligibilityBatch({
      pool,
      validCodes: VALID_CODES,
      coder: neutralCoder,
      limit: 8,
    });

    const firstFourDays = batch
      .slice(0, 4)
      .map((p) => new Date(p.creationTime).toISOString().slice(0, 10));
    expect(new Set(firstFourDays).size).toBe(4);
  });
});
