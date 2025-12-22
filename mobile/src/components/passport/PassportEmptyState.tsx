import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@constants/colors';

export function PassportEmptyState() {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyIcon}>🌍</Text>
      <Text style={styles.emptyTitle}>No countries yet</Text>
      <Text style={styles.emptySubtitle}>Create a trip to start building your passport!</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    paddingVertical: 40,
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
