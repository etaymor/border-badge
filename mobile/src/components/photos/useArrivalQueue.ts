import { useCallback, useEffect, useRef, useState } from 'react';

import { SCAN_MIN_ARRIVAL_GAP } from '@components/photos/scanMotion';
import { useStableCallback } from '@hooks/useStableCallback';

export interface ArrivalRow {
  code: string;
}

export interface UseArrivalQueueOptions<T extends ArrivalRow> {
  rows: readonly T[];
  isComplete: boolean;
  isPaused?: boolean;
  /** Called once per newly-arrived row (dequeue or completion drain). */
  onArrive?: (row: T) => void;
}

export interface UseArrivalQueueResult {
  arrivedKeys: ReadonlySet<string>;
  enteringKey: string | null;
}

/**
 * FIFO arrival pacing for ScanStage stamps.
 * Mount-known keys settle immediately; later keys dequeue one per
 * SCAN_MIN_ARRIVAL_GAP unless paused. Completion drains the queue at once.
 */
export function useArrivalQueue<T extends ArrivalRow>({
  rows,
  isComplete,
  isPaused = false,
  onArrive,
}: UseArrivalQueueOptions<T>): UseArrivalQueueResult {
  const [initialKeys] = useState(() => new Set(rows.map((row) => row.code)));
  const [arrivedKeys, setArrivedKeys] = useState(() => new Set(initialKeys));
  const [enteringKey, setEnteringKey] = useState<string | null>(null);
  const knownKeysRef = useRef(new Set(initialKeys));
  const queueRef = useRef<T[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useStableCallback((row: T) => {
    onArrive?.(row);
  });

  const settleRows = useCallback(
    (queuedRows: readonly T[], shouldAnnounce: boolean) => {
      setEnteringKey(null);
      if (queuedRows.length === 0) return;
      setArrivedKeys((current) => {
        const next = new Set(current);
        queuedRows.forEach((row) => next.add(row.code));
        return next;
      });
      if (shouldAnnounce) queuedRows.forEach(announce);
    },
    [announce]
  );

  const dequeueNext = useCallback(() => {
    timerRef.current = null;
    if (isPaused) return;
    const next = queueRef.current.shift();
    if (!next) return;

    setEnteringKey(next.code);
    setArrivedKeys((current) => new Set(current).add(next.code));
    announce(next);

    timerRef.current = setTimeout(dequeueNext, SCAN_MIN_ARRIVAL_GAP);
  }, [announce, isPaused]);

  useEffect(() => {
    const newRows = rows.filter((row) => !knownKeysRef.current.has(row.code));
    newRows.forEach((row) => knownKeysRef.current.add(row.code));
    queueRef.current.push(...newRows);

    if (isPaused) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setEnteringKey(null);
    }

    if (isComplete) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const queuedRows = queueRef.current.splice(0);
      settleRows(queuedRows, !isPaused);
      return;
    }

    if (!isPaused && !timerRef.current && queueRef.current.length > 0) dequeueNext();
  }, [dequeueNext, isComplete, isPaused, rows, settleRows]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      queueRef.current = [];
    },
    []
  );

  return { arrivedKeys, enteringKey };
}
