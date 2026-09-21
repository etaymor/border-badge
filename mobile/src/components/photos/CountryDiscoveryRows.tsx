import { memo, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';

import { CountryRow, type CountryRowSlot } from '@components/photos/CountryRow';
import { useArrivalQueue } from '@components/photos/useArrivalQueue';
import { SCAN_COPY } from '@constants/scanCopy';
import { useStableCallback } from '@hooks/useStableCallback';
import type { CountryPreviewRow, ScanPreview } from '@services/photoImport/scanPreviewPicker';
import { PhotoThumbnail } from '@screens/photos/components/PhotoThumbnail';

const VISIBLE_ROW_COUNT = 4;
const DISCOVERY_ROW_HEIGHT = 64;

export const COUNTRY_DISCOVERY_VIEWPORT_HEIGHT = VISIBLE_ROW_COUNT * DISCOVERY_ROW_HEIGHT;

export interface CountryDiscoveryRowsProps {
  rows: readonly CountryPreviewRow[];
  isComplete: boolean;
  isPaused?: boolean;
  reduceMotion: boolean;
}

interface DiscoveryThumbnailProps {
  code: string;
  index: number;
  preview: ScanPreview;
}

function DiscoveryThumbnail({ code, index, preview }: DiscoveryThumbnailProps) {
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  return (
    <View
      style={styles.thumbnail}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <PhotoThumbnail
        testID={`country-discovery-thumbnail-${code}-${index}`}
        uri={preview.uri}
        assetId={preview.assetId}
        style={styles.thumbnail}
        transition={0}
        recoverOnError={false}
        onError={() => setHidden(true)}
        accessible={false}
      />
    </View>
  );
}

function renderPreviewSlot(code: string, preview: ScanPreview, index: number): CountryRowSlot {
  return function PreviewSlot() {
    return <DiscoveryThumbnail code={code} index={index} preview={preview} />;
  };
}

function CountryDiscoveryRowsComponent({
  rows,
  isComplete,
  isPaused = false,
  reduceMotion,
}: CountryDiscoveryRowsProps) {
  const announce = useStableCallback((row: CountryPreviewRow) => {
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(SCAN_COPY.trips.discovery(row.name));
    }
  });

  const { arrivedKeys, enteringKey } = useArrivalQueue({
    rows,
    isComplete,
    isPaused,
    onArrive: announce,
  });

  const arrivedRows = rows.filter((row) => arrivedKeys.has(row.code));
  const firstVisibleIndex = Math.max(0, arrivedRows.length - VISIBLE_ROW_COUNT);
  const visiblePositions = new Map(
    arrivedRows.map((row, index) => [row.code, (index - firstVisibleIndex) * DISCOVERY_ROW_HEIGHT])
  );

  return (
    <View
      testID="country-discovery-viewport"
      style={styles.viewport}
      pointerEvents="none"
      accessibilityRole="summary"
      accessibilityElementsHidden={isPaused}
      importantForAccessibility={isPaused ? 'no-hide-descendants' : 'auto'}
    >
      {rows.map((row) => {
        const hasArrived = arrivedKeys.has(row.code);
        const translateY = visiblePositions.get(row.code) ?? COUNTRY_DISCOVERY_VIEWPORT_HEIGHT;
        const slots = row.previews
          .slice(0, 2)
          .map((preview, index) => renderPreviewSlot(row.code, preview, index));

        return (
          <View
            key={row.code}
            testID={`country-discovery-row-${row.code}`}
            style={[
              styles.positionedRow,
              {
                opacity: hasArrived ? 1 : 0,
                transform: [{ translateY }],
              },
            ]}
            accessible={hasArrived}
            accessibilityLabel={SCAN_COPY.trips.discovery(row.name)}
            accessibilityLiveRegion="polite"
            accessibilityElementsHidden={!hasArrived}
            importantForAccessibility={hasArrived ? 'auto' : 'no-hide-descendants'}
          >
            <CountryRow
              code={row.code}
              name={row.name}
              slots={slots}
              entering={enteringKey === row.code}
              reduceMotion={reduceMotion}
            />
          </View>
        );
      })}
    </View>
  );
}

export const CountryDiscoveryRows = memo(CountryDiscoveryRowsComponent);

const styles = StyleSheet.create({
  viewport: {
    width: '100%',
    height: COUNTRY_DISCOVERY_VIEWPORT_HEIGHT,
    overflow: 'hidden',
  },
  positionedRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: DISCOVERY_ROW_HEIGHT,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
});
