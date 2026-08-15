/**
 * Tests for SuggestionsPhase (U8 / R28).
 *
 * Covers what U8 changed about the list chrome:
 *  - the progress header is the ONE announcing surface (progressbar role +
 *    polite live region), and its counts are derived from the rendered rows so
 *    the header and the pending rows cannot disagree
 *  - the list's empty state explains the zero-cluster case instead of showing a
 *    now-unreachable "finding places" spinner
 *
 * The key extractor's `pending` branch is guarded by the compiler rather than a
 * test: the switch has no `default`, so a missing case widens its return type to
 * `string | undefined` and fails `tsc`. A `default: return ''` would compile and
 * silently collide every key — which is exactly why there isn't one.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { render } from '@testing-library/react-native';
import { Text, View } from 'react-native';

import { SuggestionsPhase } from '../../../screens/photos/components/SuggestionsPhase';
import type { ClusterDisplayItem } from '../../../screens/photos/photoImportHelpers';
import type { LocationClusterDisplay, TripCandidateDisplay } from '../../../services/photoImport';

jest.mock('expo-image', () => {
  const mockReact = require('react');
  return {
    Image: ({ style }: { style: unknown }) =>
      mockReact.createElement('Image', { style, testID: 'hero-image' }),
  };
});

const buildCluster = (id: string): LocationClusterDisplay => ({
  id,
  geohash: 'ghxxxxx',
  centroid: { latitude: 35.0, longitude: 139.0 },
  photoIds: [`${id}-p1`],
  photoCount: 1,
  previewUris: [`https://example.com/${id}.jpg`],
  previewAssetIds: [`${id}-p1`],
  timeRange: { start: new Date('2026-01-01T10:00:00Z'), end: new Date('2026-01-01T12:00:00Z') },
  countryCode: 'JP',
});

const buildCandidate = (clusterIds: string[]): TripCandidateDisplay => ({
  id: 'candidate-1',
  countryCode: 'JP',
  dateRange: { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-01-02T00:00:00Z') },
  photoIds: [],
  photoCount: 10,
  previewUris: [],
  previewAssetIds: [],
  locationClusterIds: clusterIds,
});

const renderPhase = (opts: {
  clusterIds: string[];
  items: ClusterDisplayItem[];
  fetching?: boolean;
}) =>
  render(
    <SuggestionsPhase
      selectedCandidate={buildCandidate(opts.clusterIds)}
      selectedTripName="Japan"
      selectedCountryName="Japan"
      isPremium
      canImportPhotos
      fetchingSuggestions={opts.fetching ?? false}
      clusterItems={opts.items}
      renderClusterItem={({ item }) => (
        <View>
          <Text>{item.type}</Text>
        </View>
      )}
      onUpgrade={jest.fn()}
    />
  );

describe('SuggestionsPhase progress header (R28)', () => {
  it('counts settled rows against rendered rows, so the header and the pending rows agree', () => {
    // Two resolved, three still pending. The header used to read the dispatch
    // controller's own counters, which count only the clusters it dispatched —
    // a different denominator from the list, so the two disagreed on screen.
    const items: ClusterDisplayItem[] = [
      { type: 'photos-only', cluster: buildCluster('c-1') },
      {
        type: 'lookup-failed',
        cluster: buildCluster('c-2'),
        retryDisabled: false,
        isRetrying: false,
      },
      { type: 'pending', cluster: buildCluster('c-3') },
      { type: 'pending', cluster: buildCluster('c-4') },
      { type: 'pending', cluster: buildCluster('c-5') },
    ];

    const { getByText } = renderPhase({
      clusterIds: ['c-1', 'c-2', 'c-3', 'c-4', 'c-5'],
      items,
      fetching: true,
    });

    expect(getByText('Processing 2 of 5 locations')).toBeTruthy();
  });

  it('carries a progress role and a polite live region', () => {
    const items: ClusterDisplayItem[] = [{ type: 'pending', cluster: buildCluster('c-1') }];

    const { getByLabelText } = renderPhase({ clusterIds: ['c-1'], items, fetching: true });

    const header = getByLabelText('Processing 0 of 1 locations');
    expect(header.props.accessibilityRole).toBe('progressbar');
    expect(header.props.accessibilityLiveRegion).toBe('polite');
    expect(header.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 0 });
  });

  it('falls back to the candidate cluster count before any cluster is accepted', () => {
    const { getByText } = renderPhase({ clusterIds: ['c-1', 'c-2'], items: [], fetching: true });

    expect(getByText('Preparing 2 locations')).toBeTruthy();
  });

  it('hides the header once the fetch has settled', () => {
    const items: ClusterDisplayItem[] = [{ type: 'photos-only', cluster: buildCluster('c-1') }];

    const { queryByText } = renderPhase({ clusterIds: ['c-1'], items, fetching: false });

    expect(queryByText(/Processing/)).toBeNull();
  });
});

describe('SuggestionsPhase empty state', () => {
  it('explains a candidate with zero renderable clusters instead of leaving blank space', () => {
    const { getByText } = renderPhase({ clusterIds: [], items: [], fetching: false });

    expect(getByText(/No locations left to review/)).toBeTruthy();
  });

  it('stays out of the way during the pre-dispatch window, where the header already speaks', () => {
    const { queryByText, getByText } = renderPhase({
      clusterIds: ['c-1'],
      items: [],
      fetching: true,
    });

    expect(queryByText(/No locations left to review/)).toBeNull();
    expect(getByText('Preparing 1 location')).toBeTruthy();
  });
});
