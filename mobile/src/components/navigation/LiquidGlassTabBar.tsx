import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Image,
  ImageSourcePropType,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@constants/colors';

// Tab icon assets
import navIconGlobe from '../../../assets/nav-icons/nav_icon_globe.png';
import navIconHotair from '../../../assets/nav-icons/nav_icon_hotair.png';
import navIconBook from '../../../assets/nav-icons/nav_icon_book.png';
import navIconFriend from '../../../assets/nav-icons/nav_icon_friend.png';

const TAB_ICONS: Record<string, ImageSourcePropType> = {
  Passport: navIconGlobe,
  Dreams: navIconHotair,
  Trips: navIconBook,
  Friends: navIconFriend,
};

// Default fallback icon if route name not found
const FALLBACK_TAB_ICON: ImageSourcePropType = navIconGlobe;

// Tab labels for accessibility
const TAB_LABELS: Record<string, string> = {
  Passport: 'Passport',
  Dreams: 'Dreams',
  Trips: 'Trips',
  Friends: 'Friends',
};

interface TabItemProps {
  route: string;
  label: string; // Used for accessibility
  isFocused: boolean;
  onPress: () => void;
  onLongPress: () => void;
  icon: ImageSourcePropType;
}

function TabItem({ route, label, isFocused, onPress, onLongPress, icon }: TabItemProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  // Cleanup: stop any running animation and reset value on unmount
  useEffect(() => {
    return () => {
      scaleAnim.stopAnimation();
      scaleAnim.setValue(1);
    };
  }, [scaleAnim]);

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 0.9,
      friction: 8,
      tension: 400,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 8,
      tension: 300,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [onPress]);

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
      accessibilityLabel={`${label} tab`}
      testID={`tab-${route.toLowerCase()}`}
      onPress={handlePress}
      onLongPress={onLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={styles.tabItem}
      activeOpacity={1}
    >
      <Animated.View style={[styles.tabContent, { transform: [{ scale: scaleAnim }] }]}>
        {/* Icon only - no labels */}
        <Image
          source={icon}
          style={[styles.tabIcon, !isFocused && styles.tabIconInactive]}
          resizeMode="contain"
        />
      </Animated.View>
    </TouchableOpacity>
  );
}

function LiquidGlassTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // Responsive horizontal padding based on screen width
  const horizontalPadding = useMemo(() => {
    if (width < 375) return 24; // iPhone SE and smaller
    if (width < 414) return 36; // iPhone 12/13 mini, iPhone X/XS
    return 48; // iPhone Plus/Max sizes and larger
  }, [width]);

  // Check if tab bar should be hidden based on current route's tabBarStyle
  const focusedRoute = state.routes[state.index];
  const focusedDescriptor = descriptors[focusedRoute.key];
  const tabBarStyle = focusedDescriptor.options.tabBarStyle as { display?: string } | undefined;

  if (tabBarStyle?.display === 'none') {
    return null;
  }

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: insets.bottom || 8, paddingHorizontal: horizontalPadding },
      ]}
    >
      {/* Outer shadow layer */}
      <View style={styles.shadowLayer}>
        {/* Main glass container */}
        <BlurView intensity={60} tint="light" style={styles.glassContainer}>
          {/* Inner glass highlight border */}
          <View style={styles.innerGlass}>
            {/* Tab items */}
            <View style={styles.tabsRow}>
              {state.routes.map((route, index) => {
                const { options } = descriptors[route.key];
                const isFocused = state.index === index;

                const onPress = () => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });

                  if (!isFocused && !event.defaultPrevented) {
                    navigation.navigate(route.name, route.params);
                  }
                };

                const onLongPress = () => {
                  navigation.emit({
                    type: 'tabLongPress',
                    target: route.key,
                  });
                };

                const icon = TAB_ICONS[route.name] ?? FALLBACK_TAB_ICON;
                const label = TAB_LABELS[route.name] || options.title || route.name;

                return (
                  <TabItem
                    key={route.key}
                    route={route.name}
                    label={label}
                    isFocused={isFocused}
                    onPress={onPress}
                    onLongPress={onLongPress}
                    icon={icon}
                  />
                );
              })}
            </View>
          </View>
        </BlurView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    // paddingHorizontal is set dynamically based on screen width
  },
  shadowLayer: {
    borderRadius: 24,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  glassContainer: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  innerGlass: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    backgroundColor: 'rgba(253, 246, 237, 0.5)', // Warm cream tint
    overflow: 'hidden',
  },
  tabsRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  tabContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIcon: {
    width: 38,
    height: 38,
  },
  tabIconInactive: {
    opacity: 0.65,
  },
});

export default LiquidGlassTabBar;
