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

// ============ LAYOUT CONSTANTS ============
/** Border radius for the tab bar container and inner glass */
const TAB_BAR_BORDER_RADIUS = 24;

/** Blur intensity for the glass effect (0-100) */
const BLUR_INTENSITY = 60;

/** Shadow offset Y for the floating effect */
const SHADOW_OFFSET_Y = 4;

/** Shadow opacity for subtle depth */
const SHADOW_OPACITY = 0.12;

/** Shadow blur radius */
const SHADOW_RADIUS = 16;

/** Android elevation for shadow */
const ELEVATION = 8;

/** Tab icon size in pixels */
const TAB_ICON_SIZE = 38;

/** Opacity for inactive tab icons */
const INACTIVE_TAB_OPACITY = 0.65;

// ============ ANIMATION CONSTANTS ============
/** Scale when tab is pressed down */
const PRESS_SCALE = 0.9;

/** Spring friction for press animation (lower = more bouncy) */
const SPRING_FRICTION = 8;

/** Spring tension for press-in animation (higher = faster) */
const SPRING_TENSION_IN = 400;

/** Spring tension for press-out animation */
const SPRING_TENSION_OUT = 300;

// ============ RESPONSIVE PADDING ============
/** Breakpoint for iPhone SE and smaller */
const SMALL_SCREEN_BREAKPOINT = 375;

/** Breakpoint for iPhone 12/13 mini, iPhone X/XS */
const MEDIUM_SCREEN_BREAKPOINT = 414;

/** Horizontal padding for small screens */
const PADDING_SMALL = 24;

/** Horizontal padding for medium screens */
const PADDING_MEDIUM = 36;

/** Horizontal padding for large screens */
const PADDING_LARGE = 48;

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
      toValue: PRESS_SCALE,
      friction: SPRING_FRICTION,
      tension: SPRING_TENSION_IN,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: SPRING_FRICTION,
      tension: SPRING_TENSION_OUT,
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
    if (width < SMALL_SCREEN_BREAKPOINT) return PADDING_SMALL;
    if (width < MEDIUM_SCREEN_BREAKPOINT) return PADDING_MEDIUM;
    return PADDING_LARGE;
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
        <BlurView intensity={BLUR_INTENSITY} tint="light" style={styles.glassContainer}>
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
    borderRadius: TAB_BAR_BORDER_RADIUS,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: SHADOW_OFFSET_Y },
    shadowOpacity: SHADOW_OPACITY,
    shadowRadius: SHADOW_RADIUS,
    elevation: ELEVATION,
  },
  glassContainer: {
    borderRadius: TAB_BAR_BORDER_RADIUS,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  innerGlass: {
    borderRadius: TAB_BAR_BORDER_RADIUS,
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
    width: TAB_ICON_SIZE,
    height: TAB_ICON_SIZE,
  },
  tabIconInactive: {
    opacity: INACTIVE_TAB_OPACITY,
  },
});

export default LiquidGlassTabBar;
