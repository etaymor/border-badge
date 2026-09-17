/**
 * OS-shaped soft ask for Photos. Full Access is system blue so it bleeds under
 * the real sheet. Select Photos and Don't Allow go to recovery without
 * calling the OS first.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PhotoPermissionPreheatStack } from '@components/photos/PhotoPermissionPreheatStack';
import { colors, withAlpha } from '@constants/colors';
import { SCAN_COPY } from '@constants/scanCopy';
import { fonts } from '@constants/typography';

export type PhotoPermissionPreheatChoice = 'full-access' | 'select-photos' | 'dont-allow';

export interface PhotoPermissionPreheatProps {
  onChoose: (choice: PhotoPermissionPreheatChoice) => void;
  testID?: string;
}

export function PhotoPermissionPreheat({ onChoose, testID }: PhotoPermissionPreheatProps) {
  return (
    <View style={styles.container} testID={testID ?? 'photo-permission-preheat'}>
      <Text style={styles.title}>{SCAN_COPY.permission.preheatTitle}</Text>
      <Text style={styles.body}>{SCAN_COPY.permission.preheatBody}</Text>

      <View style={styles.stackSpacing}>
        <PhotoPermissionPreheatStack onChoose={onChoose} />
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
  stackSpacing: {
    marginTop: 8,
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
