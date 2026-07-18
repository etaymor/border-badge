/**
 * Tests for LookupFailedCard (U9 / KTD10).
 *
 * The lookup-failed terminal card must:
 *  - render the cluster photos + an "Add Manually" affordance
 *  - render an active Retry button when retryDisabled=false and call onRetry
 *  - render a time-gated message (no active Retry button) when retryDisabled=true
 *
 * Skipping is no longer this card's concern -- it moved to the SwipeToSkipCard
 * wrapper in ClusterListItem, which has its own tests.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { LookupFailedCard } from '../../../screens/photos/components/LookupFailedCard';
import type { LocationClusterDisplay } from '../../../services/photoImport';

jest.mock('expo-image', () => {
  const mockReact = require('react');
  return {
    Image: ({ style }: { style: unknown }) =>
      mockReact.createElement('Image', { style, testID: 'hero-image' }),
  };
});

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

const buildCluster = (overrides: Partial<LocationClusterDisplay> = {}): LocationClusterDisplay => ({
  id: 'cluster-failed',
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

describe('LookupFailedCard', () => {
  it('renders an active Retry button (retryDisabled=false) and calls onRetry with the cluster id', () => {
    const onRetry = jest.fn();
    const { getByLabelText } = render(
      <LookupFailedCard
        cluster={buildCluster()}
        retryDisabled={false}
        onRetry={onRetry}
        onAddEntry={jest.fn()}
        onPhotoPress={jest.fn()}
      />
    );

    fireEvent.press(getByLabelText('Retry place lookup'));
    expect(onRetry).toHaveBeenCalledWith('cluster-failed');
  });

  it('renders the time-gated message and NO active Retry button when retryDisabled=true (KTD10)', () => {
    const onRetry = jest.fn();
    const { queryByLabelText, getByText } = render(
      <LookupFailedCard
        cluster={buildCluster()}
        retryDisabled={true}
        onRetry={onRetry}
        onAddEntry={jest.fn()}
        onPhotoPress={jest.fn()}
      />
    );

    expect(queryByLabelText('Retry place lookup')).toBeNull();
    expect(getByText(/Daily limit reached/i)).toBeTruthy();
  });

  it('renders the cluster hero photo and forwards onPhotoPress with the first preview uri', () => {
    const onPhotoPress = jest.fn();
    const { getByTestId } = render(
      <LookupFailedCard
        cluster={buildCluster()}
        retryDisabled={false}
        onRetry={jest.fn()}
        onAddEntry={jest.fn()}
        onPhotoPress={onPhotoPress}
      />
    );

    expect(getByTestId('hero-image')).toBeTruthy();
    fireEvent.press(getByTestId('hero-image'));
    expect(onPhotoPress).toHaveBeenCalledWith('https://example.com/p1.jpg');
  });

  it('renders the Add Manually affordance and calls onAddEntry with the cluster', () => {
    const onAddEntry = jest.fn();
    const cluster = buildCluster();
    const { getByLabelText } = render(
      <LookupFailedCard
        cluster={cluster}
        retryDisabled={false}
        onRetry={jest.fn()}
        onAddEntry={onAddEntry}
        onPhotoPress={jest.fn()}
      />
    );

    fireEvent.press(getByLabelText('Add entry manually'));
    expect(onAddEntry).toHaveBeenCalledWith(cluster);
  });

  it('shows the "couldn\'t check" title (distinct from the no-place-found card)', () => {
    const { getByText } = render(
      <LookupFailedCard
        cluster={buildCluster()}
        retryDisabled={false}
        onRetry={jest.fn()}
        onAddEntry={jest.fn()}
        onPhotoPress={jest.fn()}
      />
    );

    expect(getByText(/Couldn't check this location/i)).toBeTruthy();
  });

  it('disables the Retry button and does NOT call onRetry while isRetrying (U10 spinner)', () => {
    const onRetry = jest.fn();
    const { getByLabelText, getByText } = render(
      <LookupFailedCard
        cluster={buildCluster()}
        retryDisabled={false}
        isRetrying={true}
        onRetry={onRetry}
        onAddEntry={jest.fn()}
        onPhotoPress={jest.fn()}
      />
    );

    // The retry affordance is present but disabled; pressing it is a no-op.
    const retryButton = getByLabelText('Retry place lookup');
    fireEvent.press(retryButton);
    expect(onRetry).not.toHaveBeenCalled();
    // The in-flight subtitle is shown.
    expect(getByText(/Checking this location/i)).toBeTruthy();
  });
});
