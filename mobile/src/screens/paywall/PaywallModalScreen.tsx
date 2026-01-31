/**
 * PaywallModalScreen - In-app paywall modal for feature gating
 *
 * Shown when free users hit feature limits (entries, share extension, photo import).
 * Uses RevenueCat's remote paywall UI for consistency with onboarding paywall.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { usePaywallPresentation } from '@hooks/usePaywallPresentation';
import type { RootStackScreenProps, GatedFeature } from '@navigation/types';
import { Analytics } from '@services/analytics';

type Props = RootStackScreenProps<'PaywallModal'>;

const FEATURE_MESSAGES: Record<GatedFeature, string> = {
  shareExtension:
    "You've used your 5 free saves this month. Upgrade for unlimited saves from social media.",
  photoImport: "You've already imported one trip from photos. Upgrade to import unlimited trips.",
  entries: 'This trip has reached 10 entries. Upgrade for unlimited entries per trip.',
};

export function PaywallModalScreen({ navigation, route }: Props) {
  const feature = (route.params?.feature as GatedFeature) || 'entries';
  const [isLoading, setIsLoading] = useState(false);
  const hasPresented = useRef(false);
  const { presentPaywall } = usePaywallPresentation('modal');

  const dismiss = useCallback(() => {
    Analytics.paywallDismissed({ location: 'modal', feature });
    navigation.goBack();
  }, [navigation, feature]);

  const handlePresentPaywall = useCallback(async () => {
    // Prevent double presentation
    if (hasPresented.current) return;
    hasPresented.current = true;

    setIsLoading(true);

    const { success, cancelled, error } = await presentPaywall({ feature });

    if (success) {
      // Navigate back without triggering dismiss analytics (purchase succeeded)
      navigation.goBack();
    } else {
      if (cancelled || error) {
        Analytics.paywallDismissed({ location: 'modal', feature });
      }
      // Skip the intermediate modal screen on cancel/error
      navigation.goBack();
    }

    setIsLoading(false);
  }, [presentPaywall, navigation, feature]);

  useEffect(() => {
    // Auto-present paywall when modal opens (matches onboarding behavior)
    const timer = setTimeout(() => {
      handlePresentPaywall();
    }, 100);
    return () => clearTimeout(timer);
  }, [handlePresentPaywall]);

  // Reset presentation flag when screen is focused
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      hasPresented.current = false;
    });
    return unsubscribe;
  }, [navigation]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.content}>
        {/* Close button */}
        <TouchableOpacity style={styles.closeButton} onPress={dismiss} accessibilityLabel="Close">
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>

        {/* Feature limit message */}
        <View style={styles.messageContainer}>
          <Text style={styles.title}>Upgrade to Premium</Text>
          <Text style={styles.message}>{FEATURE_MESSAGES[feature]}</Text>
        </View>

        {/* CTA Button */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.upgradeButton}
            onPress={handlePresentPaywall}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel="View subscription options"
          >
            {isLoading ? (
              <ActivityIndicator color={colors.midnightNavy} />
            ) : (
              <Text style={styles.upgradeButtonText}>View Options</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.maybeLaterButton} onPress={dismiss}>
            <Text style={styles.maybeLaterText}>Maybe Later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.backgroundSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 18,
    color: colors.midnightNavy,
  },
  messageContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    color: colors.midnightNavy,
    textAlign: 'center',
    marginBottom: 16,
  },
  message: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 16,
  },
  buttonContainer: {
    alignItems: 'center',
  },
  upgradeButton: {
    backgroundColor: colors.sunsetGold,
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 12,
    minWidth: 200,
    alignItems: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  upgradeButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  maybeLaterButton: {
    paddingVertical: 16,
    marginTop: 8,
  },
  maybeLaterText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
  },
});
