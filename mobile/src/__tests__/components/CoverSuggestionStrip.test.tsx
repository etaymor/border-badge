/**
 * Tests for CoverSuggestionStrip.
 *
 * The strip must be ABSENT (not an empty state) when there is nothing to
 * suggest, must hand the chosen photo back to its caller, and must recover a
 * failed thumbnail load once via resolveLoadableUri — cover candidates are old
 * photos, the population iCloud is most likely to have offloaded.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { CoverSuggestionStrip } from '../../components/media/CoverSuggestionStrip';
import { resolveLoadableUri } from '../../services/photoImport/resolveLoadableUri';
import type { CachedPhoto } from '../../services/photoImport/types';

jest.mock('../../services/photoImport/resolveLoadableUri', () => ({
  resolveLoadableUri: jest.fn(),
}));

jest.mock('expo-image', () => {
  const mockReact = require('react');
  return {
    Image: ({ source, onError }: { source: { uri?: string }; onError?: () => void }) =>
      mockReact.createElement('Image', {
        testID: `cover-suggestion-image-${source.uri}`,
        source,
        onError,
      }),
  };
});

const mockResolveLoadableUri = resolveLoadableUri as jest.Mock;

function photo(id: string): CachedPhoto {
  return {
    id,
    uri: `ph://${id}`,
    filename: `${id}.HEIC`,
    creationTime: 1_700_000_000_000,
    latitude: 35.01,
    longitude: 135.76,
    geohash: 'xn0m7ky',
    countryCode: 'JP',
  };
}

describe('CoverSuggestionStrip', () => {
  beforeEach(() => {
    mockResolveLoadableUri.mockReset();
  });

  it('renders nothing when there are no suggestions', () => {
    const { queryByTestId } = render(<CoverSuggestionStrip photos={[]} onSelect={jest.fn()} />);
    expect(queryByTestId('cover-suggestion-strip')).toBeNull();
  });

  it('renders a thumbnail per suggestion and reports the chosen one with its index', () => {
    const onSelect = jest.fn();
    const photos = [photo('a'), photo('b')];
    const { getByTestId } = render(<CoverSuggestionStrip photos={photos} onSelect={onSelect} />);

    fireEvent.press(getByTestId('cover-suggestion-b'));
    expect(onSelect).toHaveBeenCalledWith(photos[1], 1);
  });

  it('does not fire onSelect while disabled', () => {
    const onSelect = jest.fn();
    const { getByTestId } = render(
      <CoverSuggestionStrip photos={[photo('a')]} onSelect={onSelect} disabled />
    );

    fireEvent.press(getByTestId('cover-suggestion-a'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('re-resolves a fresh uri once when a thumbnail fails to load', async () => {
    mockResolveLoadableUri.mockResolvedValue('file:///fresh.jpg');
    const { getByTestId } = render(
      <CoverSuggestionStrip photos={[photo('a')]} onSelect={jest.fn()} />
    );

    fireEvent(getByTestId('cover-suggestion-image-ph://a'), 'error');

    await waitFor(() =>
      expect(getByTestId('cover-suggestion-image-file:///fresh.jpg')).toBeTruthy()
    );
    expect(mockResolveLoadableUri).toHaveBeenCalledTimes(1);
  });
});
