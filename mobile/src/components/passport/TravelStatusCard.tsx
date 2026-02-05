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
    borderRadius: 20,
    padding: 16,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
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
  progressBar: {
    width: '100%',
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.adobeBrick,
    borderRadius: 4,
  },
});
