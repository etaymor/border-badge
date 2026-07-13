/**
 * Tests for resolveLoadableUri.
 *
 * Reproduces the "blank thumbnail" bug: an imported-photo URI (a stale file://
 * localUri or a volatile ph:// URI) fails to load in expo-image. The fix re-asks
 * MediaLibrary for a fresh, on-device URI — forcing an iCloud download if needed —
 * so the thumbnail can recover instead of showing a blank gray box.
 */

import * as MediaLibrary from 'expo-media-library';

import { resolveLoadableUri } from '../../../services/photoImport/resolveLoadableUri';

jest.mock('expo-media-library', () => ({
  getAssetInfoAsync: jest.fn(),
}));

const mockGetAssetInfoAsync = MediaLibrary.getAssetInfoAsync as jest.Mock;

describe('resolveLoadableUri', () => {
  beforeEach(() => {
    mockGetAssetInfoAsync.mockReset();
  });

  it('forces an iCloud download so offloaded photos materialize', async () => {
    mockGetAssetInfoAsync.mockResolvedValue({ localUri: 'file:///fresh.jpg', uri: 'ph://asset' });

    await resolveLoadableUri('asset-1');

    expect(mockGetAssetInfoAsync).toHaveBeenCalledWith('asset-1', {
      shouldDownloadFromNetwork: true,
    });
  });

  it('prefers localUri when present', async () => {
    mockGetAssetInfoAsync.mockResolvedValue({ localUri: 'file:///fresh.jpg', uri: 'ph://asset' });

    await expect(resolveLoadableUri('asset-1')).resolves.toBe('file:///fresh.jpg');
  });

  it('falls back to uri when there is no localUri', async () => {
    mockGetAssetInfoAsync.mockResolvedValue({ localUri: undefined, uri: 'ph://asset' });

    await expect(resolveLoadableUri('asset-1')).resolves.toBe('ph://asset');
  });

  it('returns null when neither localUri nor uri is available', async () => {
    mockGetAssetInfoAsync.mockResolvedValue({});

    await expect(resolveLoadableUri('asset-1')).resolves.toBeNull();
  });

  it('returns null instead of throwing when the lookup fails', async () => {
    mockGetAssetInfoAsync.mockRejectedValue(new Error('asset deleted'));

    await expect(resolveLoadableUri('asset-1')).resolves.toBeNull();
  });

  it('returns null for an empty asset id without calling MediaLibrary', async () => {
    await expect(resolveLoadableUri('')).resolves.toBeNull();
    expect(mockGetAssetInfoAsync).not.toHaveBeenCalled();
  });
});
