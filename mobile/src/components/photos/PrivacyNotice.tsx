/**
 * PrivacyNotice - The consent block, rendered by both scan doors.
 *
 * The trips screen and the Guess Where wizard were each making the same three
 * promises in their own words. Sharing the STRINGS (via `@constants/scanCopy`)
 * stops the sentences drifting; sharing the COMPONENT is what makes the drift
 * structurally hard rather than merely test-enforced — there is no second
 * place to edit.
 *
 * `variant` exists because the two surfaces sit on different grounds: the
 * trips screen is a light screen, the quiz wizard is a cream sheet over a
 * navy stage. Only the colors differ; the words and their order never do.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { SCAN_COPY } from '@constants/scanCopy';

export interface PrivacyNoticeProps {
  /** Name of the user's home country, for the location-data bullet. */
  homeCountryName?: string | null;
  /** `sheet` is the quiz wizard's cream sheet; `screen` is the trips screen. */
  variant?: 'screen' | 'sheet';
  testID?: string;
}

export function PrivacyNotice({ homeCountryName, variant = 'screen', testID }: PrivacyNoticeProps) {
  const bullets = useMemo(
    () => SCAN_COPY.shared.privacyBullets(homeCountryName),
    [homeCountryName]
  );
  const isSheet = variant === 'sheet';

  return (
    <View style={styles.container} testID={testID}>
      <Text style={[styles.title, isSheet && styles.titleSheet]}>
        {SCAN_COPY.shared.privacyTitle}
      </Text>
      {bullets.map((bullet) => (
        <Text key={bullet} style={[styles.bullet, isSheet && styles.bulletSheet]}>
          {'•'} {bullet}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 20,
    paddingHorizontal: 4,
    alignSelf: 'stretch',
  },
  title: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
    marginBottom: 6,
    textAlign: 'center',
  },
  titleSheet: {
    fontSize: 15,
    marginBottom: 10,
  },
  bullet: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 2,
  },
  bulletSheet: {
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 6,
    color: withAlpha(colors.midnightNavy, 0.65),
    textAlign: 'center',
  },
});

export default PrivacyNotice;
