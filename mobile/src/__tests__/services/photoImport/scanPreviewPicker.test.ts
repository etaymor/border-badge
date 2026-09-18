import {
  pickScanPreviews,
  type CountryPreviewRow,
  type ScanPreviewBatchItem,
} from '@services/photoImport/scanPreviewPicker';

import type { PhotoWithLocation } from '@services/photoImport/types';

function photo(id: string, overrides: Partial<PhotoWithLocation> = {}): PhotoWithLocation {
  return {
    id,
    uri: `file://${id}.jpg`,
    filename: `${id}.jpg`,
    creationTime: new Date('2026-01-01T00:00:00Z'),
    location: { latitude: 1, longitude: 1 },
    width: 1000,
    height: 800,
    isFavorite: false,
    isScreenshot: false,
    isNetworkAsset: false,
    ...overrides,
  };
}

function item(
  id: string,
  code = 'JP',
  overrides: Partial<PhotoWithLocation> = {}
): ScanPreviewBatchItem {
  return {
    code,
    name: `Country ${code}`,
    photo: photo(id, overrides),
  };
}

function ids(rows: readonly CountryPreviewRow[], code = 'JP'): string[] {
  return rows.find((row) => row.code === code)?.previews.map((preview) => preview.assetId) ?? [];
}

describe('pickScanPreviews', () => {
  it('chooses favorites before non-favorites within the batch that fills a row', () => {
    const result = pickScanPreviews(
      [],
      [
        item('plain-1'),
        item('favorite-1', 'JP', { isFavorite: true }),
        item('plain-2'),
        item('favorite-2', 'JP', { isFavorite: true }),
        item('plain-3'),
      ],
      { homeCountry: 'US' }
    );

    expect(ids(result.countryPreviews)).toEqual(['favorite-1', 'favorite-2']);
    expect(result.changed).toBe(true);
  });

  it('creates a row but excludes screenshot and network previews', () => {
    const result = pickScanPreviews(
      [],
      [
        item('screenshot', 'JP', { isScreenshot: true, isFavorite: true }),
        item('network', 'JP', { isNetworkAsset: true, isFavorite: true }),
      ],
      { homeCountry: 'US' }
    );

    expect(result.countryPreviews).toEqual([{ code: 'JP', name: 'Country JP', previews: [] }]);
  });

  it('orders ties by pixels, non-social dimensions, then creation time', () => {
    const byPixels = pickScanPreviews(
      [],
      [
        item('small', 'JP', { width: 1000, height: 1000 }),
        item('large', 'JP', { width: 2000, height: 1000 }),
      ],
      { homeCountry: 'US' }
    );
    expect(ids(byPixels.countryPreviews)).toEqual(['large', 'small']);

    const byDimensions = pickScanPreviews(
      [],
      [
        item('social', 'JP', { width: 1080, height: 1350 }),
        item('camera', 'JP', { width: 1350, height: 1080 }),
      ],
      { homeCountry: 'US' }
    );
    expect(ids(byDimensions.countryPreviews)).toEqual(['camera', 'social']);

    const byTime = pickScanPreviews(
      [],
      [
        item('old', 'JP', { creationTime: new Date('2025-01-01T00:00:00Z') }),
        item('new', 'JP', { creationTime: new Date('2026-01-01T00:00:00Z') }),
      ],
      { homeCountry: 'US' }
    );
    expect(ids(byTime.countryPreviews)).toEqual(['new', 'old']);
  });

  it('uses safe defaults for malformed and undefined metadata', () => {
    const malformed = photo('malformed', {
      width: Number.NaN,
      height: -1,
      creationTime: new Date(Number.NaN),
      isFavorite: undefined,
    });
    const result = pickScanPreviews(
      [],
      [{ code: 'JP', name: 'Country JP', photo: malformed }, item('known', 'JP')],
      { homeCountry: 'US' }
    );

    expect(ids(result.countryPreviews)).toEqual(['known', 'malformed']);
  });

  it('keeps the first ten rows and reports no change for an eleventh', () => {
    const first = pickScanPreviews(
      [],
      Array.from({ length: 10 }, (_, index) => item(`p${index}`, `C${index}`)),
      { homeCountry: 'US' }
    );
    const eleventh = pickScanPreviews(first.countryPreviews, [item('p10', 'C10')], {
      homeCountry: 'US',
    });

    expect(eleventh.changed).toBe(false);
    expect(eleventh.countryPreviews).toBe(first.countryPreviews);
    expect(eleventh.countryPreviews).toHaveLength(10);
  });

  it.each([
    ['existing then new', [item('existing-fill', 'C0'), item('new-row', 'C9')]],
    ['new then existing', [item('new-row', 'C9'), item('existing-fill', 'C0')]],
  ])('counts only genuinely new pending rows when ordered %s', (_label, batch) => {
    const current = pickScanPreviews(
      [],
      Array.from({ length: 9 }, (_, index) => item(`initial-${index}`, `C${index}`)),
      { homeCountry: 'US' }
    ).countryPreviews;

    const result = pickScanPreviews(current, batch, { homeCountry: 'US' });

    expect(result.countryPreviews).toHaveLength(10);
    expect(ids(result.countryPreviews, 'C0')).toEqual(['initial-0', 'existing-fill']);
    expect(ids(result.countryPreviews, 'C9')).toEqual(['new-row']);
  });

  it('excludes the home country entirely', () => {
    const result = pickScanPreviews([], [item('home', 'us')], { homeCountry: 'US' });

    expect(result).toEqual({ countryPreviews: [], changed: false });
  });

  it('fills open slots without replacing established previews', () => {
    const first = pickScanPreviews([], [item('first')], { homeCountry: 'US' });
    const second = pickScanPreviews(first.countryPreviews, [item('second')], { homeCountry: 'US' });
    const laterBetter = pickScanPreviews(
      second.countryPreviews,
      [item('favorite', 'JP', { isFavorite: true })],
      { homeCountry: 'US' }
    );

    expect(ids(second.countryPreviews)).toEqual(['first', 'second']);
    expect(laterBetter.changed).toBe(false);
    expect(laterBetter.countryPreviews).toBe(second.countryPreviews);
  });

  it('caps a burst at ten rows and two previews per row', () => {
    const batch = Array.from({ length: 15 }, (_, countryIndex) =>
      Array.from({ length: 4 }, (_, photoIndex) =>
        item(`p-${countryIndex}-${photoIndex}`, `C${countryIndex}`)
      )
    ).flat();
    const result = pickScanPreviews([], batch, { homeCountry: 'US' });

    expect(result.countryPreviews).toHaveLength(10);
    expect(result.countryPreviews.every((row) => row.previews.length === 2)).toBe(true);
  });

  it('processes 10,000 photos across 15 countries in under 50ms', () => {
    const batch = Array.from({ length: 10_000 }, (_, index) =>
      item(`p-${index}`, `C${index % 15}`, {
        isFavorite: index % 17 === 0,
        width: 1000 + (index % 2000),
        height: 800 + (index % 1000),
        creationTime: new Date(1_700_000_000_000 + index),
      })
    );

    let result = pickScanPreviews([], batch, { homeCountry: 'US' });
    const trialCpuTimesMs = Array.from({ length: 3 }, () => {
      const startedCpuUsage = process.cpuUsage();
      result = pickScanPreviews([], batch, { homeCountry: 'US' });
      const elapsedCpuUsage = process.cpuUsage(startedCpuUsage);

      return (elapsedCpuUsage.user + elapsedCpuUsage.system) / 1_000;
    });
    const elapsedCpuMs = Math.min(...trialCpuTimesMs);

    expect(result.countryPreviews).toHaveLength(10);
    expect(elapsedCpuMs).toBeLessThan(50);
  });
});
