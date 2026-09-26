import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, {
  interpolate,
  Extrapolation,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { counterValueAt } from './introMotion';

/** 0-9 then 0 again, so the ones column rolls smoothly past 9. */
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

interface RollingCounterProps {
  clock: SharedValue<number>;
  /** Final value (0-99). */
  target: number;
  lineHeight: number;
  textStyle: TextStyle;
  testID?: string;
}

interface DigitColumnProps {
  clock: SharedValue<number>;
  target: number;
  place: 'tens' | 'ones';
  lineHeight: number;
  textStyle: TextStyle;
}

function DigitColumn({ clock, target, place, lineHeight, textStyle }: DigitColumnProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const v = counterValueAt(clock.value, target);
    const ones = v % 10;
    // The tens column only turns while the ones column rolls from 9 to 0.
    const position = place === 'ones' ? ones : Math.floor(v / 10) + Math.max(0, ones - 9);
    return {
      transform: [{ translateY: -position * lineHeight }],
      // Hide the leading zero until the count reaches ten.
      opacity: place === 'tens' ? interpolate(v, [8.5, 10], [0, 1], Extrapolation.CLAMP) : 1,
    };
  });

  return (
    <View style={[styles.column, { height: lineHeight }]}>
      <Animated.View style={animatedStyle}>
        {DIGITS.map((digit, index) => (
          <Text key={index} style={[textStyle, { lineHeight, height: lineHeight }]}>
            {digit}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

/**
 * An odometer made only of transforms: each digit column is a clipped static
 * stack of numerals translated on the UI thread. No per-frame setState and no
 * animated text props. Reads its final value when the clock is still.
 */
export default function RollingCounter({
  clock,
  target,
  lineHeight,
  textStyle,
  testID,
}: RollingCounterProps) {
  return (
    <View style={styles.row} accessible accessibilityLabel={String(target)} testID={testID}>
      {target >= 10 ? (
        <DigitColumn
          clock={clock}
          target={target}
          place="tens"
          lineHeight={lineHeight}
          textStyle={textStyle}
        />
      ) : null}
      <DigitColumn
        clock={clock}
        target={target}
        place="ones"
        lineHeight={lineHeight}
        textStyle={textStyle}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  column: {
    overflow: 'hidden',
  },
});
