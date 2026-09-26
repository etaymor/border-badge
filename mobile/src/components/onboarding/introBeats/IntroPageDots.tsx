import { StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { colors } from '@constants/colors';

const DOT = 8;
const DOT_ACTIVE = 24;

interface DotProps {
  index: number;
  scrollX: SharedValue<number>;
  pageWidth: number;
}

function Dot({ index, scrollX, pageWidth }: DotProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const range = [(index - 1) * pageWidth, index * pageWidth, (index + 1) * pageWidth];
    return {
      width: interpolate(scrollX.value, range, [DOT, DOT_ACTIVE, DOT], Extrapolation.CLAMP),
      opacity: interpolate(scrollX.value, range, [0.3, 1, 0.3], Extrapolation.CLAMP),
    };
  });
  return <Animated.View style={[styles.dot, animatedStyle]} />;
}

interface IntroPageDotsProps {
  count: number;
  scrollX: SharedValue<number>;
  pageWidth: number;
}

/** Page dots that stretch with the finger. Hidden from VoiceOver (steps are announced). */
export default function IntroPageDots({ count, scrollX, pageWidth }: IntroPageDotsProps) {
  return (
    <View
      style={styles.row}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      testID="intro-page-dots"
    >
      {Array.from({ length: count }, (_, index) => (
        <Dot key={index} index={index} scrollX={scrollX} pageWidth={pageWidth} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    height: DOT,
  },
  dot: {
    height: DOT,
    width: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.midnightNavy,
  },
});
