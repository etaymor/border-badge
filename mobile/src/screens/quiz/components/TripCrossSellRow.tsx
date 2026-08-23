/**
 * TripCrossSellRow - The one place the challenge flow mentions trips as an
 * offer rather than as a statement.
 *
 * Placement is the whole design. NOT in the working phase (someone waiting for
 * their challenge is not shopping), NOT a modal, NOT on QuizPlay (the
 * play-through is the payoff and nothing competes with it). Here, below the
 * primary CTA, after the user has what they came for.
 *
 * Four rules it exists to enforce:
 *   1. It appears only when segmentation actually PRODUCED something - never
 *      as a speculative pitch.
 *   2. It is dismissible, and dismissal is permanent.
 *   3. It is phrased as work already done ("that same scan also turned up"),
 *      never as work now being asked of the user.
 *   4. It renders nothing on first paint and fades in, appended BELOW the CTA,
 *      so it can never shove the button the user is reaching for.
 *
 * Dismissing it forever costs the user nothing structural - the trips
 * themselves do not go away, and the photo-import entry on the passport home
 * still reaches them. It does mean this row is the only PROACTIVE mention, so
 * a permanent card-level address on the passport home is a deliberate open
 * question rather than an oversight.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { colors, withAlpha } from '@constants/colors';
import { SCAN_COPY } from '@constants/scanCopy';
import { fonts } from '@constants/typography';
import { useReducedMotion } from '@hooks/useReducedMotion';
import { getMetadata, setMetadata } from '@services/photoImport/photoCacheDb';
import { countUnreviewedTripSegments } from '@services/quiz/quizTripContinuation';

const DISMISSED_KEY = 'quiz_trip_crosssell_dismissed_at';

export interface TripCrossSellRowProps {
  /** Opens the photo-import suggestions list. No second scan is run. */
  onReviewTrips: () => void;
  testID?: string;
}

export function TripCrossSellRow({ onReviewTrips, testID }: TripCrossSellRowProps) {
  const reduceMotion = useReducedMotion();
  const [tripCount, setTripCount] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const previouslyDismissed = await getMetadata(DISMISSED_KEY);
        if (previouslyDismissed) return;
        const count = await countUnreviewedTripSegments();
        if (!cancelled) setTripCount(count);
      } catch {
        // No trips row is always an acceptable outcome. This is a by-product
        // surfaced after the fact, never something the user asked for.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    void setMetadata(DISMISSED_KEY, String(Date.now())).catch(() => {
      // A failed write costs one more appearance, nothing more.
    });
  }, []);

  if (dismissed || tripCount === 0) return null;

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(240)}
      style={styles.row}
      testID={testID}
    >
      <Text style={styles.copy}>{SCAN_COPY.quiz.crossSell(tripCount)}</Text>
      <View style={styles.actions}>
        <TouchableOpacity
          onPress={onReviewTrips}
          accessibilityRole="button"
          testID="quiz-crosssell-review"
        >
          <Text style={styles.primaryAction}>{SCAN_COPY.quiz.crossSellCta}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleDismiss}
          accessibilityRole="button"
          testID="quiz-crosssell-dismiss"
        >
          <Text style={styles.secondaryAction}>{SCAN_COPY.quiz.crossSellDismiss}</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(colors.warmCream, 0.18),
    alignItems: 'center',
    gap: 10,
  },
  copy: {
    fontFamily: fonts.body.regular,
    fontSize: 13,
    lineHeight: 19,
    color: withAlpha(colors.warmCream, 0.7),
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 24,
  },
  primaryAction: {
    fontFamily: fonts.body.semiBold,
    fontSize: 14,
    color: colors.sunsetGold,
  },
  secondaryAction: {
    fontFamily: fonts.body.regular,
    fontSize: 14,
    color: withAlpha(colors.warmCream, 0.55),
  },
});

export default TripCrossSellRow;
