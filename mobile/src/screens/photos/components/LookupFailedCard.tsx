/**
 * LookupFailedCard - Displays a photo cluster whose place lookup FAILED.
 *
 * This is the terminal `lookup-failed` state (KTD6): a transient API/chunk error
 * (or a never-attempted cluster) — NOT a confident "no place found". It is a
 * distinct card from PhotoClusterCard (photos-only / genuine empty) so the user
 * sees an honest "couldn't check" message with a Retry affordance instead of a
 * misleading empty.
 *
 * Mirrors PhotoClusterCard's hero image + photo-count overlay structure (same
 * Ionicons vocabulary — no novel icons). Skipping is handled by the
 * SwipeToSkipCard wrapper in ClusterListItem, not here. When `retryDisabled` is
 * true (429/503 quota/rate-limit, KTD10) the active Retry button is replaced with
 * a time-gated message, since an immediate retry would just fail again.
 *
 * `onRetry` invokes U10's scoped re-fetch (`retryFailedClusters`). While that
 * re-fetch is in flight for this cluster, `isRetrying` is true: the Retry button
 * shows a spinner and is disabled so a double-tap can't double-fire.
 */

import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { LocationClusterDisplay } from '@services/photoImport';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { styles } from '../photoImportStyles';
import { PhotoThumbnail } from './PhotoThumbnail';

export interface LookupFailedCardProps {
  cluster: LocationClusterDisplay;
  /** True for 429/503 quota/rate-limit — show the time-gated message, hide retry. */
  retryDisabled: boolean;
  /** True while U10's scoped re-fetch is in flight for this cluster (U10). */
  isRetrying?: boolean;
  onRetry: (clusterId: string) => void;
  onAddEntry: (cluster: LocationClusterDisplay) => void;
  onPhotoPress: (uri: string) => void;
}

export function LookupFailedCard({
  cluster,
  retryDisabled,
  isRetrying = false,
  onRetry,
  onAddEntry,
  onPhotoPress,
}: LookupFailedCardProps) {
  return (
    <View style={styles.suggestionCard}>
      {/* Hero Image - matching PhotoClusterCard style */}
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
          {/* Photo count overlay */}
          {cluster.photoCount > 1 && (
            <View style={localStyles.photoCountOverlay}>
              <Text style={localStyles.photoCountText}>+{cluster.photoCount - 1}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Content section */}
      <View style={localStyles.content}>
        <Text style={localStyles.title}>{"Couldn't check this location"}</Text>

        {retryDisabled ? (
          <Text
            style={localStyles.subtitle}
            accessibilityLabel="Daily limit reached, try again later"
          >
            Daily limit reached — try again later
          </Text>
        ) : isRetrying ? (
          <Text style={localStyles.subtitle}>Checking this location…</Text>
        ) : (
          <Text style={localStyles.subtitle}>Tap to retry the place lookup</Text>
        )}

        <View style={localStyles.actionsRow}>
          {!retryDisabled && (
            <TouchableOpacity
              style={localStyles.retryButton}
              onPress={() => onRetry(cluster.id)}
              disabled={isRetrying}
              accessibilityRole="button"
              accessibilityState={{ disabled: isRetrying }}
              accessibilityLabel="Retry place lookup"
            >
              {isRetrying ? (
                <ActivityIndicator size="small" color={colors.midnightNavy} />
              ) : (
                <>
                  <Ionicons name="refresh-outline" size={18} color={colors.midnightNavy} />
                  <Text style={localStyles.retryText}>Retry</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={localStyles.addManuallyButton}
            onPress={() => onAddEntry(cluster)}
            accessibilityRole="button"
            accessibilityLabel="Add entry manually"
          >
            <Ionicons name="add" size={18} color={colors.midnightNavy} />
            <Text style={localStyles.addManuallyText}>Add Manually</Text>
          </TouchableOpacity>
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
    flexWrap: 'wrap',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sunsetGold,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 24,
    marginRight: 12,
  },
  retryText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
    marginLeft: 6,
  },
  addManuallyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.midnightNavyLight,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 24,
  },
  addManuallyText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
    marginLeft: 6,
  },
});
