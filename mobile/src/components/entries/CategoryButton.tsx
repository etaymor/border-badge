/**
 * CategoryButton - Animated button for selecting entry type categories.
 * Features entrance animation with stagger effect and press scaling.
 */

import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, withAlpha } from '@constants/colors';
import type { EntryTypeConfig } from '@constants/entryTypes';
import { fonts } from '@constants/typography';

export interface CategoryButtonProps {
  item: EntryTypeConfig;
  isSelected: boolean;
  onPress: () => void;
  /** Index for stagger entrance animation */
  index: number;
}

export function CategoryButton({ item, isSelected, onPress, index }: CategoryButtonProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Stagger entrance animation
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      delay: index * 80,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim, index]);

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      tension: 100,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View
      style={[
        styles.categoryButtonWrapper,
        {
          opacity: fadeAnim,
          transform: [
            { scale: scaleAnim },
            {
              translateY: fadeAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [20, 0],
              }),
            },
          ],
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        testID={`entry-type-${item.type}`}
      >
        <View style={styles.categoryButtonOuter}>
          <BlurView
            intensity={isSelected ? 50 : 30}
            tint="light"
            style={[
              styles.categoryButton,
              isSelected && {
                backgroundColor: withAlpha(item.color, 0.08),
              },
            ]}
          >
            <View
              style={[
                styles.categoryIconContainer,
                isSelected && { backgroundColor: withAlpha(item.color, 0.13) },
              ]}
            >
              <Ionicons
                name={item.icon}
                size={22}
                color={isSelected ? item.color : colors.textSecondary}
              />
            </View>
            <Text
              style={[
                styles.categoryLabel,
                isSelected && { color: item.color, fontFamily: fonts.openSans.semiBold },
              ]}
            >
              {item.label}
            </Text>
            {isSelected && (
              <View style={[styles.selectedIndicator, { backgroundColor: item.color }]} />
            )}
          </BlurView>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  categoryButtonWrapper: {
    width: '47%',
    flexGrow: 1,
  },
  categoryButtonOuter: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  categoryButton: {
    paddingVertical: 18,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    alignItems: 'center',
    gap: 10,
  },
  categoryIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryLabel: {
    fontSize: 14,
    color: colors.textSecondary,
    fontFamily: fonts.openSans.regular,
    textAlign: 'center',
  },
  selectedIndicator: {
    position: 'absolute',
    bottom: 0,
    left: '25%',
    right: '25%',
    height: 3,
    borderRadius: 2,
  },
});
