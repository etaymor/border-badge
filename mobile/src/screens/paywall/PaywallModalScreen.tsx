/**
 * PaywallModalScreen - In-app paywall modal for feature gating
 *
 * Shown when free users hit feature limits (entries, share extension, photo import).
 * Uses RevenueCat's remote paywall UI for consistency with onboarding paywall.
 */

import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { RootStackScreenProps, GatedFeature } from '@navigation/types';
import { Analytics } from '@services/analytics';
import { syncSubscriptionToAppGroup } from '@services/appGroupSync';
import { getSubscriptionPlan } from '@services/revenueCat';
import { useSubscriptionStore } from '@stores/subscriptionStore';

type Props = RootStackScreenProps<'PaywallModal'>;

const FEATURE_MESSAGES: Record<GatedFeature, string> = {
  shareExtension: "You've used all 5 free saves. Upgrade to save unlimited places from social media.",
  photoImport:
    "You've already imported one trip from photos. Upgrade to import unlimited trips.",
  entries: 'This trip has reached 10 entries. Upgrade for unlimited entries per trip.',
};

export function PaywallModalScreen({ navigation, route }: Props) {
  const feature = (route.params?.feature as GatedFeature) || 'entries';
  const [isLoading, setIsLoading] = useState(false);
  const hasPresented = useRef(false);
  const { fetchCustomerInfo } = useSubscriptionStore();

  const dismiss = useCallback(() => {
    Analytics.paywallDismissed({ location: 'modal', feature });
    navigation.goBack();
  }, [navigation, feature]);

  const presentPaywall = useCallback(async () => {
    // Prevent double presentation
    if (hasPresented.current) return;
    hasPresented.current = true;

    setIsLoading(true);

    // Track paywall view
    Analytics.viewPaywall({ location: 'modal', feature });

    try {
      const result = await RevenueCatUI.presentPaywall({
        displayCloseButton: true,
      });

      switch (result) {
        case PAYWALL_RESULT.PURCHASED:
        case PAYWALL_RESULT.RESTORED: {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          // Refresh subscription state and sync to App Group
          const customerInfo = await fetchCustomerInfo();
          if (customerInfo) {
            await syncSubscriptionToAppGroup(customerInfo);
            const plan = getSubscriptionPlan(customerInfo);
            Analytics.purchaseCompleted({ plan, location: 'modal' });
          }
          // Navigate back without triggering dismiss analytics (purchase succeeded)
          navigation.goBack();
          break;
        }

        case PAYWALL_RESULT.CANCELLED:
          Analytics.purchaseCancelled({ location: 'modal' });
          hasPresented.current = false;
          break;

        case PAYWALL_RESULT.NOT_PRESENTED:
        case PAYWALL_RESULT.ERROR:
        default:
          // User dismissed or error - stay on modal to show message
          hasPresented.current = false;
          break;
      }
    } catch (error) {
      console.error('[PaywallModalScreen] Error presenting paywall:', error);
      Analytics.purchaseFailed({
        plan: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        location: 'modal',
      });
      hasPresented.current = false;
    } finally {
      setIsLoading(false);
    }
  }, [fetchCustomerInfo, navigation, feature]);

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
            onPress={presentPaywall}
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
