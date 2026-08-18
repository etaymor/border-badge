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
import { render, fireEvent } from '@testing-library/react-native';
import { ActivityIndicator, Text, View } from 'react-native';

import { SuggestionsPhase } from '../../../screens/photos/components/SuggestionsPhase';
import type { ClusterDisplayItem } from '../../../screens/photos/photoImportHelpers';
import type {
  ClusterSuggestion,
  LocationClusterDisplay,
  TripCandidateDisplay,
} from '../../../services/photoImport';

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

/** A resolved (cache-hit or matched) row for the given cluster. */
const buildSuggestion = (id: string): ClusterSuggestion => ({
  cluster_id: id,
  photo_ids: [`${id}-p1`],
  places: [
    {
      place_id: `ChIJ_${id}`,
      name: `Place ${id}`,
      address: '1 St',
      location: { latitude: 35, longitude: 139 },
      category: 'place',
      distance_m: 10,
      types: ['point_of_interest'],
    },
  ],
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

/** A lookup-failed row, retry-enabled unless told otherwise. */
const buildFailedItem = (
  id: string,
  overrides: { retryDisabled?: boolean; isRetrying?: boolean } = {}
): ClusterDisplayItem => ({
  type: 'lookup-failed',
  cluster: buildCluster(id),
  retryDisabled: overrides.retryDisabled ?? false,
  isRetrying: overrides.isRetrying ?? false,
});

const renderPhase = (opts: {
  clusterIds: string[];
  items: ClusterDisplayItem[];
  fetching?: boolean;
  paused?: boolean;
  preparingRetryCount?: number;
  onRetryAllFailed?: (ids: string[]) => void;
}) =>
  render(
    <SuggestionsPhase
      selectedCandidate={buildCandidate(opts.clusterIds)}
      selectedTripName="Japan"
      selectedCountryName="Japan"
      isPremium
      canImportPhotos
      fetchingSuggestions={opts.fetching ?? false}
      isPaused={opts.paused ?? false}
      preparingRetryCount={opts.preparingRetryCount ?? 0}
      clusterItems={opts.items}
      renderClusterItem={({ item }) => (
        <View>
          <Text>{item.type}</Text>
        </View>
      )}
      onUpgrade={jest.fn()}
      onRetryAllFailed={opts.onRetryAllFailed ?? jest.fn()}
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

  it('U6: the denominator counts CACHED clusters too, not just the dispatched ones', () => {
    // Six locations, four of which came straight from the SQLite cache and are
    // already rendered as resolved rows. The dispatch controller's own
    // denominator is the count of clusters it was asked to fetch — two — so a
    // header sourced from it would read "0 of 2" over a list of six rows, and
    // would hit 100% with four rows still on screen. The header counts what is
    // SHOWN.
    const items: ClusterDisplayItem[] = [
      { type: 'suggestion', data: buildSuggestion('c-1'), cluster: buildCluster('c-1') },
      { type: 'suggestion', data: buildSuggestion('c-2'), cluster: buildCluster('c-2') },
      { type: 'photos-only', cluster: buildCluster('c-3') },
      { type: 'photos-only', cluster: buildCluster('c-4') },
      { type: 'pending', cluster: buildCluster('c-5') },
      { type: 'pending', cluster: buildCluster('c-6') },
    ];

    const { getByLabelText } = renderPhase({
      clusterIds: ['c-1', 'c-2', 'c-3', 'c-4', 'c-5', 'c-6'],
      items,
      fetching: true,
    });

    const header = getByLabelText('Processing 4 of 6 locations');
    expect(header.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 67 });
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

describe('SuggestionsPhase persistent status row (U9/R15)', () => {
  it('persists after a rate-limit stop and names the count that could not be checked', () => {
    // A 429 mid-import: two locations matched, three were left unchecked. The
    // header used to vanish the instant the last owner settled — precisely when
    // the partial stop needed explaining.
    const items: ClusterDisplayItem[] = [
      { type: 'photos-only', cluster: buildCluster('c-1') },
      { type: 'suggestion', data: buildSuggestion('c-2'), cluster: buildCluster('c-2') },
      buildFailedItem('c-3'),
      buildFailedItem('c-4'),
      buildFailedItem('c-5'),
    ];

    const { getByText } = renderPhase({
      clusterIds: ['c-1', 'c-2', 'c-3', 'c-4', 'c-5'],
      items,
      fetching: false,
    });

    expect(getByText("3 locations couldn't be checked")).toBeTruthy();
    expect(getByText('Retry All')).toBeTruthy();
  });

  it('disappears when every location resolved, retry-disabled ones aside', () => {
    // A quota-disabled failure offers no retry, so there is nothing to act on
    // and nothing to say beyond what its own card already says.
    const items: ClusterDisplayItem[] = [
      { type: 'photos-only', cluster: buildCluster('c-1') },
      buildFailedItem('c-2', { retryDisabled: true }),
    ];

    const { queryByText } = renderPhase({ clusterIds: ['c-1', 'c-2'], items, fetching: false });

    expect(queryByText(/couldn't be checked/)).toBeNull();
    expect(queryByText('Retry All')).toBeNull();
  });

  it('hands retry-all every retry-ENABLED failure and nothing else', () => {
    const onRetryAllFailed = jest.fn();
    const items: ClusterDisplayItem[] = [
      { type: 'photos-only', cluster: buildCluster('c-1') },
      buildFailedItem('c-2'),
      buildFailedItem('c-3', { retryDisabled: true }),
      buildFailedItem('c-4', { isRetrying: true }),
      buildFailedItem('c-5'),
    ];

    const { getByText } = renderPhase({
      clusterIds: ['c-1', 'c-2', 'c-3', 'c-4', 'c-5'],
      items,
      fetching: false,
      onRetryAllFailed,
    });

    fireEvent.press(getByText('Retry All'));

    expect(onRetryAllFailed).toHaveBeenCalledWith(['c-2', 'c-5']);
  });

  it('replaces the retry-all control with the in-progress header while a retry runs', () => {
    const items: ClusterDisplayItem[] = [
      buildFailedItem('c-2'),
      { type: 'pending', cluster: buildCluster('c-3') },
    ];

    const { queryByText, getByText } = renderPhase({
      clusterIds: ['c-2', 'c-3'],
      items,
      fetching: true,
    });

    expect(queryByText('Retry All')).toBeNull();
    expect(getByText('Processing 1 of 2 locations')).toBeTruthy();
  });

  it('names the re-preparation window instead of showing an unexplained pause', () => {
    // Released payloads have to be rebuilt and preparation is serial at the
    // native layer, so a large bulk retry is silent for a while before its first
    // request leaves.
    const items: ClusterDisplayItem[] = [
      { type: 'pending', cluster: buildCluster('c-1') },
      { type: 'pending', cluster: buildCluster('c-2') },
    ];

    const { getByText } = renderPhase({
      clusterIds: ['c-1', 'c-2'],
      items,
      fetching: true,
      preparingRetryCount: 2,
    });

    expect(getByText('Preparing 2 locations')).toBeTruthy();
  });

  it('shows a paused label with NO spinner, and holds the bar fill', () => {
    const items: ClusterDisplayItem[] = [
      { type: 'photos-only', cluster: buildCluster('c-1') },
      { type: 'pending', cluster: buildCluster('c-2') },
    ];

    const { getByLabelText, UNSAFE_queryAllByType } = renderPhase({
      clusterIds: ['c-1', 'c-2'],
      items,
      fetching: true,
      paused: true,
    });

    const header = getByLabelText('Paused — picks up where it left off when you return');
    // The bar keeps the progress already made rather than resetting.
    expect(header.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 50 });
    // A spinner over work that is not happening is what makes a stalled import
    // look healthy.
    expect(UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
  });

  it('says nothing about pausing when there is no fetch parked on it', () => {
    const items: ClusterDisplayItem[] = [{ type: 'photos-only', cluster: buildCluster('c-1') }];

    const { queryByText } = renderPhase({
      clusterIds: ['c-1'],
      items,
      fetching: false,
      paused: true,
    });

    expect(queryByText(/Paused/)).toBeNull();
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
