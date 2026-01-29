/**
 * SubscriptionSection - Displays subscription status and upgrade options.
 */

import * as Haptics from 'expo-haptics';
import { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Purchases from 'react-native-purchases';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { usePaywallPresentation } from '@hooks/usePaywallPresentation';
import { Analytics } from '@services/analytics';
import { syncSubscriptionToAppGroup } from '@services/appGroupSync';
import { ENTITLEMENT_ID } from '@services/revenueCat';
import {
  useSubscriptionStore,
  useIsPremium,
  useSubscriptionStatus,
  useSubscriptionPlan,
} from '@stores/subscriptionStore';

interface SubscriptionSectionProps {
  expirationDate: string | null;
  isSmallScreen?: boolean;
}

export function SubscriptionSection({ expirationDate, isSmallScreen }: SubscriptionSectionProps) {
  const isPremium = useIsPremium();
  const status = useSubscriptionStatus();
  const plan = useSubscriptionPlan();
  const fetchCustomerInfo = useSubscriptionStore((s) => s.fetchCustomerInfo);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const { presentPaywall } = usePaywallPresentation('settings');

  const formatPlanName = useCallback((planId: string | null): string => {
    switch (planId) {
      case 'weekly':
        return 'Weekly';
      case 'monthly':
        return 'Monthly';
      case 'annual':
        return 'Annual';
      default:
        return 'Premium';
    }
  }, []);

  const formatExpirationDate = useCallback((date: string | null): string => {
    if (!date) return '';
    try {
      const d = new Date(date);
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch {
      return '';
    }
  }, []);

  const handleUpgrade = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsUpgrading(true);

    await presentPaywall();

    setIsUpgrading(false);
  }, [presentPaywall]);

  const handleManageSubscription = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Open App Store subscription management
    Purchases.getCustomerInfo().then((info) => {
      if (info.managementURL) {
        // This will open the App Store subscription management
        // Note: On iOS simulator this may not work
        Purchases.showManageSubscriptions();
      } else {
        Alert.alert(
          'Manage Subscription',
          'To manage your subscription, go to Settings > Apple ID > Subscriptions on your device.'
        );
      }
    });
  }, []);

  const handleRestorePurchases = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsRestoring(true);

    // Track restore initiated
    Analytics.restoreInitiated();

    try {
      const customerInfo = await Purchases.restorePurchases();
      await syncSubscriptionToAppGroup(customerInfo);
      await fetchCustomerInfo();

      const hasActiveEntitlement = customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined;
      Analytics.restoreCompleted({ foundSubscription: hasActiveEntitlement });

      if (hasActiveEntitlement) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Success', 'Your subscription has been restored.');
      } else {
        Alert.alert('No Subscription Found', 'No active subscription was found for this account.');
      }
    } catch (error) {
      console.error('[SubscriptionSection] Error restoring purchases:', error);
      Analytics.restoreFailed({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      Alert.alert(
        'Restore Failed',
        'Unable to restore purchases. Please try again or contact support.'
      );
    } finally {
      setIsRestoring(false);
    }
  }, [fetchCustomerInfo]);

  const getStatusDisplay = useCallback((): { label: string; color: string } => {
    switch (status) {
      case 'premium':
        return { label: 'Premium', color: colors.mossGreen };
      case 'trial':
        return { label: 'Trial', color: colors.sunsetGold };
      case 'free':
      default:
        return { label: 'Free', color: colors.stormGray };
    }
  }, [status]);

  const statusDisplay = getStatusDisplay();

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, isSmallScreen && styles.sectionTitleSmall]}>
          SUBSCRIPTION
        </Text>
        <View style={styles.card}>
          {/* Status Row */}
          <View style={styles.cardRow}>
            <Text style={[styles.rowLabel, isSmallScreen && styles.rowLabelSmall]}>Status</Text>
            <View style={styles.statusContainer}>
              <View style={[styles.statusBadge, { backgroundColor: statusDisplay.color + '20' }]}>
                <Text style={[styles.statusText, { color: statusDisplay.color }]}>
                  {statusDisplay.label}
                </Text>
              </View>
            </View>
          </View>

          {/* Plan Row (if subscribed) */}
          {isPremium && plan && (
            <>
              <View style={styles.divider} />
              <View style={styles.cardRow}>
                <Text style={[styles.rowLabel, isSmallScreen && styles.rowLabelSmall]}>Plan</Text>
                <Text style={[styles.rowValue, isSmallScreen && styles.rowValueSmall]}>
                  {formatPlanName(plan)}
                </Text>
              </View>
            </>
          )}

          {/* Renewal/Expiration Row (if subscribed) */}
          {isPremium && expirationDate && (
            <>
              <View style={styles.divider} />
              <View style={styles.cardRow}>
                <Text style={[styles.rowLabel, isSmallScreen && styles.rowLabelSmall]}>
                  {status === 'trial' ? 'Trial Ends' : 'Renews'}
                </Text>
                <Text style={[styles.rowValue, isSmallScreen && styles.rowValueSmall]}>
                  {formatExpirationDate(expirationDate)}
                </Text>
              </View>
            </>
          )}

          {/* Manage Subscription (if subscribed) */}
          {isPremium && (
            <>
              <View style={styles.divider} />
              <Pressable
                onPress={handleManageSubscription}
                style={({ pressed }) => [
                  styles.cardPressable,
                  pressed && styles.cardPressableActive,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Manage subscription"
              >
                <View style={styles.cardRow}>
                  <Text style={[styles.rowLabel, isSmallScreen && styles.rowLabelSmall]}>
                    Manage Subscription
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.stormGray} />
                </View>
              </Pressable>
            </>
          )}

          {/* Upgrade Button (if free) */}
          {!isPremium && (
            <>
              <View style={styles.divider} />
              <Pressable
                onPress={handleUpgrade}
                disabled={isUpgrading}
                style={({ pressed }) => [
                  styles.cardPressable,
                  pressed && styles.cardPressableActive,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Upgrade to premium"
              >
                <View style={styles.cardRow}>
                  <Text style={[styles.upgradeLabel, isSmallScreen && styles.rowLabelSmall]}>
                    Upgrade to Premium
                  </Text>
                  {isUpgrading ? (
                    <ActivityIndicator size="small" color={colors.sunsetGold} />
                  ) : (
                    <Ionicons name="chevron-forward" size={16} color={colors.sunsetGold} />
                  )}
                </View>
              </Pressable>
            </>
          )}

          {/* Restore Purchases */}
          <View style={styles.divider} />
          <Pressable
            onPress={handleRestorePurchases}
            disabled={isRestoring}
            style={({ pressed }) => [styles.cardPressable, pressed && styles.cardPressableActive]}
            accessibilityRole="button"
            accessibilityLabel="Restore purchases"
          >
            <View style={styles.cardRow}>
              <Text style={[styles.rowLabel, isSmallScreen && styles.rowLabelSmall]}>
                Restore Purchases
              </Text>
              {isRestoring ? (
                <ActivityIndicator size="small" color={colors.stormGray} />
              ) : (
                <Ionicons name="chevron-forward" size={16} color={colors.stormGray} />
              )}
            </View>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  section: {
    marginBottom: 8,
  },
  sectionTitle: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.stormGray,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 12,
    marginLeft: 4,
  },
  sectionTitleSmall: {
    fontSize: 11,
  },
  card: {
    backgroundColor: colors.cloudWhite,
    borderRadius: 16,
    paddingVertical: 4,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  cardPressable: {
    borderRadius: 12,
  },
  cardPressableActive: {
    backgroundColor: colors.paperBeige,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.05)',
    marginLeft: 16,
  },
  rowLabel: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  rowLabelSmall: {
    fontSize: 14,
  },
  rowValue: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.stormGray,
  },
  rowValueSmall: {
    fontSize: 14,
  },
  upgradeLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.sunsetGold,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
  },
});
