import React from 'react';
import { View, Text, Pressable, Switch, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface ProfileInfoSectionProps {
  formattedPhone: string;
  homeCountryDisplay: { flag: string; name: string } | null;
  memberSince: string;
  trackingPreferenceDisplay: { name: string; count: number };
  visitedCount: number;
  clipboardDetectionEnabled: boolean;
  onOpenTrackingModal: () => void;
  onOpenExportModal: () => void;
  onToggleClipboardDetection: (enabled: boolean) => void;
}

export function ProfileInfoSection({
  formattedPhone,
  homeCountryDisplay,
  memberSince,
  trackingPreferenceDisplay,
  visitedCount,
  clipboardDetectionEnabled,
  onOpenTrackingModal,
  onOpenExportModal,
  onToggleClipboardDetection,
}: ProfileInfoSectionProps) {
  return (
    <View style={styles.container}>
      {/* Passport Details Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>PASSPORT DETAILS</Text>
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Text style={styles.rowLabel}>Phone</Text>
            <Text style={styles.rowValue}>{formattedPhone}</Text>
          </View>

          <View style={styles.divider} />

          {homeCountryDisplay && (
            <>
              <View style={styles.cardRow}>
                <Text style={styles.rowLabel}>Home Country</Text>
                <Text style={styles.rowValue}>
                  {homeCountryDisplay.flag} {homeCountryDisplay.name}
                </Text>
              </View>
              <View style={styles.divider} />
            </>
          )}

          <View style={styles.cardRow}>
            <Text style={styles.rowLabel}>Member Since</Text>
            <Text style={styles.rowValue}>{memberSince}</Text>
          </View>
        </View>
      </View>

      {/* Preferences Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>PREFERENCES & DATA</Text>
        <View style={styles.card}>
          <Pressable
            onPress={onOpenTrackingModal}
            style={({ pressed }) => [styles.cardPressable, pressed && styles.cardPressableActive]}
            accessibilityRole="button"
            accessibilityLabel="Change country tracking preference"
          >
            <View style={styles.cardRow}>
              <Text style={styles.rowLabel}>Country Tracking</Text>
              <View style={styles.rowValueContainer}>
                <Text style={styles.rowValue}>
                  {trackingPreferenceDisplay.name}
                  {/* <Text style={styles.rowValueDetail}> ({trackingPreferenceDisplay.count})</Text> */}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.stormGray}
                  style={styles.chevronIcon}
                />
              </View>
            </View>
          </Pressable>

          <View style={styles.divider} />

          {visitedCount > 0 && (
            <>
              <Pressable
                onPress={onOpenExportModal}
                style={({ pressed }) => [
                  styles.cardPressable,
                  pressed && styles.cardPressableActive,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Export your country list"
              >
                <View style={styles.cardRow}>
                  <Text style={styles.rowLabel}>Export Countries</Text>
                  <View style={styles.rowValueContainer}>
                    <Text style={styles.rowValue}>
                      {visitedCount} {visitedCount === 1 ? 'country' : 'countries'}
                    </Text>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={colors.stormGray}
                      style={styles.chevronIcon}
                    />
                  </View>
                </View>
              </Pressable>
              <View style={styles.divider} />
            </>
          )}

          <View style={styles.cardRow}>
            <View style={styles.toggleLabelContainer}>
              <Text style={styles.rowLabel}>Clipboard Detection</Text>
              <Text style={styles.toggleDescription}>Detect TikTok/Instagram links</Text>
            </View>
            <Switch
              value={clipboardDetectionEnabled}
              onValueChange={onToggleClipboardDetection}
              trackColor={{ false: colors.paperBeige, true: colors.mossGreen }}
              thumbColor={colors.cloudWhite}
              accessibilityLabel="Toggle clipboard URL detection"
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.stormGray,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 12,
    marginLeft: 4,
  },
  card: {
    backgroundColor: colors.cloudWhite,
    borderRadius: 16,
    paddingVertical: 4,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  cardPressable: {
    borderRadius: 12, // slightly less than card to fit inside if needed, though here it spans full width minus padding effectively if we wanted, but standard iOS list style is full width.
    // Actually, to get touch feedback on the row, we wrap the row content.
  },
  cardPressableActive: {
    backgroundColor: colors.paperBeige,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.05)',
    marginLeft: 16, // Indented divider
  },
  rowLabel: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  rowValue: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.stormGray,
  },
  rowValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowValueDetail: {
    fontSize: 14,
    color: colors.stormGray,
  },
  chevronIcon: {
    marginLeft: 8,
    opacity: 0.5,
  },
  infoValue: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  toggleLabelContainer: {
    flex: 1,
  },
  toggleDescription: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.stormGray,
    marginTop: 2,
  },
});
