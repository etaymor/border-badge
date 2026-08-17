import React from 'react';
import { render } from '@testing-library/react-native';

import { NearbyPhotoSuggestions } from '../../components/entries/NearbyPhotoSuggestions';

// Mock Ionicons to avoid native module issues
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

const makeCachedPhoto = (id: string) => ({
  id,
  uri: `file:///photos/${id}.jpg`,
  filename: `${id}.jpg`,
  creationTime: Date.now(),
  latitude: 35.6762,
  longitude: 139.6503,
  geohash: 'xn76urx',
  countryCode: 'JP',
});

describe('NearbyPhotoSuggestions', () => {
  const defaultProps = {
    photos: [],
    isLoading: false,
    cacheExists: true,
    onPhotoSelect: jest.fn(),
    remainingSlots: 5,
    addedPhotoIds: new Set<string>(),
  };

  /**
   * Bug #4: Loading state flashes the section label before photos are found.
   *
   * When isLoading is true, the component renders the "PHOTOS FROM YOUR LIBRARY"
   * label with a spinner. When loading finishes with 0 results, the component
   * returns null. This causes a flash of the label that's jarring to the user.
   *
   * Expected: when isLoading is true but we don't yet know if there will be
   * results, the component should not render the label to avoid flashing.
   */
  it('should not render the label while loading (avoids flash)', () => {
    const { queryByText } = render(<NearbyPhotoSuggestions {...defaultProps} isLoading={true} />);

    // The label should NOT be visible during loading to prevent flash
    expect(queryByText('PHOTOS FROM YOUR LIBRARY')).toBeNull();
  });

  it('should render photos when available', () => {
    const photos = [makeCachedPhoto('photo-1'), makeCachedPhoto('photo-2')];

    const { getByText, getAllByLabelText } = render(
      <NearbyPhotoSuggestions {...defaultProps} photos={photos} />
    );

    expect(getByText('PHOTOS FROM YOUR LIBRARY')).toBeTruthy();
    expect(getAllByLabelText('Add photo to entry')).toHaveLength(2);
  });

  it('should return null when no nearby photos found', () => {
    const { toJSON } = render(<NearbyPhotoSuggestions {...defaultProps} photos={[]} />);

    expect(toJSON()).toBeNull();
  });

  it('should show hint when cache does not exist', () => {
    const { getByText } = render(<NearbyPhotoSuggestions {...defaultProps} cacheExists={false} />);

    expect(getByText('Scan your photo library to see nearby photos here')).toBeTruthy();
  });
});
