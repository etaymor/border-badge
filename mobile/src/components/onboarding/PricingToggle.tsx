import { Animated, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useEffect, useMemo, useRef } from 'react';

import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

export type PricingPlan = 'yearly' | 'monthly';

export interface PricingToggleProps {
  selectedPlan: PricingPlan;
  onPlanChange: (plan: PricingPlan) => void;
}

const YEARLY_PRICE = 39.99;
const MONTHLY_PRICE = 4.99;
const SAVINGS_PERCENT = 33;

export default function PricingToggle({ selectedPlan, onPlanChange }: PricingToggleProps) {
  const yearlyBorderAnim = useRef(new Animated.Value(selectedPlan === 'yearly' ? 1 : 0)).current;
  const monthlyBorderAnim = useRef(new Animated.Value(selectedPlan === 'monthly' ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(yearlyBorderAnim, {
        toValue: selectedPlan === 'yearly' ? 1 : 0,
        friction: 8,
        tension: 100,
        useNativeDriver: false,
      }),
      Animated.spring(monthlyBorderAnim, {
        toValue: selectedPlan === 'monthly' ? 1 : 0,
        friction: 8,
        tension: 100,
        useNativeDriver: false,
      }),
    ]).start();
  }, [selectedPlan, yearlyBorderAnim, monthlyBorderAnim]);

  // Memoize interpolations to prevent recreation on every render (Issue #6)
  const yearlyBorderColor = useMemo(
    () =>
      yearlyBorderAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [colors.paperBeige, colors.sunsetGold],
      }),
    [yearlyBorderAnim]
  );

  const monthlyBorderColor = useMemo(
    () =>
      monthlyBorderAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [colors.paperBeige, colors.sunsetGold],
      }),
    [monthlyBorderAnim]
  );

  return (
    <View style={styles.container}>
      {/* Yearly Plan */}
      <TouchableOpacity
        style={styles.cardTouchable}
        onPress={() => onPlanChange('yearly')}
        activeOpacity={0.8}
        accessibilityRole="radio"
        accessibilityState={{ selected: selectedPlan === 'yearly' }}
        accessibilityLabel={`Yearly plan, $${YEARLY_PRICE} per year, save ${SAVINGS_PERCENT}%, 7-day free trial`}
      >
        <Animated.View
          style={[
            styles.card,
            styles.yearlyCard,
            { borderColor: yearlyBorderColor },
          ]}
        >
          {/* Save Badge */}
          <View style={styles.saveBadge}>
            <Text style={styles.saveBadgeText}>SAVE {SAVINGS_PERCENT}%</Text>
          </View>

          <Text style={styles.planLabel}>Yearly</Text>
          <View style={styles.priceRow}>
            <Text style={styles.priceAmount}>${YEARLY_PRICE}</Text>
            <Text style={styles.pricePeriod}>/year</Text>
          </View>
          <Text style={styles.trialText}>7-day free trial</Text>
        </Animated.View>
      </TouchableOpacity>

      {/* Monthly Plan */}
      <TouchableOpacity
        style={styles.cardTouchable}
        onPress={() => onPlanChange('monthly')}
        activeOpacity={0.8}
        accessibilityRole="radio"
        accessibilityState={{ selected: selectedPlan === 'monthly' }}
        accessibilityLabel={`Monthly plan, $${MONTHLY_PRICE} per month, 7-day free trial`}
      >
        <Animated.View
          style={[
            styles.card,
            { borderColor: monthlyBorderColor },
          ]}
        >
          <Text style={styles.planLabel}>Monthly</Text>
          <View style={styles.priceRow}>
            <Text style={styles.priceAmount}>${MONTHLY_PRICE}</Text>
            <Text style={styles.pricePeriod}>/mo</Text>
          </View>
          <Text style={styles.trialText}>7-day free trial</Text>
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 24,
  },
  cardTouchable: {
    flex: 1,
  },
  card: {
    backgroundColor: colors.paperBeige,
    borderRadius: 16,
    padding: 16,
    borderWidth: 3,
    alignItems: 'center',
    minHeight: 130,
    justifyContent: 'center',
  },
  yearlyCard: {
    position: 'relative',
  },
  saveBadge: {
    position: 'absolute',
    top: -10,
    backgroundColor: colors.mossGreen,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  saveBadgeText: {
    fontFamily: fonts.openSans.bold,
    fontSize: 11,
    color: colors.cloudWhite,
    letterSpacing: 0.5,
  },
  planLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.stormGray,
    marginBottom: 4,
    marginTop: 8,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  priceAmount: {
    fontFamily: fonts.openSans.bold,
    fontSize: 24,
    color: colors.midnightNavy,
  },
  pricePeriod: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    marginLeft: 2,
  },
  trialText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.mossGreen,
    marginTop: 8,
  },
});
