import { useCallback, useRef } from 'react';
import { Animated, type ViewToken } from 'react-native';
import { ROW_HEIGHTS } from '../screens/passport/passportConstants';
import type { ListItem } from '../screens/passport/passportTypes';

// Maximum cached animation values before cleanup triggers
// ~100 rows covers most scrolling patterns without excessive memory
const MAX_CACHED_ANIMATION_VALUES = 100;

export function usePassportAnimations(_isLoading: boolean) {
  // Track which rows have animated (prevent re-animation on scroll back)
  const animatedRowKeysRef = useRef<Set<string>>(new Set());
  // Store animation values per row with LRU-style tracking
  const rowAnimationValuesRef = useRef<Map<string, Animated.Value[]>>(new Map());
  // Track access order for LRU cleanup (most recent at end)
  const accessOrderRef = useRef<string[]>([]);

  // Fade animation for container (always visible)
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Viewability config (stable reference)
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 10,
    minimumViewTime: 0,
  }).current;

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
        // Note: we keep animatedRowKeysRef intact so re-created values start at 1
      }
    }
  }, []);

  // Get or create animation values for a row
  // Values start at 0 and wait for visibility callback to animate
  const getRowAnimationValues = useCallback(
    (rowKey: string, cardCount: number): Animated.Value[] => {
      // Update access order for LRU tracking
      updateAccessOrder(rowKey);

      // Always return existing values if we have them
      const existing = rowAnimationValuesRef.current.get(rowKey);
      if (existing) {
        return existing;
      }

      // Check if already animated - if so, start at 1
      if (animatedRowKeysRef.current.has(rowKey)) {
        const values = Array.from({ length: cardCount }, () => new Animated.Value(1));
        rowAnimationValuesRef.current.set(rowKey, values);
        cleanupIfNeeded();
        return values;
      }

      // New row - start at 0, will animate when visible
      const values = Array.from({ length: cardCount }, () => new Animated.Value(0));
      rowAnimationValuesRef.current.set(rowKey, values);
      cleanupIfNeeded();
      return values;
    },
    [updateAccessOrder, cleanupIfNeeded]
  );

  // No longer needed but kept for interface compatibility
  const ensureRowVisible = useCallback((_rowKey: string, _animValues: Animated.Value[]) => {
    // Not needed with new approach
  }, []);

  // Handle row visibility changes - animate rows when they become visible
  // Must be a stable ref for FlatList
  const handleViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<ListItem>[] }) => {
      viewableItems.forEach((viewToken) => {
        const item = viewToken.item;
        if (!item || !viewToken.isViewable) return;
        if (item.type !== 'stamp-row' && item.type !== 'unvisited-row') return;

        const rowKey = item.key;

        // Don't animate if already animated
        if (animatedRowKeysRef.current.has(rowKey)) {
          return;
        }

        const values = rowAnimationValuesRef.current.get(rowKey);
        if (!values) {
          return;
        }

        animatedRowKeysRef.current.add(rowKey);

        // Stagger animation for cards in the row
        Animated.stagger(
          100,
          values.map((value) =>
            Animated.spring(value, {
              toValue: 1,
              friction: 6,
              tension: 40,
              useNativeDriver: true,
            })
          )
        ).start();
      });
    }
  ).current;

  // Compute layout data for O(1) getItemLayout lookups
  const computeLayoutData = useCallback((flatListData: ListItem[]) => {
    const offsets: number[] = [];
    const lengths: number[] = [];
    let cumulativeOffset = 0;

    for (const item of flatListData) {
      offsets.push(cumulativeOffset);
      const length = ROW_HEIGHTS[item.type];
      lengths.push(length);
      cumulativeOffset += length;
    }

    return { offsets, lengths };
  }, []);

  // Get item key for FlatList
  const getItemKey = useCallback((item: ListItem) => item.key, []);

  return {
    fadeAnim,
    viewabilityConfig,
    getRowAnimationValues,
    ensureRowVisible,
    handleViewableItemsChanged,
    computeLayoutData,
    getItemKey,
  };
}
