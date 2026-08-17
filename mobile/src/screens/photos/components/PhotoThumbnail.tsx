/**
 * PhotoThumbnail - resilient wrapper around expo-image for imported photos.
 *
 * Imported-photo thumbnails render from URIs captured during the library scan.
 * Some of those URIs fail to load (an iCloud-offloaded photo whose captured URI
 * is a volatile `ph://`, or a `file://` localUri that was later evicted),
 * leaving a blank gray box with no feedback.
 *
 * This component recovers from that:
 *  1. On the first load error, if an `assetId` is available, it re-resolves a
 *     fresh, on-device URI via `resolveLoadableUri` (forcing an iCloud download)
 *     and re-renders with it.
 *  2. If that retry also fails — or there is no `assetId`, or no URI at all — it
 *     renders a subtle placeholder instead of a bare gray container.
 *
 * State is keyed off the incoming `uri` so a recycled FlashList cell (new photo,
 * same component instance) resets cleanly instead of showing the previous
 * photo's failed/placeholder state.
 */

import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ImageStyle } from 'react-native';
import { Image, type ImageContentFit } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@constants/colors';
import { resolveLoadableUri } from '@services/photoImport';

export interface PhotoThumbnailProps {
  /** Initial URI captured at scan time. May be a stale/volatile URI. */
  uri?: string;
  /**
   * MediaLibrary asset id for `uri`. Enables the on-error re-resolve. Without
   * it, a failed load falls straight through to the placeholder.
   */
  assetId?: string;
  style?: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
  transition?: number;
}

export function PhotoThumbnail({
  uri,
  assetId,
  style,
  contentFit = 'cover',
  transition = 200,
}: PhotoThumbnailProps) {
  // Effective URI shown by <Image>; seeded from the prop, swapped on retry.
  const [effectiveUri, setEffectiveUri] = useState(uri);
  // The prop URI this state corresponds to. When the prop changes (recycling),
  // we reset during render — the standard React pattern for prop-derived state.
  const [seedUri, setSeedUri] = useState(uri);
  const [retried, setRetried] = useState(false);
  const [failed, setFailed] = useState(false);

  if (uri !== seedUri) {
    setSeedUri(uri);
    setEffectiveUri(uri);
    setRetried(false);
    setFailed(false);
  }

  const handleError = async () => {
    // First failure with an asset id: try to re-resolve a fresh, loadable URI.
    if (!retried && assetId) {
      setRetried(true);
      const fresh = await resolveLoadableUri(assetId);
      if (fresh && fresh !== effectiveUri) {
        setEffectiveUri(fresh);
        return;
      }
    }
    // No id, already retried, or re-resolve failed → show the placeholder.
    setFailed(true);
  };

  if (!effectiveUri || failed) {
    return (
      <View style={[styles.placeholder, style]} testID="photo-thumbnail-placeholder">
        <Ionicons name="image-outline" size={28} color={colors.textTertiary} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri: effectiveUri }}
      style={style}
      contentFit={contentFit}
      transition={transition}
      recyclingKey={effectiveUri}
      onError={handleError}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: colors.backgroundMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
