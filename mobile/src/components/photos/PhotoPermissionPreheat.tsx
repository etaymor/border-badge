/**
 * OS-shaped soft ask for Photos. Full Access is system blue so it bleeds under
 * the real sheet. Select Photos and Don't Allow go to recovery without
 * calling the OS first.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, withAlpha } from '@constants/colors';
import { SCAN_COPY } from '@constants/scanCopy';
import { fonts } from '@constants/typography';

export type PhotoPermissionPreheatChoice = 'full-access' | 'select-photos' | 'dont-allow';

export interface PhotoPermissionPreheatProps {
  onChoose: (choice: PhotoPermissionPreheatChoice) => void;
  testID?: string;
}

/** iOS Photos sheet accent for Allow Full Access. */
const IOS_FULL_ACCESS_BLUE = '#007AFF';

export function PhotoPermissionPreheat({ onChoose, testID }: PhotoPermissionPreheatProps) {
  return (
    <View style={styles.container} testID={testID ?? 'photo-permission-preheat'}>
      <Text style={styles.title}>{SCAN_COPY.permission.preheatTitle}</Text>
      <Text style={styles.body}>{SCAN_COPY.permission.preheatBody}</Text>

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

      <Text style={styles.footer}>{SCAN_COPY.permission.preheatFooter}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    gap: 14,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 26,
    color: colors.midnightNavy,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.stormGray,
    textAlign: 'center',
  },
  buttonStack: {
    marginTop: 8,
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
  footer: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    lineHeight: 18,
    color: withAlpha(colors.stormGray, 0.95),
    textAlign: 'center',
    marginTop: 4,
  },
});

export default PhotoPermissionPreheat;
