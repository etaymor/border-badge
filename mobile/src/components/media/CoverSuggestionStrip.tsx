/**
 * Horizontal strip of suggested cover photos from the on-device library.
 *
 * Purely presentational: the caller owns the candidates (see
 * `useCoverPhotoSuggestions`) and what a tap does. Renders NOTHING when there
 * is nothing to suggest — no empty state, no "scan your library" pitch — so a
 * user who never ran a photo import sees exactly today's cover control.
 *
 * Cover candidates are old photos, the population most likely to be
 * iCloud-offloaded, so each thumbnail recovers from a failed load by
 * re-resolving a fresh URI via `resolveLoadableUri` once (the same recovery the
 * imported-photo thumbnails use).
 */

import { memo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { resolveLoadableUri } from '@services/photoImport/resolveLoadableUri';
import type { CachedPhoto } from '@services/photoImport/types';

const THUMBNAIL_SIZE = 72;

interface CoverSuggestionStripProps {
  photos: CachedPhoto[];
  onSelect: (photo: CachedPhoto, index: number) => void;
  disabled?: boolean;
}

interface SuggestionThumbnailProps {
  photo: CachedPhoto;
  index: number;
  onSelect: (photo: CachedPhoto, index: number) => void;
  disabled: boolean;
}

function SuggestionThumbnail({ photo, index, onSelect, disabled }: SuggestionThumbnailProps) {
  const [uri, setUri] = useState(photo.uri);
  const [retried, setRetried] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleError = async () => {
    if (!retried) {
      setRetried(true);
      const fresh = await resolveLoadableUri(photo.id);
      if (fresh && fresh !== uri) {
        setUri(fresh);
        return;
      }
    }
    setFailed(true);
  };

  return (
    <Pressable
      style={[styles.thumbnail, disabled && styles.thumbnailDisabled]}
      onPress={() => onSelect(photo, index)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Use this photo as the cover"
      testID={`cover-suggestion-${photo.id}`}
    >
      {!failed && (
        <Image
          source={{ uri }}
          style={styles.thumbnailImage}
          contentFit="cover"
          transition={200}
          recyclingKey={uri}
          onError={handleError}
        />
      )}
    </Pressable>
  );
}

export const CoverSuggestionStrip = memo(function CoverSuggestionStrip({
  photos,
  onSelect,
  disabled = false,
}: CoverSuggestionStripProps) {
  // Nothing to suggest: render nothing at all (no empty state).
  if (photos.length === 0) return null;

  return (
    <View style={styles.container} testID="cover-suggestion-strip">
      <Text style={styles.label}>SUGGESTED</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
      >
        {photos.map((photo, index) => (
          <SuggestionThumbnail
            key={photo.id}
            photo={photo}
            index={index}
            onSelect={onSelect}
            disabled={disabled}
          />
        ))}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  label: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.midnightNavy,
    marginBottom: 8,
    letterSpacing: 1.5,
    opacity: 0.7,
    textTransform: 'uppercase',
  },
  list: {
    gap: 8,
  },
  thumbnail: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.backgroundMuted,
  },
  thumbnailDisabled: {
    opacity: 0.5,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
});
