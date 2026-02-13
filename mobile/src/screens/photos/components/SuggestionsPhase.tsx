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
  suggestionsProgress: {
    clustersCompleted: number;
    clustersTotal: number;
    percentage: number;
  } | null;
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
  suggestionsProgress,
  clusterItems,
  renderClusterItem,
  onUpgrade,
}: SuggestionsPhaseProps) {
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

      {fetchingSuggestions && (
        <View style={styles.progressHeader}>
          <View style={styles.progressLabelRow}>
            <ActivityIndicator size="small" color={colors.sunsetGold} />
            <Text style={styles.progressLabel}>
              {suggestionsProgress
                ? `Processing ${suggestionsProgress.clustersCompleted} of ${suggestionsProgress.clustersTotal} locations`
                : 'Searching for places...'}
            </Text>
          </View>
          {suggestionsProgress && (
            <View style={styles.progressBar}>
              <View
                style={[styles.progressFill, { width: `${suggestionsProgress.percentage}%` }]}
              />
            </View>
          )}
        </View>
      )}

      <FlashList
        data={clusterItems}
        renderItem={renderClusterItem}
        contentContainerStyle={styles.listContent}
        keyExtractor={(item) =>
          item.type === 'merged-suggestion'
            ? item.data.primaryClusterId
            : item.type === 'suggestion'
              ? item.data.cluster_id
              : item.cluster.id
        }
        getItemType={(item) => item.type}
        ListEmptyComponent={
          fetchingSuggestions ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.sunsetGold} />
              <Text style={styles.loadingText}>Finding nearby places...</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}
