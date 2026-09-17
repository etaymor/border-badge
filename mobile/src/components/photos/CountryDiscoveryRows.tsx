import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';

import { CountryRow, type CountryRowSlot } from '@components/photos/CountryRow';
import { SCAN_MIN_ARRIVAL_GAP } from '@components/photos/scanMotion';
import { SCAN_COPY } from '@constants/scanCopy';
import type { CountryPreviewRow, ScanPreview } from '@services/photoImport/scanPreviewPicker';
import { PhotoThumbnail } from '@screens/photos/components/PhotoThumbnail';

const VISIBLE_ROW_COUNT = 4;
const DISCOVERY_ROW_HEIGHT = 64;

export const COUNTRY_DISCOVERY_VIEWPORT_HEIGHT = VISIBLE_ROW_COUNT * DISCOVERY_ROW_HEIGHT;

export interface CountryDiscoveryRowsProps {
  rows: readonly CountryPreviewRow[];
  isComplete: boolean;
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
  reduceMotion,
}: CountryDiscoveryRowsProps) {
  const [initialKeys] = useState(() => new Set(rows.map((row) => row.code)));
  const [arrivedKeys, setArrivedKeys] = useState(() => new Set(initialKeys));
  const [enteringKey, setEnteringKey] = useState<string | null>(null);
  const knownKeysRef = useRef(new Set(initialKeys));
  const queueRef = useRef<CountryPreviewRow[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((row: CountryPreviewRow) => {
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(SCAN_COPY.trips.discovery(row.name));
    }
  }, []);

  const settleRows = useCallback(
    (queuedRows: readonly CountryPreviewRow[]) => {
      setEnteringKey(null);
      if (queuedRows.length === 0) return;
      setArrivedKeys((current) => {
        const next = new Set(current);
        queuedRows.forEach((row) => next.add(row.code));
        return next;
      });
      queuedRows.forEach(announce);
    },
    [announce]
  );

  const dequeueNext = useCallback(() => {
    timerRef.current = null;
    const next = queueRef.current.shift();
    if (!next) return;

    setEnteringKey(next.code);
    setArrivedKeys((current) => new Set(current).add(next.code));
    announce(next);

    timerRef.current = setTimeout(dequeueNext, SCAN_MIN_ARRIVAL_GAP);
  }, [announce]);

  useEffect(() => {
    const newRows = rows.filter((row) => !knownKeysRef.current.has(row.code));
    newRows.forEach((row) => knownKeysRef.current.add(row.code));
    queueRef.current.push(...newRows);

    if (isComplete) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const queuedRows = queueRef.current.splice(0);
      settleRows(queuedRows);
      return;
    }

    if (!timerRef.current && queueRef.current.length > 0) dequeueNext();
  }, [dequeueNext, isComplete, rows, settleRows]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      queueRef.current = [];
    },
    []
  );

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
