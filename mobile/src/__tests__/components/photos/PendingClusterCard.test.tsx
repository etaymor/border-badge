/**
 * Tests for PendingClusterCard (U8 / R10 / R12 / R28).
 *
 * The pending card is the non-terminal state: the controller accepted this
 * cluster and nothing has resolved it yet. It must:
 *  - stay identifiable while it waits (hero photo, photo count, date range)
 *  - offer NO action buttons (R12) — there is nothing to retry or confirm
 *  - show a small activity indicator in the actions slot instead
 *  - carry a label naming its state and photo count, without announcing (R28)
 */

/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { render } from '@testing-library/react-native';
import { ActivityIndicator, TouchableOpacity } from 'react-native';

import { PendingClusterCard } from '../../../screens/photos/components/PendingClusterCard';
import type { LocationClusterDisplay } from '../../../services/photoImport';

jest.mock('expo-image', () => {
  const mockReact = require('react');
  return {
    Image: ({ style }: { style: unknown }) =>
      mockReact.createElement('Image', { style, testID: 'hero-image' }),
  };
});

const buildCluster = (overrides: Partial<LocationClusterDisplay> = {}): LocationClusterDisplay => ({
  id: 'cluster-pending',
  geohash: 'ghxxxxx',
  centroid: { latitude: 35.0, longitude: 139.0 },
  photoIds: ['p1', 'p2', 'p3'],
  photoCount: 3,
  previewUris: [
    'https://example.com/p1.jpg',
    'https://example.com/p2.jpg',
    'https://example.com/p3.jpg',
  ],
  previewAssetIds: ['p1', 'p2', 'p3'],
  timeRange: { start: new Date('2026-01-01T10:00:00Z'), end: new Date('2026-01-01T12:00:00Z') },
  countryCode: 'JP',
  ...overrides,
});

describe('PendingClusterCard', () => {
  it('exposes NO action buttons — only the photo is tappable (R12)', () => {
    const { UNSAFE_getAllByType, queryByText } = render(
      <PendingClusterCard cluster={buildCluster()} onPhotoPress={jest.fn()} />
    );

    // The single TouchableOpacity is the hero photo. A Retry / Add Manually /
    // Confirm button here would offer an action against a request that has not
    // come back yet.
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    expect(touchables).toHaveLength(1);
    expect(queryByText('Retry')).toBeNull();
    expect(queryByText('Add Manually')).toBeNull();
  });

  it('shows an activity indicator in the actions slot', () => {
    const { UNSAFE_getAllByType } = render(
      <PendingClusterCard cluster={buildCluster()} onPhotoPress={jest.fn()} />
    );

    expect(UNSAFE_getAllByType(ActivityIndicator)).toHaveLength(1);
  });

  it('stays identifiable: the failed card’s retrying vocabulary, plus photo count and dates', () => {
    const { getByText } = render(
      <PendingClusterCard cluster={buildCluster()} onPhotoPress={jest.fn()} />
    );

    // Same words LookupFailedCard uses while a retry is in flight, so a row that
    // fails and is retried does not switch languages on the user.
    expect(getByText('Checking this location…')).toBeTruthy();
    expect(getByText(/3 photos/)).toBeTruthy();
    // The date range keeps the row distinguishable from its neighbours.
    expect(getByText(/Jan/)).toBeTruthy();
  });

  it('carries a state + photo-count label for the screen reader (R28)', () => {
    const { getByLabelText } = render(
      <PendingClusterCard cluster={buildCluster({ photoCount: 1 })} onPhotoPress={jest.fn()} />
    );

    expect(getByLabelText('Checking this location, 1 photo')).toBeTruthy();
  });

  it('opens the gallery on the hero photo', () => {
    const onPhotoPress = jest.fn();
    const { UNSAFE_getAllByType } = render(
      <PendingClusterCard cluster={buildCluster()} onPhotoPress={onPhotoPress} />
    );

    UNSAFE_getAllByType(TouchableOpacity)[0].props.onPress();
    expect(onPhotoPress).toHaveBeenCalledWith('https://example.com/p1.jpg');
  });
});
