/**
 * Resolve a fresh, loadable URI for a MediaLibrary asset.
 *
 * Imported-photo thumbnails render from URIs captured during the library scan
 * (`info.localUri ?? info.uri ?? asset.uri`, see photoImportService). The scan
 * deliberately passes `shouldDownloadFromNetwork: false` for speed, so for an
 * iCloud-offloaded photo the captured URI may be a volatile `ph://` (or a
 * `file://` localUri that later gets evicted). Either fails to load in
 * expo-image, leaving a blank gray box.
 *
 * When a thumbnail's URI fails to load, callers re-resolve it here with
 * `shouldDownloadFromNetwork: true` — forcing materialization from iCloud and
 * returning a fresh on-device URI. This turns the fast bulk-scan default into a
 * lazy, on-demand download only for the handful of thumbnails actually failing.
 *
 * Returns null (never throws) when the asset can't be resolved — a deleted
 * asset, revoked permission, or offline with no cached copy — so callers can
 * fall back to a placeholder.
 */

import * as MediaLibrary from 'expo-media-library';

export async function resolveLoadableUri(assetId: string): Promise<string | null> {
  if (!assetId) return null;

  try {
    const info = await MediaLibrary.getAssetInfoAsync(assetId, {
      // Opposite of the scan default: pay the download cost now, on-demand,
      // for a photo whose captured URI failed to load.
      shouldDownloadFromNetwork: true,
    });
    // Keep the same localUri-over-uri preference used at scan time.
    return info.localUri ?? info.uri ?? null;
  } catch {
    return null;
  }
}
