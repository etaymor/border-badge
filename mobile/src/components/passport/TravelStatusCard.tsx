import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface TravelStatusCardProps {
  travelStatus: string;
  stampedCount: number;
  totalCountries: number;
  worldPercentage: number;
}

export function TravelStatusCard({
  travelStatus,
  stampedCount,
  totalCountries,
  worldPercentage,
}: TravelStatusCardProps) {
  return (
    <View style={styles.statusCard}>
      <View style={styles.statusHeader}>
        <View style={styles.statusContent}>
          <View style={styles.statusRow}>
            <Text style={styles.statusTitle}>{travelStatus.toUpperCase()}</Text>
            <View style={styles.countContainer}>
              <Text style={styles.countText}>
                <Text style={styles.countCurrent}>{stampedCount}</Text>
                <Text style={styles.countTotal}>/{totalCountries}</Text>
              </Text>
            </View>
          </View>
          <View style={styles.statusLabelsRow}>
            <Text style={styles.statusLabel}>TRAVEL STATUS</Text>
            <Text style={styles.countriesLabel}>COUNTRIES</Text>
          </View>

          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${worldPercentage}%` }]} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 2,
  },
  statusLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statusTitle: {
    fontFamily: fonts.openSans.bold,
    fontSize: 18,
    color: colors.adobeBrick,
    letterSpacing: 0.5,
  },
  countContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  countText: {
    fontFamily: fonts.openSans.bold,
  },
  countCurrent: {
    fontSize: 16,
    color: colors.adobeBrick,
  },
  countTotal: {
    fontSize: 14,
    color: colors.adobeBrick,
    opacity: 0.7,
  },
  statusLabel: {
    fontFamily: fonts.openSans.bold,
    fontSize: 11,
    color: colors.adobeBrick,
    opacity: 0.8,
  },
  countriesLabel: {
    fontFamily: fonts.openSans.bold,
    fontSize: 11,
    color: colors.adobeBrick,
    opacity: 0.8,
  },
  progressBar: {
    width: '100%',
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#64B5F6',
    borderRadius: 4,
  },
});
