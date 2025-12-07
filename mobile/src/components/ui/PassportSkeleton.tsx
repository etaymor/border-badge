import { ScrollView, StyleSheet, View } from 'react-native';

import { colors } from '@constants/colors';

import { Skeleton } from './Skeleton';

/**
 * Skeleton loading state for the PassportScreen.
 * Mirrors the layout of the actual passport content to provide
 * a seamless loading experience.
 */
export function PassportSkeleton() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Status Card Skeleton */}
      <View style={styles.statusCard}>
        <View style={styles.statusHeader}>
          <View style={styles.statusLeft}>
            <Skeleton width={140} height={24} borderRadius={4} />
            <Skeleton width={100} height={12} borderRadius={4} style={styles.labelSkeleton} />
          </View>
          <View style={styles.statusRight}>
            <Skeleton width={60} height={24} borderRadius={4} />
            <Skeleton width={70} height={12} borderRadius={4} style={styles.labelSkeleton} />
          </View>
        </View>
        <Skeleton width="100%" height={6} borderRadius={3} style={styles.progressBar} />
      </View>

      {/* Stats Grid Skeleton */}
      <View style={styles.statsGrid}>
        {[0, 1, 2, 3].map((index) => (
          <View key={index} style={styles.statBox}>
            <Skeleton width={40} height={28} borderRadius={4} />
            <Skeleton width={50} height={10} borderRadius={4} style={styles.statLabel} />
          </View>
        ))}
      </View>

      {/* Search Bar Skeleton */}
      <View style={styles.searchRow}>
        <Skeleton width="100%" height={44} borderRadius={20} />
      </View>

      {/* Section Header Skeleton */}
      <Skeleton width={140} height={18} borderRadius={4} style={styles.sectionHeader} />

      {/* Country Card Skeletons */}
      {[0, 1, 2, 3].map((index) => (
        <View key={index} style={styles.countryCard}>
          <View style={styles.countryCardContent}>
            {/* Flag placeholder */}
            <Skeleton width={48} height={32} borderRadius={4} />
            <View style={styles.countryInfo}>
              <Skeleton width={160} height={16} borderRadius={4} />
              <Skeleton width={80} height={12} borderRadius={4} style={styles.regionSkeleton} />
            </View>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 24,
  },
  // Status Card
  statusCard: {
    marginTop: 16,
    marginHorizontal: 16,
    backgroundColor: colors.backgroundCard,
    borderRadius: 12,
    padding: 16,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  statusLeft: {
    flex: 1,
  },
  statusRight: {
    alignItems: 'flex-end',
  },
  labelSkeleton: {
    marginTop: 6,
  },
  progressBar: {
    marginTop: 4,
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
    marginHorizontal: 16,
    marginTop: 16,
  },
  // Section Header
  sectionHeader: {
    marginHorizontal: 16,
    marginTop: 24,
    marginBottom: 12,
  },
  // Country Cards
  countryCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.backgroundCard,
    borderRadius: 12,
    padding: 16,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  countryCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  countryInfo: {
    marginLeft: 12,
    flex: 1,
  },
  regionSkeleton: {
    marginTop: 6,
  },
});
