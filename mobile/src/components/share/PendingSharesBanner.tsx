/**
 * PendingSharesBanner - Dismissible banner showing pending shares in the queue.
 *
 * Shows when there are shares waiting to be processed, with options to:
 * - Retry all pending shares
 * - Clear the queue
 * - Dismiss the banner
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { getPendingShares, clearAllShares, flushQueue, QueuedShare } from '@services/shareQueue';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface PendingSharesBannerProps {
  /** Called when a retry function is needed */
  retryFn?: (share: QueuedShare) => Promise<boolean>;
  /** Called when banner visibility changes */
  onVisibilityChange?: (visible: boolean) => void;
}

export function PendingSharesBanner({ retryFn, onVisibilityChange }: PendingSharesBannerProps) {
  const [pendingCount, setPendingCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // Animation values
  const translateY = useRef(new Animated.Value(-20)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  // Load pending count on mount
  useEffect(() => {
    const loadCount = async () => {
      const shares = await getPendingShares();
      setPendingCount(shares.length);
    };
    loadCount();
  }, []);

  // Animate based on visibility
  const isVisible = pendingCount > 0 && !isDismissed;

  useEffect(() => {
    onVisibilityChange?.(isVisible);

    if (isVisible) {
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 12,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -20,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isVisible, translateY, opacity, onVisibilityChange]);

  const handleRetryAll = useCallback(async () => {
    if (!retryFn || isRetrying) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsRetrying(true);

    try {
      const result = await flushQueue(retryFn);
      // Refresh count after retry
      const shares = await getPendingShares();
      setPendingCount(shares.length);

      if (result.succeeded > 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } finally {
      setIsRetrying(false);
    }
  }, [retryFn, isRetrying]);

  const handleClearAll = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await clearAllShares();
    setPendingCount(0);
  }, []);

  const handleDismiss = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsDismissed(true);
  }, []);

  // Don't render if nothing to show
  if (!isVisible) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      <View style={styles.banner}>
        {/* Icon */}
        <View style={styles.iconContainer}>
          <Ionicons name="time-outline" size={18} color={colors.sunsetGold} />
        </View>

        {/* Message */}
        <View style={styles.content}>
          <Text style={styles.title}>
            {pendingCount} {pendingCount === 1 ? 'link' : 'links'} pending
          </Text>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          {retryFn && (
            <TouchableOpacity
              style={styles.retryButton}
              onPress={handleRetryAll}
              disabled={isRetrying}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Retry all pending shares"
            >
              {isRetrying ? (
                <ActivityIndicator size="small" color={colors.midnightNavy} />
              ) : (
                <Text style={styles.retryButtonText}>Retry</Text>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.clearButton}
            onPress={handleClearAll}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Clear all pending shares"
          >
            <Text style={styles.clearButtonText}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.dismissButton}
            onPress={handleDismiss}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Dismiss pending shares banner"
          >
            <Ionicons name="close" size={18} color={colors.stormGray} />
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cloudWhite,
    borderRadius: 12,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 6,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
    gap: 8,
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: 'rgba(218, 165, 32, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 13,
    color: colors.midnightNavy,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  retryButton: {
    backgroundColor: colors.sunsetGold,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    minWidth: 50,
    alignItems: 'center',
  },
  retryButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 12,
    color: colors.midnightNavy,
  },
  clearButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  clearButtonText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.stormGray,
  },
  dismissButton: {
    padding: 6,
  },
});
