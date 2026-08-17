/**
 * Tests for ManualPlaceSearch.
 *
 * Verifies the Save Place modal honors the carousel's photo deselections
 * (the `excludedPhotoIds` prop). Regression guard for a recurring bug where
 * the modal rendered every photo in the cluster regardless of selection.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { render } from '@testing-library/react-native';

import { ManualPlaceSearch } from '../../../screens/photos/components/ManualPlaceSearch';
import type { LocationCluster, PhotoWithLocation } from '../../../services/photoImport';

jest.mock('expo-image', () => {
  const mockReact = require('react');
  return {
    Image: ({ source, style }: { source?: { uri?: string }; style: unknown }) =>
      mockReact.createElement('Image', { style, source, testID: 'photo-image' }),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@components/ui', () => {
  const mockReact = require('react');
  const mockRN = require('react-native');
  return {
    Button: ({
      title,
      onPress,
      disabled,
    }: {
      title: string;
      onPress?: () => void;
      disabled?: boolean;
    }) => mockReact.createElement(mockRN.Text, { onPress, disabled }, title),
    GlassBackButton: ({ onPress }: { onPress?: () => void }) =>
      mockReact.createElement(mockRN.Text, { onPress }, 'Back'),
    GlassInput: ({ label }: { label?: string }) =>
      mockReact.createElement(mockRN.Text, null, label ?? 'input'),
  };
});

jest.mock('@components/places', () => {
  const mockReact = require('react');
  const mockRN = require('react-native');
  return {
    PlacesAutocomplete: () =>
      mockReact.createElement(mockRN.View, { testID: 'places-autocomplete' }),
  };
});

jest.mock('@components/entries', () => {
  const mockReact = require('react');
  const mockRN = require('react-native');
  return {
    CategorySelector: () => mockReact.createElement(mockRN.View, { testID: 'category-selector' }),
  };
});

jest.mock('@components/share/TripSelector', () => {
  const mockReact = require('react');
  const mockRN = require('react-native');
  return {
    TripSelector: () => mockReact.createElement(mockRN.View, { testID: 'trip-selector' }),
  };
});

const buildPhoto = (id: string): PhotoWithLocation => ({
  id,
  uri: `https://example.com/${id}.jpg`,
  filename: `${id}.jpg`,
  creationTime: new Date('2024-06-01T12:00:00Z'),
  location: { latitude: 0, longitude: 0 },
});

const buildCluster = (photoIds: string[]): LocationCluster => ({
  id: 'cluster-1',
  geohash: 'gh1',
  centroid: { latitude: 0, longitude: 0 },
  photos: photoIds.map(buildPhoto),
  timeRange: {
    start: new Date('2024-06-01T12:00:00Z'),
    end: new Date('2024-06-01T18:00:00Z'),
  },
  countryCode: 'US',
});

const baseProps = {
  countryCode: 'US',
  preSelectedTripId: 'trip-1',
  onSelect: jest.fn(),
  onCreateTrip: jest.fn(),
  onCancel: jest.fn(),
};

describe('ManualPlaceSearch photo filtering', () => {
  it('filters out excluded photos and updates the count', () => {
    const cluster = buildCluster(['p1', 'p2', 'p3', 'p4', 'p5']);
    const { getByText, getAllByTestId } = render(
      <ManualPlaceSearch
        {...baseProps}
        cluster={cluster}
        excludedPhotoIds={new Set(['p2', 'p4'])}
      />
    );

    expect(getByText('3 photos')).toBeTruthy();

    const images = getAllByTestId('photo-image');
    const renderedUris = images.map((img) => img.props.source?.uri).filter(Boolean);
    expect(renderedUris).toContain('https://example.com/p1.jpg');
    expect(renderedUris).not.toContain('https://example.com/p2.jpg');
    expect(renderedUris).not.toContain('https://example.com/p4.jpg');
  });

  it('uses the first non-excluded photo as the main image', () => {
    const cluster = buildCluster(['p1', 'p2', 'p3']);
    const { getAllByTestId } = render(
      <ManualPlaceSearch {...baseProps} cluster={cluster} excludedPhotoIds={new Set(['p1'])} />
    );

    const mainImage = getAllByTestId('photo-image')[0];
    expect(mainImage.props.source?.uri).toBe('https://example.com/p2.jpg');
  });

  it('renders all photos when no excludedPhotoIds prop is provided', () => {
    const cluster = buildCluster(['p1', 'p2', 'p3', 'p4', 'p5']);
    const { getByText } = render(<ManualPlaceSearch {...baseProps} cluster={cluster} />);

    expect(getByText('5 photos')).toBeTruthy();
  });

  it('treats an empty exclusion set as no exclusions', () => {
    const cluster = buildCluster(['p1', 'p2']);
    const { getByText } = render(
      <ManualPlaceSearch {...baseProps} cluster={cluster} excludedPhotoIds={new Set()} />
    );

    expect(getByText('2 photos')).toBeTruthy();
  });
});
