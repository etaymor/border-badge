import { StyleSheet, View } from 'react-native';

import { colors } from '@constants/colors';

interface IntroPinProps {
  /** Head diameter in points. */
  size?: number;
  testID?: string;
}

/**
 * A map pin drawn from Views: a gold head with a navy eye on a rotated square
 * tail. No icon library. The tip sits at the bottom centre of the box.
 */
export default function IntroPin({ size = 26, testID }: IntroPinProps) {
  const tail = size * 0.62;
  return (
    <View style={{ width: size, height: size * 1.34 }} testID={testID}>
      <View
        style={[
          styles.tail,
          {
            width: tail,
            height: tail,
            left: (size - tail) / 2,
            top: size - tail * 0.78,
          },
        ]}
      />
      <View style={[styles.head, { width: size, height: size, borderRadius: size / 2 }]}>
        <View
          style={[
            styles.eye,
            { width: size * 0.36, height: size * 0.36, borderRadius: size * 0.18 },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: colors.adobeBrick,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eye: {
    backgroundColor: colors.warmCream,
  },
  tail: {
    position: 'absolute',
    backgroundColor: colors.adobeBrick,
    borderBottomRightRadius: 3,
    transform: [{ rotate: '45deg' }],
  },
});
