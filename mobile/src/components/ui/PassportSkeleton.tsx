import { ScrollView, StyleSheet, View } from 'react-native';

import { colors } from '@constants/colors';

import { Skeleton } from './Skeleton';

/**
 * Skeleton loading state for the PassportScreen.
 * Mirrors the updated layout of the PassportScreen content to provide
 * a seamless loading experience.
 */
export function PassportSkeleton() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* App Header Skeleton */}
      <View style={styles.header}>
        <Skeleton width={180} height={32} borderRadius={8} />
      </View>

      {/* Status Card Skeleton */}
      <View style={styles.statusCard}>
        <View style={styles.statusHeader}>
          {/* Icon Placeholder */}
          <Skeleton width={48} height={48} borderRadius={4} />

          <View style={styles.statusContent}>
            <View style={styles.statusRow}>
              <Skeleton width={160} height={20} borderRadius={4} />
              <Skeleton width={80} height={20} borderRadius={4} />
            </View>
            <View style={styles.statusLabelsRow}>
              <Skeleton width={90} height={12} borderRadius={4} />
              <Skeleton width={60} height={12} borderRadius={4} />
            </View>

            <Skeleton width="100%" height={8} borderRadius={4} style={styles.progressBar} />
          </View>
        </View>
      </View>

      {/* Stats Grid Skeleton */}
      <View style={styles.statsGrid}>
        {[0, 1, 2, 3].map((index) => (
          <View key={index} style={styles.statBox}>
            <Skeleton width={32} height={24} borderRadius={4} />
            <Skeleton width={48} height={10} borderRadius={4} style={styles.statLabel} />
          </View>
        ))}
      </View>

      {/* Search Row Skeleton */}
      <View style={styles.searchRow}>
        <Skeleton width="80%" height={48} borderRadius={24} />
        <Skeleton width="15%" height={16} borderRadius={4} />
      </View>

      {/* Section Header Skeleton */}
      <Skeleton width={160} height={28} borderRadius={4} style={styles.sectionHeader} />

      {/* Stamp/Country Grid Skeletons (2 per row) */}
      {[0, 1, 2].map((rowIndex) => (
        <View key={rowIndex} style={styles.stampRow}>
          <Skeleton width="48%" height={100} borderRadius={12} />
          <Skeleton width="48%" height={100} borderRadius={12} />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  content: {
    paddingBottom: 24,
  },
  // Header
  header: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 24,
  },
  // Status Card
  statusCard: {
    marginTop: 0,
    marginHorizontal: 16,
    backgroundColor: colors.cloudWhite,
    borderRadius: 16,
    padding: 16,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusContent: {
    flex: 1,
    marginLeft: 12,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statusLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  progressBar: {
    marginTop: 0,
  },
  // Stats Grid
  statsGrid: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    gap: 12,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.backgroundCard,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statLabel: {
    marginTop: 8,
  },
  // Search Row
  searchRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 20,
    gap: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Section Header
  sectionHeader: {
    marginHorizontal: 16,
    marginTop: 24,
    marginBottom: 12,
  },
  // Stamp Rows
  stampRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
});
