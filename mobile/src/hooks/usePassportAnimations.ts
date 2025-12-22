import { useCallback, useRef } from 'react';
import { Animated, type ViewToken } from 'react-native';
import { ROW_HEIGHTS } from '../screens/passport/passportConstants';
import type { ListItem } from '../screens/passport/passportTypes';

export function usePassportAnimations(_isLoading: boolean) {
  // Track which rows have animated (prevent re-animation on scroll back)
  const animatedRowKeysRef = useRef<Set<string>>(new Set());
  // Store animation values per row
  const rowAnimationValuesRef = useRef<Map<string, Animated.Value[]>>(new Map());

  // Fade animation for container (always visible)
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Viewability config (stable reference)
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 10,
    minimumViewTime: 0,
  }).current;

  // Get or create animation values for a row
  // Values start at 0 and wait for visibility callback to animate
  const getRowAnimationValues = useCallback(
    (rowKey: string, cardCount: number): Animated.Value[] => {
      // Always return existing values if we have them
      const existing = rowAnimationValuesRef.current.get(rowKey);
      if (existing) {
        return existing;
      }

      // Check if already animated - if so, start at 1
      if (animatedRowKeysRef.current.has(rowKey)) {
        const values = Array.from({ length: cardCount }, () => new Animated.Value(1));
        rowAnimationValuesRef.current.set(rowKey, values);
        return values;
      }

      // New row - start at 0, will animate when visible
      const values = Array.from({ length: cardCount }, () => new Animated.Value(0));
      rowAnimationValuesRef.current.set(rowKey, values);
      return values;
    },
    []
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
