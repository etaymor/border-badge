/**
 * Suggestions phase UI for the photo import screen.
 *
 * Shows trip info header, premium gate, the persistent status row, and the
 * cluster suggestion list.
 *
 * The status row (U9/R15) has four states: dispatching (spinner + count),
 * paused (static label, bar held), settled-with-unfinished-locations (the count
 * that could not be checked, plus the retry-all control), and — only when every
 * location resolved — gone.
 */

import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { FlashList, ListRenderItem } from '@shopify/flash-list';

import { Button } from '@components/ui';
import { useStableCallback } from '@hooks/useStableCallback';
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
  /**
   * True when THIS trip is the one that already consumed the free photo import
   * (U10/R17). The banner is driven by a plain store read, which says only
   * "your one import is spent" — so without this a returning user is told "Free
   * Limit Reached" directly above the very list they are being allowed to
   * finish.
   */
  isExemptTrip?: boolean;
  fetchingSuggestions: boolean;
  /** True while dispatch is paused because the app is backgrounded (U9/R15). */
  isPaused?: boolean;
  /**
   * Number of clusters a bulk retry is currently rebuilding payloads for, or 0
   * (U9). Preparation is serial at the native layer, so a large retry is silent
   * for a while before its first request leaves — the status row names that
   * wait rather than showing an unexplained pause.
   */
  preparingRetryCount?: number;
  clusterItems: ClusterDisplayItem[];
  renderClusterItem: ListRenderItem<ClusterDisplayItem>;
  onUpgrade: () => void;
  /** Retry every retry-eligible failed cluster in one action (U9/R15). */
  onRetryAllFailed?: (clusterIds: string[]) => void;
  /**
   * U11: cluster rows that have been scrolled into view. Called with the ids of
   * the rows now visible; the consumer counts them and keeps no ids in any
   * emitted event (R27).
   */
  onClustersViewed?: (clusterIds: string[]) => void;
}

/**
 * Viewability rule for the "ever scrolled into view" count (U11).
 *
 * Half the row must be on screen, so a cell FlashList mounts just off the
 * viewport does not count as seen — the measurement exists to answer whether
 * users actually reach the tail of a long import, and a mount-based count would
 * always say yes.
 *
 * Frozen at module scope: FlashList does not support a changing
 * `viewabilityConfig`, and a fresh object literal per render is a change.
 */
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 50, minimumViewTime: 200 } as const;

/** The cluster id behind a rendered row, whatever its type. */
function clusterIdOfItem(item: ClusterDisplayItem): string {
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
}

export function SuggestionsPhase({
  selectedCandidate,
  selectedTripName,
  selectedCountryName,
  isPremium,
  canImportPhotos,
  isExemptTrip = false,
  fetchingSuggestions,
  isPaused = false,
  preparingRetryCount = 0,
  clusterItems,
  renderClusterItem,
  onUpgrade,
  onRetryAllFailed,
  onClustersViewed,
}: SuggestionsPhaseProps) {
  // Permanently stable identity: FlashList captures `onViewableItemsChanged`
  // once and warns when it changes, and this fires during scroll — long after
  // commit — so the ref-synced indirection is safe here.
  const handleViewableItemsChanged = useStableCallback(
    ({ viewableItems }: { viewableItems: { item?: ClusterDisplayItem }[] }) => {
      if (!onClustersViewed) return;
      const ids: string[] = [];
      for (const entry of viewableItems) {
        if (entry.item) ids.push(clusterIdOfItem(entry.item));
      }
      onClustersViewed(ids);
    }
  );

  // ONE progress source (U8). The header used to read the dispatch controller's
  // own counters while the list rendered a different set of rows, so the two
  // disagreed: the controller counts only the uncached clusters it dispatched,
  // the list shows every cluster including cached and dismissed ones. Both now
  // derive from the rendered rows, so "N of M" is literally "M clusters across
  // the rendered rows, N of them no longer pending". Counted in CLUSTERS, not
  // rows: a merged-suggestion row stands for every cluster it absorbed, and
  // merging is progressive, so counting rows would make "of M" tick DOWN as
  // same-place cards collapse mid-fetch. Pending rows are always one cluster.
  const pendingCount = clusterItems.filter((item) => item.type === 'pending').length;
  let totalCount = 0;
  for (const item of clusterItems) {
    totalCount += item.type === 'merged-suggestion' ? item.data.clusterIds.length : 1;
  }
  const settledCount = totalCount - pendingCount;
  const percentage = totalCount > 0 ? Math.round((settledCount / totalCount) * 100) : 0;

  // The progress header renders for the WHOLE fetch, including the pre-dispatch
  // window (SQLite cache read + vision prep) where no cluster has been accepted
  // yet and there are no rows at all. Fall back to the candidate's own cluster
  // count so the spinner still carries a count instead of a bare "Searching...".
  const clusterCount = selectedCandidate.locationClusterIds.length;
  const prepareCount = preparingRetryCount > 0 ? preparingRetryCount : clusterCount;
  const progressLabel =
    totalCount > 0 && preparingRetryCount === 0
      ? `Processing ${settledCount} of ${totalCount} locations`
      : `Preparing ${prepareCount} ${prepareCount === 1 ? 'location' : 'locations'}`;

  // U9/R15: the header is a PERSISTENT status row, not a fetch-only one. It used
  // to vanish the instant the last owner settled — exactly the moment a partial
  // stop (a rate limit, a backgrounding) needs explaining and the moment the
  // user has nothing to act on. It now outlives the fetch whenever locations
  // were left unchecked, and carries the one control that clears them.
  //
  // Retry-eligible = the rendered lookup-failed rows that still offer a retry.
  // Sourcing it from the ROWS rather than from the controller's sets keeps it
  // consistent with what the user can see, and inherits the rows' own
  // exclusions: dismissed clusters are not rows, and a 429/503 row is
  // `retryDisabled` so retrying it could only fail again.
  const retryableClusterIds: string[] = [];
  for (const item of clusterItems) {
    if (item.type === 'lookup-failed' && !item.retryDisabled && !item.isRetrying) {
      retryableClusterIds.push(item.cluster.id);
    }
  }
  const unfinishedCount = retryableClusterIds.length;

  // Paused only reads as paused while a fetch is actually parked on it; a
  // backgrounded app with nothing to dispatch has nothing to say.
  const showPaused = isPaused && fetchingSuggestions;
  const showUnfinished = !fetchingSuggestions && unfinishedCount > 0;
  const showStatusRow = fetchingSuggestions || showUnfinished;

  let statusLabel = progressLabel;
  if (showPaused) {
    statusLabel = 'Paused — picks up where it left off when you return';
  } else if (showUnfinished) {
    const noun = unfinishedCount === 1 ? 'location' : 'locations';
    statusLabel = `${unfinishedCount} ${noun} couldn't be checked`;
  }

  return (
    <View style={styles.listContainer}>
      {selectedTripName && <Text style={styles.tripName}>{selectedTripName}</Text>}
      <Text style={styles.tripMeta}>
        {getFlagEmoji(selectedCandidate.countryCode)} {selectedCountryName}
      </Text>
      <Text style={styles.tripDates}>
        {formatDateRange(selectedCandidate.dateRange.start, selectedCandidate.dateRange.end)}
      </Text>

      {!isPremium && !canImportPhotos && !isExemptTrip && (
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
      {showStatusRow && (
        <View
          style={styles.progressHeader}
          accessibilityRole="progressbar"
          accessibilityLiveRegion="polite"
          accessibilityLabel={statusLabel}
          accessibilityValue={{ min: 0, max: 100, now: percentage }}
        >
          <View style={styles.progressLabelRow}>
            {/* No spinner while paused or stopped: a spinner over work that is
                not happening is the thing that made a stalled import look
                healthy. The bar keeps its fill either way, so the progress
                already made stays visible. */}
            {fetchingSuggestions && !showPaused && (
              <ActivityIndicator size="small" color={colors.sunsetGold} />
            )}
            <Text style={styles.progressLabel}>{statusLabel}</Text>
          </View>
          {totalCount > 0 && (
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${percentage}%` }]} />
            </View>
          )}
          {/* The retry-all control lives IN the status row and only once
              dispatch has settled — while a bulk retry runs, the in-progress
              header replaces it, so there is never a second tap to give. */}
          {showUnfinished && onRetryAllFailed && (
            <TouchableOpacity
              style={styles.retryAllButton}
              onPress={() => onRetryAllFailed(retryableClusterIds)}
              accessibilityRole="button"
              accessibilityLabel={`Retry all ${unfinishedCount} unchecked ${
                unfinishedCount === 1 ? 'location' : 'locations'
              }`}
            >
              <Text style={styles.retryAllButtonText}>Retry All</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <FlashList
        data={clusterItems}
        renderItem={renderClusterItem}
        contentContainerStyle={styles.listContent}
        keyExtractor={clusterIdOfItem}
        // U11: the fraction of clusters ever scrolled into view. Only the count
        // leaves the screen — no id reaches an analytics event (R27).
        onViewableItemsChanged={handleViewableItemsChanged}
        viewabilityConfig={VIEWABILITY_CONFIG}
        // Recycling pools are keyed by item type, so `pending` gets its own pool
        // and a resolved card is never handed a pending cell's layout.
        // `suggestion` and `merged-suggestion` SHARE a pool: both render
        // SwipeToSkipCard > PlaceSuggestionCard with the same layout, and a
        // single card grows into a merged one IN PLACE (same key — the primary
        // cluster id) when a second cluster matches its place mid-fetch. A
        // separate pool would re-create the cell on that transition and reset
        // the card's picked alternative (useRecyclingState) back to option 1.
        getItemType={(item) => (item.type === 'merged-suggestion' ? 'suggestion' : item.type)}
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
