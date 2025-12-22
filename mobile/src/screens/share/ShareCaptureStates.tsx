/**
 * Loading and Error state components for ShareCaptureScreen.
 *
 * Extracted to reduce the main screen file size.
 */

import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { SocialProvider } from '@hooks/useSocialIngest';
import { getProviderDisplayName, getErrorDetails, type ErrorDetails } from './shareCaptureUtils';

interface LoadingStateProps {
  provider: SocialProvider | null;
}

/**
 * Loading state shown while fetching details from social media provider.
 */
export function ShareCaptureLoadingState({ provider }: LoadingStateProps) {
  const insets = useSafeAreaInsets();
  const providerName = getProviderDisplayName(provider);

  return (
    <View style={[styles.centered, { paddingTop: insets.top }]}>
      <ActivityIndicator size="large" color={colors.sunsetGold} />
      <Text style={styles.loadingText}>Fetching details from {providerName}...</Text>
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
  loadingText: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginTop: 20,
    textAlign: 'center',
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
