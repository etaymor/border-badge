/**
 * LibrarySyncFooter - one quiet line of photo-library sync observability
 * (P1): when the cache last synced and how many photos it holds, or that the
 * last sync failed - with a manual re-scan escape hatch when the record has
 * been failing with no recent success.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useLibrarySyncStatus } from '@hooks/useLibrarySyncStatus';
import { useStableCallback } from '@hooks/useStableCallback';
import { ensureFreshLibrary } from '@services/photoImport/photoBackgroundSync';

/** Show the re-scan affordance when errors persist with no success in 24h. */
const RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

function describeSyncedAt(lastSuccessAt: number, photoCount: number): string {
  const minutes = Math.max(1, Math.round((Date.now() - lastSuccessAt) / 60_000));
  const when =
    minutes < 60
      ? `${minutes} min ago`
      : minutes < 60 * 24
        ? `${Math.round(minutes / 60)}h ago`
        : `${Math.round(minutes / (60 * 24))}d ago`;
  const photos = photoCount > 0 ? ` · ${photoCount.toLocaleString()} photos` : '';
  return `Library synced ${when}${photos}`;
}

export function LibrarySyncFooter() {
  const { status, freshness, refresh } = useLibrarySyncStatus();
  const [rescanning, setRescanning] = useState(false);

  const handleRescan = useStableCallback(async () => {
    if (rescanning) return;
    setRescanning(true);
    try {
      await ensureFreshLibrary({ maxStalenessMs: 0, source: 'manual' });
    } finally {
      setRescanning(false);
      refresh();
    }
  });

  if (!status) return null;

  const failing =
    status.lastErrorAt !== null &&
    (status.lastSuccessAt === null || Date.now() - status.lastSuccessAt > RECOVERY_WINDOW_MS);

  if (failing) {
    return (
      <View style={styles.row} testID="library-sync-footer">
        <Text style={[styles.text, styles.textError]}>Last library sync failed</Text>
        <Pressable onPress={handleRescan} disabled={rescanning} testID="library-sync-rescan">
          <Text style={styles.action}>{rescanning ? 'Re-scanning…' : 'Re-scan'}</Text>
        </Pressable>
      </View>
    );
  }

  if (status.lastSuccessAt === null) return null;

  return (
    <View style={styles.row} testID="library-sync-footer">
      <Text style={styles.text}>
        {describeSyncedAt(status.lastSuccessAt, freshness?.cachedPhotoCount ?? 0)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  text: {
    fontFamily: fonts.body.regular,
    fontSize: 12,
    color: withAlpha(colors.midnightNavy, 0.45),
  },
  textError: {
    color: colors.adobeBrick,
  },
  action: {
    fontFamily: fonts.body.semiBold,
    fontSize: 12,
    color: colors.mossGreen,
  },
});
