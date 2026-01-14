import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useReducedMotion } from '@hooks/useReducedMotion';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface CardMeasurements {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CountryCardTooltipOverlayProps {
  visible: boolean;
  onComplete: () => void;
  cardMeasurements: CardMeasurements | null;
}

const TOOLTIP_CONTENT = [
  {
    text: "Tap cards (or +) for countries you've visited",
    target: 'card' as const,
  },
  {
    text: 'Tap the heart to add to your bucket list',
    target: 'heart' as const,
  },
];

// Card has 24px border radius, heart button has 20px
const CARD_BORDER_RADIUS = 24;
const HEART_BORDER_RADIUS = 20;

export default function CountryCardTooltipOverlay({
  visible,
  onComplete,
  cardMeasurements,
}: CountryCardTooltipOverlayProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const reduceMotion = useReducedMotion();

  // Animation values
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const tooltipOpacity = useRef(new Animated.Value(0)).current;
  const tooltipTranslateY = useRef(new Animated.Value(20)).current;

  // Calculate spotlight dimensions based on current step
  const getSpotlightDimensions = useCallback(() => {
    if (!cardMeasurements) return null;

    if (currentStep === 0) {
      // Step 1: Highlight entire card (exact size, no padding)
      return {
        x: cardMeasurements.x,
        y: cardMeasurements.y,
        width: cardMeasurements.width,
        height: cardMeasurements.height,
        borderRadius: CARD_BORDER_RADIUS,
      };
    } else {
      // Step 2: Highlight heart button (bottom-right of card)
      // Heart button: 40x40, positioned 12px from bottom-right corner
      // actionsContainer is at bottom: 12, right: 12
      // Heart button is in a column with visited button above it (gap: 8)
      const heartSize = 40;
      const actionsOffset = 12; // from bottomRow style
      return {
        x: cardMeasurements.x + cardMeasurements.width - actionsOffset - heartSize,
        y: cardMeasurements.y + cardMeasurements.height - actionsOffset - heartSize,
        width: heartSize,
        height: heartSize,
        borderRadius: HEART_BORDER_RADIUS,
      };
    }
  }, [cardMeasurements, currentStep]);

  const spotlight = getSpotlightDimensions();

  // Animate in when visible
  useEffect(() => {
    if (visible && cardMeasurements) {
      if (reduceMotion) {
        overlayOpacity.setValue(1);
        tooltipOpacity.setValue(1);
        tooltipTranslateY.setValue(0);
      } else {
        Animated.parallel([
          Animated.timing(overlayOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(tooltipOpacity, {
            toValue: 1,
            duration: 300,
            delay: 150,
            useNativeDriver: true,
          }),
          Animated.spring(tooltipTranslateY, {
            toValue: 0,
            friction: 8,
            tension: 40,
            delay: 150,
            useNativeDriver: true,
          }),
        ]).start();
      }
    }
  }, [visible, cardMeasurements, overlayOpacity, tooltipOpacity, tooltipTranslateY, reduceMotion]);

  // Animate tooltip when step changes
  useEffect(() => {
    if (currentStep > 0) {
      if (reduceMotion) {
        tooltipOpacity.setValue(1);
        tooltipTranslateY.setValue(0);
      } else {
        // Quick fade out then in
        Animated.sequence([
          Animated.parallel([
            Animated.timing(tooltipOpacity, {
              toValue: 0,
              duration: 150,
              useNativeDriver: true,
            }),
            Animated.timing(tooltipTranslateY, {
              toValue: -10,
              duration: 150,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(tooltipOpacity, {
              toValue: 1,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.spring(tooltipTranslateY, {
              toValue: 0,
              friction: 8,
              tension: 40,
              useNativeDriver: true,
            }),
          ]),
        ]).start();
      }
    }
  }, [currentStep, tooltipOpacity, tooltipTranslateY, reduceMotion]);

  const handleNext = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (currentStep < TOOLTIP_CONTENT.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      // Complete the tutorial
      if (!reduceMotion) {
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start(() => {
          onComplete();
        });
      } else {
        onComplete();
      }
    }
  }, [currentStep, onComplete, overlayOpacity, reduceMotion]);

  // Calculate tooltip position (below spotlight for card, above for heart)
  const getTooltipPosition = useCallback(() => {
    if (!spotlight) return { top: SCREEN_HEIGHT / 2 };

    if (currentStep === 0) {
      // Position below the card, centered on screen
      return {
        top: spotlight.y + spotlight.height + 24,
      };
    } else {
      // Position above the heart button, centered on screen
      return {
        top: spotlight.y - 120,
      };
    }
  }, [spotlight, currentStep]);

  if (!visible || !cardMeasurements || !spotlight) {
    return null;
  }

  const tooltipPosition = getTooltipPosition();
  const currentTooltip = TOOLTIP_CONTENT[currentStep];

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <View style={styles.container}>
        {/* SVG overlay with spotlight cutout */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: overlayOpacity }]}>
          <Svg width={SCREEN_WIDTH} height={SCREEN_HEIGHT}>
            <Defs>
              <Mask id="spotlight-mask">
                <Rect x="0" y="0" width={SCREEN_WIDTH} height={SCREEN_HEIGHT} fill="white" />
                <Rect
                  x={spotlight.x}
                  y={spotlight.y}
                  width={spotlight.width}
                  height={spotlight.height}
                  rx={spotlight.borderRadius}
                  fill="black"
                />
              </Mask>
            </Defs>
            {/* Dark overlay with cutout */}
            <Rect
              x="0"
              y="0"
              width={SCREEN_WIDTH}
              height={SCREEN_HEIGHT}
              fill="rgba(23, 42, 58, 0.85)"
              mask="url(#spotlight-mask)"
            />
          </Svg>
        </Animated.View>

        {/* Tooltip text and button - centered on screen */}
        <Animated.View
          style={[
            styles.tooltipContainer,
            {
              top: tooltipPosition.top,
              opacity: tooltipOpacity,
              transform: [{ translateY: tooltipTranslateY }],
            },
          ]}
        >
          <Text style={styles.tooltipText}>{currentTooltip.text}</Text>

          <TouchableOpacity
            style={styles.nextButton}
            onPress={handleNext}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={currentStep < TOOLTIP_CONTENT.length - 1 ? 'Next' : 'Done'}
          >
            <Text style={styles.nextButtonText}>
              {currentStep < TOOLTIP_CONTENT.length - 1 ? 'Next' : 'Done'}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tooltipContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  tooltipText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 22,
    lineHeight: 30,
    color: colors.white,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  nextButton: {
    marginTop: 20,
    paddingHorizontal: 32,
    paddingVertical: 12,
    backgroundColor: colors.sunsetGold,
    borderRadius: 24,
  },
  nextButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
});
