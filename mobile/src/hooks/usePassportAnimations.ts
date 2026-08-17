import { useCallback, useEffect, useRef } from 'react';
import { Animated, Easing, type ViewToken } from 'react-native';
import type { ListItem } from '../screens/passport/passportTypes';
import { useReducedMotion } from './useReducedMotion';

// ============ ANIMATION CONSTANTS ============

// Maximum cached animation values before cleanup triggers
// ~100 rows covers most scrolling patterns without excessive memory
const MAX_CACHED_ANIMATION_VALUES = 100;
const INITIAL_BOOTSTRAP_ROWS = 6;
// Diagonal wave stagger timing (passport-specific tuning)
/** Delay between cards within a row (ms) */
export const CARD_STAGGER_DELAY = 25;
/** Additional delay between rows for diagonal wave effect (ms) */
export const ROW_STAGGER_DELAY = 12;
/** Maximum total duration for stagger sequence (ms) - passport specific */
export const STAGGER_MAX_DURATION_PASSPORT = 280;

type RowHeights = {
  'section-header': number;
  'stamp-row': number;
  'unvisited-row': number;
  'empty-state': number;
};

export function usePassportAnimations(_isLoading: boolean, rowHeights: RowHeights) {
  // Check for reduced motion preference (WCAG 2.1 Level AA)
  const reduceMotion = useReducedMotion();

  // Store animation values per row with LRU-style tracking
  const rowAnimationValuesRef = useRef<Map<string, Animated.Value[]>>(new Map());
  // Track access order for LRU cleanup (most recent at end)
  const accessOrderRef = useRef<string[]>([]);
  // Track rows that have already animated (avoid flicker on repeated callbacks)
  const animatedRowKeysRef = useRef<Set<string>>(new Set());
  // Ref to hold current reduce motion state for stable callbacks
  const reduceMotionRef = useRef(reduceMotion);
  // Track row indices for diagonal wave calculation
  const rowIndexMapRef = useRef<Map<string, number>>(new Map());
  // Counter for assigning row indices
  const nextRowIndexRef = useRef(0);
  // Bootstrap a few rows immediately in case viewability callback is delayed
  const bootstrappedRowCountRef = useRef(0);
  // Track setTimeout IDs for cleanup
  const timeoutIdsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Fade animation for container (always visible)
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Viewability config (stable reference)
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 10,
    minimumViewTime: 0,
  }).current;

  const startRowAnimation = useCallback((rowKey: string, values: Animated.Value[]) => {
    if (reduceMotionRef.current) return;
    animatedRowKeysRef.current.add(rowKey);

    const rowIndex = rowIndexMapRef.current.get(rowKey) ?? 0;
    const baseRowIndex = rowIndex;

    values.forEach((value, cardIndex) => {
      // Ensure we always start from the low state before animating
      value.stopAnimation();
      value.setValue(0.4);

      const rowDelay = (rowIndex - baseRowIndex) * ROW_STAGGER_DELAY;
      const cardDelay = cardIndex * CARD_STAGGER_DELAY;
      const totalDelay = Math.min(rowDelay + cardDelay, STAGGER_MAX_DURATION_PASSPORT);

      const animation = Animated.timing(value, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

      if (totalDelay === 0) {
        animation.start();
      } else {
        const timeoutId = setTimeout(() => {
          timeoutIdsRef.current.delete(timeoutId);
          animation.start();
        }, totalDelay);
        timeoutIdsRef.current.add(timeoutId);
      }
    });
  }, []);

  // Keep refs in sync with current values
  useEffect(() => {
    reduceMotionRef.current = reduceMotion;
  }, [reduceMotion]);

  // Update access order for LRU tracking
  const updateAccessOrder = useCallback((rowKey: string) => {
    const order = accessOrderRef.current;
    const existingIndex = order.indexOf(rowKey);
    if (existingIndex !== -1) {
      order.splice(existingIndex, 1);
    }
    order.push(rowKey);
  }, []);

  // Clean up oldest entries when cache exceeds limit
  const cleanupIfNeeded = useCallback(() => {
    const cache = rowAnimationValuesRef.current;
    const order = accessOrderRef.current;

    if (cache.size <= MAX_CACHED_ANIMATION_VALUES) {
      return;
    }

    // Remove oldest entries (first half of excess)
    const excess = cache.size - MAX_CACHED_ANIMATION_VALUES;
    const toRemove = Math.max(1, Math.floor(excess / 2) + 10);

    for (let i = 0; i < toRemove && order.length > 0; i++) {
      const oldestKey = order.shift();
      if (oldestKey) {
        cache.delete(oldestKey);
      }
    }
  }, []);

  // Get or create animation values for a row
  // Values start at 0 and wait for visibility callback to animate
  const getRowAnimationValues = useCallback(
    (rowKey: string, cardCount: number): Animated.Value[] => {
      // Update access order for LRU tracking
      updateAccessOrder(rowKey);

      // Always return existing values if we have them (resize if data changed)
      const existing = rowAnimationValuesRef.current.get(rowKey);
      if (existing) {
        if (existing.length !== cardCount) {
          const resizedValues = Array.from({ length: cardCount }, (_, index) => {
            if (existing[index]) return existing[index];
            // New cards should animate in; keep mostly visible to reduce pop-in
            return new Animated.Value(reduceMotionRef.current ? 1 : 0.4);
          });
          rowAnimationValuesRef.current.set(rowKey, resizedValues);
          cleanupIfNeeded();
          return resizedValues;
        }
        return existing;
      }

      // Assign row index for diagonal wave calculation
      if (!rowIndexMapRef.current.has(rowKey)) {
        rowIndexMapRef.current.set(rowKey, nextRowIndexRef.current++);
      }

      // Respect reduced motion preference
      if (reduceMotionRef.current) {
        const values = Array.from({ length: cardCount }, () => new Animated.Value(1));
        rowAnimationValuesRef.current.set(rowKey, values);
        cleanupIfNeeded();
        return values;
      }

      // New row - start mostly visible, will animate when visible
      const values = Array.from({ length: cardCount }, () => new Animated.Value(0.4));
      rowAnimationValuesRef.current.set(rowKey, values);
      cleanupIfNeeded();

      // Bootstrap initial viewport rows to ensure animation even if viewability is delayed
      if (bootstrappedRowCountRef.current < INITIAL_BOOTSTRAP_ROWS) {
        bootstrappedRowCountRef.current += 1;
        startRowAnimation(rowKey, values);
      }

      return values;
    },
    [updateAccessOrder, cleanupIfNeeded, startRowAnimation]
  );

  // Handle row visibility changes - animate rows when they become visible
  // Implements diagonal wave stagger pattern (top-left to bottom-right)
  // Must be a stable ref for FlatList
  const handleViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<ListItem>[] }) => {
      // Skip all animations if reduce motion is enabled
      if (reduceMotionRef.current) {
        return;
      }

      // Collect all rows that need animation
      const rowsToAnimate: Array<{
        rowKey: string;
        rowIndex: number;
        values: Animated.Value[];
      }> = [];

      viewableItems.forEach((viewToken) => {
        const item = viewToken.item;
        if (!item || !viewToken.isViewable) return;
        if (item.type !== 'stamp-row' && item.type !== 'unvisited-row') return;

        const rowKey = item.key;

        // Avoid re-triggering rows that already animated
        if (animatedRowKeysRef.current.has(rowKey)) {
          return;
        }

        const values = rowAnimationValuesRef.current.get(rowKey);
        if (!values) {
          return;
        }

        const rowIndex = rowIndexMapRef.current.get(rowKey) ?? 0;
        rowsToAnimate.push({ rowKey, rowIndex, values });
      });

      if (rowsToAnimate.length === 0) return;

      // Sort by row index for consistent diagonal wave
      rowsToAnimate.sort((a, b) => a.rowIndex - b.rowIndex);

      // Calculate base row delay from first visible row
      const baseRowIndex = rowsToAnimate[0].rowIndex;

      // Create all animations with diagonal wave timing
      const allAnimations: Array<{ animation: Animated.CompositeAnimation; delay: number }> = [];

      rowsToAnimate.forEach(({ rowIndex, values, rowKey: _rowKey }) => {
        const relativeRowIndex = rowIndex - baseRowIndex;
        const rowDelay = relativeRowIndex * ROW_STAGGER_DELAY;

        values.forEach((value, cardIndex) => {
          // Diagonal wave: delay = rowDelay + cardDelay
          // Cards further right start later within their row
          const cardDelay = cardIndex * CARD_STAGGER_DELAY;
          const totalDelay = Math.min(rowDelay + cardDelay, STAGGER_MAX_DURATION_PASSPORT);

          allAnimations.push({
            delay: totalDelay,
            animation: Animated.timing(value, {
              toValue: 1,
              duration: 260,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          });
        });
      });

      // Sort by delay and start animations with setTimeout for diagonal wave effect
      allAnimations.sort((a, b) => a.delay - b.delay);

      allAnimations.forEach(({ animation, delay }) => {
        if (delay === 0) {
          animation.start();
        } else {
          const timeoutId = setTimeout(() => {
            timeoutIdsRef.current.delete(timeoutId);
            animation.start();
          }, delay);
          timeoutIdsRef.current.add(timeoutId);
        }
      });
    }
  ).current;

  // Compute layout data for O(1) getItemLayout lookups
  const computeLayoutData = useCallback(
    (flatListData: ListItem[]) => {
      const offsets: number[] = [];
      const lengths: number[] = [];
      let cumulativeOffset = 0;

      for (const item of flatListData) {
        offsets.push(cumulativeOffset);
        const length = rowHeights[item.type];
        lengths.push(length);
        cumulativeOffset += length;
      }

      return { offsets, lengths };
    },
    [rowHeights]
  );

  // Get item key for FlatList
  const getItemKey = useCallback((item: ListItem) => item.key, []);

  // Cleanup timeouts on unmount to prevent memory leaks
  useEffect(() => {
    const timeoutIds = timeoutIdsRef.current;
    return () => {
      timeoutIds.forEach((id) => clearTimeout(id));
      timeoutIds.clear();
    };
  }, []);

  // Stop all animations when reduce motion is enabled
  useEffect(() => {
    if (reduceMotion) {
      // Clear any pending animations
      timeoutIdsRef.current.forEach((id) => clearTimeout(id));
      timeoutIdsRef.current.clear();
      animatedRowKeysRef.current.clear();

      // Set all animation values to 1 (fully visible)
      rowAnimationValuesRef.current.forEach((values) => {
        values.forEach((value) => {
          value.stopAnimation();
          value.setValue(1);
        });
      });
    }
  }, [reduceMotion]);

  return {
    fadeAnim,
    viewabilityConfig,
    getRowAnimationValues,
    handleViewableItemsChanged,
    computeLayoutData,
    getItemKey,
  };
}
