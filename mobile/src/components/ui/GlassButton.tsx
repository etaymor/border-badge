import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

type IoniconsName = keyof typeof Ionicons.glyphMap;

interface GlassButtonProps {
  title: string;
  onPress: () => void;
  icon?: IoniconsName;
  disabled?: boolean;
  style?: ViewStyle;
  testID?: string;
}

export function GlassButton({ title, onPress, icon, disabled, style, testID }: GlassButtonProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.97, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  return (
    <Animated.View style={[animatedStyle, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        testID={testID}
        accessibilityRole="button"
        style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
      >
        <View style={styles.wrapper}>
          <BlurView intensity={30} tint="light" style={styles.glass}>
            {icon && (
              <Ionicons name={icon} size={18} color={colors.midnightNavy} style={styles.icon} />
            )}
            <Text style={styles.text}>{title}</Text>
          </BlurView>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pressable: {},
  pressed: {
    opacity: 0.8,
  },
  wrapper: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  glass: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 44,
  },
  icon: {
    marginRight: 6,
  },
  text: {
    fontSize: 16,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
  },
});
