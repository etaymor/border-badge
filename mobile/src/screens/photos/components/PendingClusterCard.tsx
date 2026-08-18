/**
 * PendingClusterCard - a location whose place lookup has not answered yet.
 *
 * The NON-terminal state (U8/R10): the dispatch controller has accepted this
 * cluster and nothing has resolved it. Every accepted-but-unresolved location
 * renders one of these from the first frame, so a hundred-location import shows
 * a hundred rows immediately instead of the ~2 in the opening batch, and each
 * row resolves IN PLACE (R11) rather than appearing later at the end of the list.
 *
 * Built on LookupFailedCard's layout with the shared suggestion-card styles: the
 * cluster's photos are already on the device, so a photoless skeleton would be a
 * downgrade — the hero photo is what makes the row identifiable while it waits.
 * The title reuses the vocabulary the failed card already uses for its retrying
 * state ("Checking this location…") so a row that later fails and is retried
 * does not switch languages on the user.
 *
 * NO ACTION BUTTONS (R12). There is nothing to retry — the request has not come
 * back — and nothing to confirm. A pending row's only interactions are
 * swipe-to-skip (the SwipeToSkipCard wrapper in ClusterListItem) and tapping the
 * photo to open the gallery. The actions slot carries a small activity indicator
 * instead.
 *
 * R28: the card is labelled but does NOT announce on its own. Row-level live
 * regions are suppressed on the SwipeToSkipCard wrapper, because a hundred
 * simultaneous resolutions would otherwise flood a screen reader; the progress
 * header is the single announcing surface.
 *
 * NEVER animate this card's height — see the note in SwipeToSkipCard.
 */

import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { LocationClusterDisplay } from '@services/photoImport';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { styles } from '../photoImportStyles';
import { formatDateRange } from '../photoImportHelpers';
import { PhotoThumbnail } from './PhotoThumbnail';

export interface PendingClusterCardProps {
  cluster: LocationClusterDisplay;
  onPhotoPress: (uri: string) => void;
}

export function PendingClusterCard({ cluster, onPhotoPress }: PendingClusterCardProps) {
  const photoLabel = `${cluster.photoCount} photo${cluster.photoCount !== 1 ? 's' : ''}`;
  const dateLabel = formatDateRange(cluster.timeRange.start, cluster.timeRange.end);

  return (
    <View
      style={styles.suggestionCard}
      accessibilityLabel={`Checking this location, ${photoLabel}`}
    >
      {/* Hero image — same structure as LookupFailedCard / PhotoClusterCard. */}
      <View style={styles.suggestionHeroContainer}>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => onPhotoPress(cluster.previewUris[0])}
          style={{ flex: 1 }}
        >
          <PhotoThumbnail
            uri={cluster.previewUris[0]}
            assetId={cluster.previewAssetIds[0]}
            style={styles.suggestionHeroImage}
            contentFit="cover"
            transition={200}
          />
          {cluster.photoCount > 1 && (
            <View style={localStyles.photoCountOverlay}>
              <Text style={localStyles.photoCountText}>+{cluster.photoCount - 1}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <View style={localStyles.content}>
        <Text style={localStyles.title}>Checking this location…</Text>
        {/* Photo count + dates keep the row identifiable while it has no name. */}
        <Text style={localStyles.subtitle}>
          {photoLabel} · {dateLabel}
        </Text>

        <View style={localStyles.actionsRow}>
          <ActivityIndicator size="small" color={colors.sunsetGold} />
        </View>
      </View>
    </View>
  );
}

const localStyles = StyleSheet.create({
  content: {
    padding: 16,
  },
  photoCountOverlay: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  photoCountText: {
    fontFamily: fonts.openSans.bold,
    fontSize: 14,
    color: colors.white,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginBottom: 2,
  },
  subtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // Matches the height the failed card's action buttons occupy, so a row that
    // resolves from pending to lookup-failed does not jump.
    minHeight: 40,
  },
});
