import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@components/ui/Button';
import { colors, withAlpha } from '@constants/colors';
import { SCAN_COPY } from '@constants/scanCopy';
import { fonts } from '@constants/typography';

export interface PhotoPermissionRecoverySheetProps {
  variant: 'denied' | 'limited';
  onOpenSettings: () => void;
  /** Limited: open the iOS limited-photo picker (preferred over Settings). */
  onAllowMorePhotos?: () => void;
  onContinueLimited?: () => void;
  onRetry?: () => void;
  testID?: string;
}

export function PhotoPermissionRecoverySheet({
  variant,
  onOpenSettings,
  onAllowMorePhotos,
  onContinueLimited,
  onRetry,
  testID,
}: PhotoPermissionRecoverySheetProps) {
  const copy = SCAN_COPY.permission;
  const title = variant === 'denied' ? copy.recoveryTitleDenied : copy.recoveryTitleLimited;
  const body = variant === 'denied' ? copy.recoveryBodyDenied : copy.recoveryBodyLimited;
  const limitedPrimaryIsPicker = variant === 'limited' && Boolean(onAllowMorePhotos);

  return (
    <View style={styles.container} testID={testID}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      <Text style={styles.tip}>{copy.recoveryPrivacyReportTip}</Text>
      {limitedPrimaryIsPicker ? (
        <Button title={copy.recoveryAllowMorePhotosCta} onPress={onAllowMorePhotos} />
      ) : null}
      <Button
        title={copy.recoveryOpenSettingsCta}
        onPress={onOpenSettings}
        variant={limitedPrimaryIsPicker ? 'outline' : 'primary'}
      />
      {variant === 'limited' && onContinueLimited ? (
        <Button
          title={copy.recoveryContinueLimitedCta}
          variant="outline"
          onPress={onContinueLimited}
        />
      ) : null}
      {onRetry ? (
        <Button title={copy.recoveryRetryCta} variant="outline" onPress={onRetry} />
      ) : null}
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
    fontSize: 28,
    color: colors.midnightNavy,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.body.regular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  tip: {
    fontFamily: fonts.body.regular,
    fontSize: 13,
    lineHeight: 19,
    color: withAlpha(colors.midnightNavy, 0.55),
    textAlign: 'center',
  },
});
