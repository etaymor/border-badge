/**
 * Loading and Error state components for ShareCaptureScreen.
 *
 * Extracted to reduce the main screen file size.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { SocialProvider } from '@hooks/useSocialIngest';
import { getProviderDisplayName, getErrorDetails, type ErrorDetails } from './shareCaptureUtils';

/** Maximum time to wait for extraction before showing timeout warning */
const EXTRACTION_TIMEOUT_MS = 15000;

/** Time to show initial message before showing progress */
const INITIAL_DELAY_MS = 2000;

interface LoadingStateProps {
  provider: SocialProvider | null;
  onCancel?: () => void;
}

/**
 * Loading state shown while fetching details from social media provider.
 * Shows enhanced progress messages and a cancel option after timeout.
 */
export function ShareCaptureLoadingState({ provider, onCancel }: LoadingStateProps) {
  const insets = useSafeAreaInsets();
  const providerName = getProviderDisplayName(provider);

  // Track elapsed time for timeout warning
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Progress bar animation
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Start progress bar animation (15 seconds)
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: EXTRACTION_TIMEOUT_MS,
      useNativeDriver: false,
    }).start();

    // Show progress indicator after initial delay
    progressRef.current = setTimeout(() => {
      setShowProgress(true);
    }, INITIAL_DELAY_MS);

    // Show timeout warning after 15 seconds
    timeoutRef.current = setTimeout(() => {
      setShowTimeoutWarning(true);
    }, EXTRACTION_TIMEOUT_MS);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (progressRef.current) clearTimeout(progressRef.current);
      progressAnim.stopAnimation();
    };
  }, [progressAnim]);

  // Interpolate progress bar width
  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={[styles.centered, { paddingTop: insets.top }]}>
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.sunsetGold} />
        <Text style={styles.loadingText}>
          {showTimeoutWarning
            ? 'Taking longer than expected...'
            : `Processing ${providerName} link...`}
        </Text>

        {/* Progress bar */}
        {showProgress && (
          <View style={styles.progressContainer}>
            <View style={styles.progressTrack}>
              <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
            </View>
            <Text style={styles.progressHint}>Extracting place details</Text>
          </View>
        )}

        {/* Timeout warning with cancel option */}
        {showTimeoutWarning && onCancel && (
          <View style={styles.timeoutContainer}>
            <Text style={styles.timeoutText}>
              The server is busy. You can wait or try again later.
            </Text>
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

interface ErrorStateProps {
  error: string;
  onRetry: () => void;
  onManualEntry: () => void;
  onSaveForLater: () => void;
  onCancel: () => void;
}

/**
 * Error state shown when URL processing fails.
 * Shows appropriate actions based on error type.
 */
export function ShareCaptureErrorState({
  error,
  onRetry,
  onManualEntry,
  onSaveForLater,
  onCancel,
}: ErrorStateProps) {
  const insets = useSafeAreaInsets();
  const errorDetails: ErrorDetails = getErrorDetails(error);

  return (
    <View style={[styles.centered, { paddingTop: insets.top }]}>
      <View style={styles.errorContainer}>
        <Ionicons
          name={errorDetails.isOffline ? 'cloud-offline-outline' : 'alert-circle-outline'}
          size={48}
          color={errorDetails.isOffline ? colors.midnightNavy : colors.adobeBrick}
        />
        <Text style={styles.errorTitle}>{errorDetails.title}</Text>
        <Text style={styles.errorMessage}>{errorDetails.message}</Text>
        <View style={styles.errorActions}>
          {errorDetails.canRetry && <Button title="Try Again" onPress={onRetry} />}
          {errorDetails.showManualEntry && (
            <Button title="Enter Manually" onPress={onManualEntry} variant="secondary" />
          )}
          {errorDetails.isOffline && (
            <Button title="Save for Later" onPress={onSaveForLater} variant="secondary" />
          )}
          <TouchableOpacity style={styles.cancelLink} onPress={onCancel}>
            <Text style={styles.cancelLinkText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.warmCream,
    paddingHorizontal: 24,
  },

  // Loading
  loadingContainer: {
    alignItems: 'center',
    width: '100%',
    maxWidth: 300,
  },
  loadingText: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginTop: 20,
    textAlign: 'center',
  },
  progressContainer: {
    width: '100%',
    marginTop: 24,
    alignItems: 'center',
  },
  progressTrack: {
    width: '80%',
    height: 4,
    backgroundColor: colors.midnightNavy + '20',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.sunsetGold,
    borderRadius: 2,
  },
  progressHint: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
    marginTop: 8,
  },
  timeoutContainer: {
    marginTop: 24,
    alignItems: 'center',
  },
  timeoutText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    textAlign: 'center',
    marginBottom: 16,
  },
  cancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: colors.midnightNavy + '10',
    borderRadius: 8,
  },
  cancelButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },

  // Error
  errorContainer: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  errorTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginTop: 16,
    marginBottom: 8,
  },
  errorMessage: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  errorActions: {
    width: '100%',
    gap: 12,
  },
  cancelLink: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelLinkText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.stormGray,
  },
});
