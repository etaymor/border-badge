import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, withAlpha } from '@constants/colors';
import { SCAN_COPY } from '@constants/scanCopy';
import { fonts } from '@constants/typography';

export type PhotoPermissionPreheatChoice = 'full-access' | 'select-photos' | 'dont-allow';

export interface PhotoPermissionPreheatStackProps {
  onChoose: (choice: PhotoPermissionPreheatChoice) => void;
}

// Match the raw blue used by the iOS photo-permission action sheet.
const IOS_FULL_ACCESS_BLUE = '#007AFF';

export function PhotoPermissionPreheatStack({ onChoose }: PhotoPermissionPreheatStackProps) {
  return (
    <View style={styles.buttonStack} testID="photo-permission-preheat-buttons">
      <Pressable
        style={[styles.button, styles.secondaryButton]}
        onPress={() => onChoose('select-photos')}
        accessibilityRole="button"
        accessibilityLabel={SCAN_COPY.permission.preheatSelectPhotos}
        testID="photo-permission-preheat-select"
      >
        <Text style={styles.secondaryButtonText}>{SCAN_COPY.permission.preheatSelectPhotos}</Text>
      </Pressable>

      <Pressable
        style={[styles.button, styles.fullAccessButton]}
        // Only this choice invokes the OS permission prompt; the others stay in-app.
        onPress={() => onChoose('full-access')}
        accessibilityRole="button"
        accessibilityLabel={SCAN_COPY.permission.preheatAllowFullAccess}
        testID="photo-permission-preheat-full-access"
      >
        <Text style={styles.fullAccessButtonText}>
          {SCAN_COPY.permission.preheatAllowFullAccess}
        </Text>
      </Pressable>

      <Pressable
        style={[styles.button, styles.secondaryButton]}
        onPress={() => onChoose('dont-allow')}
        accessibilityRole="button"
        accessibilityLabel={SCAN_COPY.permission.preheatDontAllow}
        testID="photo-permission-preheat-dont-allow"
      >
        <Text style={styles.secondaryButtonText}>{SCAN_COPY.permission.preheatDontAllow}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  buttonStack: {
    alignSelf: 'stretch',
    gap: 10,
  },
  button: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryButton: {
    backgroundColor: withAlpha(colors.midnightNavy, 0.08),
  },
  secondaryButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 17,
    color: colors.midnightNavy,
  },
  fullAccessButton: {
    backgroundColor: IOS_FULL_ACCESS_BLUE,
  },
  fullAccessButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 17,
    color: colors.cloudWhite,
  },
});

export default PhotoPermissionPreheatStack;
