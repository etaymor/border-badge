import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { Text } from './Text';

interface SegmentedTabsProps {
  tabs: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  testID?: string;
}

interface TabItemProps {
  label: string;
  isSelected: boolean;
  onPress: () => void;
  isFirst: boolean;
  isLast: boolean;
}

function TabItem({ label, isSelected, onPress, isFirst, isLast }: TabItemProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 5,
      tension: 40,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View
      style={[
        styles.tabItemWrapper,
        { transform: [{ scale: scaleAnim }] },
        isFirst && styles.tabItemFirst,
        isLast && styles.tabItemLast,
      ]}
    >
      <Pressable
        style={[styles.tabItem, isSelected && styles.tabItemSelected]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityState={{ selected: isSelected }}
      >
        <Text variant="label" style={[styles.tabText, isSelected && styles.tabTextSelected]}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export function SegmentedTabs({ tabs, selectedIndex, onSelect, testID }: SegmentedTabsProps) {
  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.glassWrapper}>
        <BlurView intensity={60} tint="light" style={styles.glassContainer}>
          <View style={styles.tabsRow}>
            {tabs.map((tab, index) => (
              <TabItem
                key={tab}
                label={tab}
                isSelected={index === selectedIndex}
                onPress={() => onSelect(index)}
                isFirst={index === 0}
                isLast={index === tabs.length - 1}
              />
            ))}
          </View>
        </BlurView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  glassWrapper: {
    borderRadius: 28,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  glassContainer: {
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  tabsRow: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.7)',
    backgroundColor: 'rgba(253, 246, 237, 0.2)',
  },
  tabItemWrapper: {
    flex: 1,
  },
  tabItemFirst: {
    marginRight: 2,
  },
  tabItemLast: {
    marginLeft: 2,
  },
  tabItem: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabItemSelected: {
    backgroundColor: colors.adobeBrick,
  },
  tabText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
  },
  tabTextSelected: {
    color: colors.white,
  },
});
