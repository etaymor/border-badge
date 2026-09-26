import { StyleSheet, View } from 'react-native';

import { colors } from '@constants/colors';

interface IntroCheckProps {
  /** Box size in points; the mark scales with it. */
  size?: number;
  color?: string;
  testID?: string;
}

/** A check mark drawn from two rotated bars (same idea as the permission badges). */
export default function IntroCheck({ size = 24, color = colors.white, testID }: IntroCheckProps) {
  const k = size / 24;
  const thickness = 2.5 * k;
  return (
    <View style={{ width: size, height: size }} testID={testID}>
      <View
        style={[
          styles.bar,
          {
            left: 6.5 * k,
            top: 12 * k,
            width: 6 * k,
            height: thickness,
            backgroundColor: color,
            transform: [{ rotate: '45deg' }],
          },
        ]}
      />
      <View
        style={[
          styles.bar,
          {
            left: 9.5 * k,
            top: 10 * k,
            width: 10 * k,
            height: thickness,
            backgroundColor: color,
            transform: [{ rotate: '-48deg' }],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    borderRadius: 2,
  },
});
