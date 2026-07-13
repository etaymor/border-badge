/**
 * Tests for PhotoThumbnail.
 *
 * Reproduces and guards the "blank gray box" bug: an imported-photo URI that is
 * present but fails to load in expo-image. PhotoThumbnail must:
 *  - re-resolve a fresh loadable URI (via resolveLoadableUri) on the first load
 *    error when an assetId is available, and re-render with it;
 *  - fall back to a visible placeholder (not a bare gray box) when the retry
 *    also fails, when there is no assetId, or when there is no uri at all;
 *  - not loop: a second error after a resolved retry shows the placeholder;
 *  - reset its failed/retry state when the uri prop changes (FlashList recycling).
 */

/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

import { PhotoThumbnail } from '../../../screens/photos/components/PhotoThumbnail';
import { resolveLoadableUri } from '../../../services/photoImport/resolveLoadableUri';

jest.mock('../../../services/photoImport/resolveLoadableUri', () => ({
  resolveLoadableUri: jest.fn(),
}));

// expo-image mock that surfaces the current source uri and lets a test fire
// the onError callback (the real Image calls it when a uri fails to load).
jest.mock('expo-image', () => {
  const mockReact = require('react');
  return {
    Image: ({
      source,
      onError,
      style,
    }: {
      source: { uri?: string };
      onError?: () => void;
      style: unknown;
    }) =>
      mockReact.createElement('Image', {
        testID: 'photo-thumbnail-image',
        source,
        onError,
        style,
      }),
  };
});

const mockResolveLoadableUri = resolveLoadableUri as jest.Mock;

const getImage = (utils: ReturnType<typeof render>) => utils.getByTestId('photo-thumbnail-image');

describe('PhotoThumbnail', () => {
  beforeEach(() => {
    mockResolveLoadableUri.mockReset();
  });

  it('renders the given uri', () => {
    const utils = render(<PhotoThumbnail uri="file:///a.jpg" assetId="asset-1" />);
    expect(getImage(utils).props.source.uri).toBe('file:///a.jpg');
  });

  it('re-resolves and swaps to a fresh uri when the original fails to load', async () => {
    mockResolveLoadableUri.mockResolvedValue('file:///fresh.jpg');

    const utils = render(<PhotoThumbnail uri="ph://stale" assetId="asset-1" />);

    fireEvent(getImage(utils), 'error');

    await waitFor(() => {
      expect(getImage(utils).props.source.uri).toBe('file:///fresh.jpg');
    });
    expect(mockResolveLoadableUri).toHaveBeenCalledWith('asset-1');
  });

  it('shows the placeholder when the retry cannot resolve a uri', async () => {
    mockResolveLoadableUri.mockResolvedValue(null);

    const utils = render(<PhotoThumbnail uri="ph://stale" assetId="asset-1" />);

    fireEvent(getImage(utils), 'error');

    await waitFor(() => {
      expect(utils.getByTestId('photo-thumbnail-placeholder')).toBeTruthy();
    });
    expect(utils.queryByTestId('photo-thumbnail-image')).toBeNull();
  });

  it('shows the placeholder immediately on error when there is no assetId', async () => {
    const utils = render(<PhotoThumbnail uri="ph://stale" />);

    fireEvent(getImage(utils), 'error');

    await waitFor(() => {
      expect(utils.getByTestId('photo-thumbnail-placeholder')).toBeTruthy();
    });
    expect(mockResolveLoadableUri).not.toHaveBeenCalled();
  });

  it('does not retry more than once (second failure shows placeholder)', async () => {
    mockResolveLoadableUri.mockResolvedValue('file:///fresh.jpg');

    const utils = render(<PhotoThumbnail uri="ph://stale" assetId="asset-1" />);

    // First error → resolves fresh uri.
    fireEvent(getImage(utils), 'error');
    await waitFor(() => {
      expect(getImage(utils).props.source.uri).toBe('file:///fresh.jpg');
    });

    // The fresh uri also fails → placeholder, and no second resolve attempt.
    fireEvent(getImage(utils), 'error');
    await waitFor(() => {
      expect(utils.getByTestId('photo-thumbnail-placeholder')).toBeTruthy();
    });
    expect(mockResolveLoadableUri).toHaveBeenCalledTimes(1);
  });

  it('renders the placeholder when no uri is provided', () => {
    const utils = render(<PhotoThumbnail uri={undefined} assetId="asset-1" />);
    expect(utils.getByTestId('photo-thumbnail-placeholder')).toBeTruthy();
    expect(utils.queryByTestId('photo-thumbnail-image')).toBeNull();
  });

  it('resets failed state when the uri prop changes (recycling)', async () => {
    mockResolveLoadableUri.mockResolvedValue(null);

    const utils = render(<PhotoThumbnail uri="ph://stale" assetId="asset-1" />);
    fireEvent(getImage(utils), 'error');
    await waitFor(() => {
      expect(utils.getByTestId('photo-thumbnail-placeholder')).toBeTruthy();
    });

    // FlashList recycles the cell with a new photo — the image should render again.
    utils.rerender(<PhotoThumbnail uri="file:///b.jpg" assetId="asset-2" />);

    expect(getImage(utils).props.source.uri).toBe('file:///b.jpg');
    expect(utils.queryByTestId('photo-thumbnail-placeholder')).toBeNull();
  });
});
