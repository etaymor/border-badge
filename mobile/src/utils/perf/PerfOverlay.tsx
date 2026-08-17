/**
 * Optional on-screen readout for the frame-metrics harness (U1).
 *
 * Dev-only floating control to start/stop a measurement run without a dev-menu
 * round-trip. Renders nothing unless the harness is armed
 * ({@link isPerfMetricsEnabled}), so it is safe to mount unconditionally near
 * the app root. It never ships: the guard short-circuits in production.
 */

import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { isPerfMetricsEnabled, type FrameRunSummary } from './frameMetrics';
import { startPerfRun, stopPerfRun } from './frameMetricsController';

const DEFAULT_LABEL = 'run';

export function PerfOverlay(): React.JSX.Element | null {
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<{ ui: FrameRunSummary; js: FrameRunSummary } | null>(null);

  const onToggle = useCallback(() => {
    if (running) {
      const result = stopPerfRun();
      setLast(result);
      setRunning(false);
    } else {
      startPerfRun(DEFAULT_LABEL);
      setLast(null);
      setRunning(true);
    }
  }, [running]);

  if (!isPerfMetricsEnabled()) {
    return null;
  }

  return (
    <View style={styles.container} pointerEvents="box-none">
      <Pressable style={[styles.button, running && styles.buttonActive]} onPress={onToggle}>
        <Text style={styles.buttonText}>{running ? 'STOP perf' : 'START perf'}</Text>
      </Pressable>
      {last && (
        <View style={styles.readout}>
          <Text style={styles.readoutText}>{summaryLine('UI', last.ui)}</Text>
          <Text style={styles.readoutText}>{summaryLine('JS', last.js)}</Text>
        </View>
      )}
    </View>
  );
}

function summaryLine(prefix: string, s: FrameRunSummary): string {
  return `${prefix}: ${s.drops}drops ${s.hardDrops}hard ${s.longestStallMs.toFixed(0)}ms/${s.frames}f`;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 90,
    right: 8,
    alignItems: 'flex-end',
  },
  button: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  buttonActive: {
    backgroundColor: 'rgba(200,0,0,0.85)',
  },
  buttonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  readout: {
    marginTop: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  readoutText: {
    color: '#0f0',
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
});
