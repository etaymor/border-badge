/**
 * Suggestions phase UI for the photo import screen.
 *
 * Shows trip info header, premium gate, progress indicator, and cluster suggestion list.
 */

import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { FlashList, ListRenderItem } from '@shopify/flash-list';

import { Button } from '@components/ui';
import type { TripCandidateDisplay } from '@services/photoImport';
import { colors } from '@constants/colors';
import { getFlagEmoji } from '@utils/flags';
import type { ClusterDisplayItem } from '../photoImportHelpers';
import { formatDateRange } from '../photoImportHelpers';
import { styles } from '../photoImportStyles';

export interface SuggestionsPhaseProps {
  selectedCandidate: TripCandidateDisplay;
  selectedTripName: string;
  selectedCountryName: string;
  isPremium: boolean;
  canImportPhotos: boolean;
  fetchingSuggestions: boolean;
  clusterItems: ClusterDisplayItem[];
  renderClusterItem: ListRenderItem<ClusterDisplayItem>;
  onUpgrade: () => void;
}

export function SuggestionsPhase({
  selectedCandidate,
  selectedTripName,
  selectedCountryName,
  isPremium,
  canImportPhotos,
  fetchingSuggestions,
  clusterItems,
  renderClusterItem,
  onUpgrade,
}: SuggestionsPhaseProps) {
  // ONE progress source (U8). The header used to read the dispatch controller's
  // own counters while the list rendered a different set of rows, so the two
  // disagreed: the controller counts only the uncached clusters it dispatched,
  // the list shows every cluster including cached and dismissed ones. Both now
  // derive from the rendered rows, so "N of M" is literally "M rows, N of them
  // no longer pending".
  const pendingCount = clusterItems.filter((item) => item.type === 'pending').length;
  const totalCount = clusterItems.length;
  const settledCount = totalCount - pendingCount;
  const percentage = totalCount > 0 ? Math.round((settledCount / totalCount) * 100) : 0;

  // The progress header renders for the WHOLE fetch, including the pre-dispatch
  // window (SQLite cache read + vision prep) where no cluster has been accepted
  // yet and there are no rows at all. Fall back to the candidate's own cluster
  // count so the spinner still carries a count instead of a bare "Searching...".
  const clusterCount = selectedCandidate.locationClusterIds.length;
  const progressLabel =
    totalCount > 0
      ? `Processing ${settledCount} of ${totalCount} locations`
      : `Preparing ${clusterCount} ${clusterCount === 1 ? 'location' : 'locations'}`;

  return (
    <View style={styles.listContainer}>
      {selectedTripName && <Text style={styles.tripName}>{selectedTripName}</Text>}
      <Text style={styles.tripMeta}>
        {getFlagEmoji(selectedCandidate.countryCode)} {selectedCountryName}
      </Text>
      <Text style={styles.tripDates}>
        {formatDateRange(selectedCandidate.dateRange.start, selectedCandidate.dateRange.end)}
      </Text>

      {!isPremium && !canImportPhotos && (
        <View style={styles.premiumGateBanner}>
          <Text style={styles.premiumGateTitle}>Free Limit Reached</Text>
          <Text style={styles.premiumGateText}>
            {"You've already imported one trip from photos. Upgrade to import unlimited trips."}
          </Text>
          <Button title="Upgrade to Premium" onPress={onUpgrade} style={styles.premiumGateButton} />
        </View>
      )}

      {/* R28: the ONE announcing surface. Individual rows are marked
          non-announcing (SwipeToSkipCard), so a hundred simultaneous
          resolutions produce one polite header update, not a hundred. Same
          role + live-region pairing the persistent scan banner already uses. */}
      {fetchingSuggestions && (
        <View
          style={styles.progressHeader}
          accessibilityRole="progressbar"
          accessibilityLiveRegion="polite"
          accessibilityLabel={progressLabel}
          accessibilityValue={{ min: 0, max: 100, now: percentage }}
        >
          <View style={styles.progressLabelRow}>
            <ActivityIndicator size="small" color={colors.sunsetGold} />
            <Text style={styles.progressLabel}>{progressLabel}</Text>
          </View>
          {totalCount > 0 && (
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${percentage}%` }]} />
            </View>
          )}
        </View>
      )}

      <FlashList
        data={clusterItems}
        renderItem={renderClusterItem}
        contentContainerStyle={styles.listContent}
        keyExtractor={(item) => {
          switch (item.type) {
            case 'merged-suggestion':
              return item.data.primaryClusterId;
            case 'suggestion':
              return item.data.cluster_id;
            case 'lookup-failed':
            case 'photos-only':
            case 'pending':
              return item.cluster.id;
          }
        }}
        // Recycling pools are keyed by item type, so `pending` gets its own pool
        // and a resolved card is never handed a pending cell's layout.
        getItemType={(item) => item.type}
        ListEmptyComponent={
          // The old "Finding nearby places..." spinner is unreachable now: every
          // accepted cluster is a pending ROW, so a running dispatch always has
          // rows once it has accepted anything. What is left is the zero-cluster
          // case — a candidate whose clusters were all skipped or dismissed —
          // which needs an explanation rather than blank space. While a fetch is
          // still in its pre-dispatch window nothing has been accepted yet, and
          // the progress header above already carries the spinner and the count,
          // so this stays out of the way.
          fetchingSuggestions ? null : (
            <View style={styles.loadingContainer}>
              <Text style={styles.loadingText}>
                {"No locations left to review — they've all been skipped for this trip."}
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}
