/**
 * ScanStage - the live stage card for a library scan, shared by both doors.
 *
 * Two layers, one card:
 * 1. `ReadingGrid` - the user's own photos filling the card as the scan reads
 *    them. It never leaves; once a country is found it dims to a texture and
 *    keeps churning behind the stamps.
 * 2. `StampScatter` - each found country's stamp pops onto the card at a
 *    scattered spot with its photos tucked behind it.
 *
 * No text renders on the stage. Country names reach VoiceOver only, via each
 * stamp's label and the arrival announcement, and they are always full names.
 */

import { memo, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';

import { ReadingGrid } from '@components/photos/ReadingGrid';
import {
  StampScatter,
  type StampDrive,
  type StampScatterItem,
} from '@components/photos/StampScatter';
import { useArrivalQueue } from '@components/photos/useArrivalQueue';
import { SCAN_COPY } from '@constants/scanCopy';
import { useStableCallback } from '@hooks/useStableCallback';
import type {
  CountryPreviewRow,
  ReadingPreview,
  ScanPreview,
} from '@services/photoImport/scanPreviewPicker';
import { PhotoThumbnail } from '@screens/photos/components/PhotoThumbnail';

export interface ScanStageProps {
  rows: readonly CountryPreviewRow[];
  /** Recently read photos for the live grid. */
  readingPreviews?: readonly ReadingPreview[];
  isComplete: boolean;
  isPaused?: boolean;
  reduceMotion: boolean;
}

const EMPTY_READING_PREVIEWS: readonly ReadingPreview[] = [];
/** Stamps on the page at once; the rest cycle through their spots. */
export const SCAN_STAMP_CAPACITY = 6;

interface TuckedThumbnailProps {
  code: string;
  index: number;
  preview: ScanPreview;
}

function TuckedThumbnail({ code, index, preview }: TuckedThumbnailProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <PhotoThumbnail
      testID={`scan-stage-thumbnail-${code}-${index}`}
      uri={preview.uri}
      assetId={preview.assetId}
      style={styles.thumbnail}
      transition={0}
      recoverOnError={false}
      onError={() => setFailed(true)}
      accessible={false}
    />
  );
}

function ScanStageComponent({
  rows,
  readingPreviews = EMPTY_READING_PREVIEWS,
  isComplete,
  isPaused = false,
  reduceMotion,
}: ScanStageProps) {
  // Rows already known at mount are on the page; they never re-pop.
  const [mountedCodes] = useState(() => new Set(rows.map((row) => row.code)));

  const announce = useStableCallback((row: CountryPreviewRow) => {
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(SCAN_COPY.trips.discovery(row.name));
    }
  });

  const { arrivedKeys } = useArrivalQueue({
    rows,
    isComplete,
    isPaused,
    onArrive: announce,
  });

  const hasStamps = arrivedKeys.size > 0;

  const items: StampScatterItem[] = rows.map((row) => {
    const drive: StampDrive = !arrivedKeys.has(row.code)
      ? { kind: 'hidden' }
      : mountedCodes.has(row.code)
        ? { kind: 'settled' }
        : { kind: 'enter' };
    return {
      code: row.code,
      drive,
      accessibilityLabel: SCAN_COPY.trips.discovery(row.name),
      photos: row.previews.map((preview, index) => (
        <TuckedThumbnail key={preview.assetId} code={row.code} index={index} preview={preview} />
      )),
    };
  });

  return (
    <View
      testID="scan-stage"
      style={styles.root}
      pointerEvents="none"
      accessibilityRole="summary"
      accessibilityElementsHidden={isPaused}
      importantForAccessibility={isPaused ? 'no-hide-descendants' : 'auto'}
    >
      <ReadingGrid
        previews={readingPreviews}
        dimmed={hasStamps}
        reduceMotion={reduceMotion}
        frozen={isPaused || isComplete}
      />
      {hasStamps ? (
        <View testID="scan-stage-scatter" style={StyleSheet.absoluteFill}>
          <StampScatter items={items} reduceMotion={reduceMotion} capacity={SCAN_STAMP_CAPACITY} />
        </View>
      ) : null}
    </View>
  );
}

export const ScanStage = memo(ScanStageComponent);
export default ScanStage;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
});
