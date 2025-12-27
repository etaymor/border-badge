/**
 * ClipboardPermissionBanner - Banner shown when clipboard access is denied.
 *
 * Shows a non-blocking prompt at the top of the screen with options to:
 * - Open iOS Settings to enable clipboard permission
 * - Dismiss the banner
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Linking,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface ClipboardPermissionBannerProps {
  onOpenSettings: () => void;
  onDismiss: () => void;
}

/** Opens the app's Settings page in iOS Settings app */
function openAppSettings() {
  if (Platform.OS === 'ios') {
    Linking.openURL('app-settings:');
  }
}

function ClipboardPermissionBanner({ onOpenSettings, onDismiss }: ClipboardPermissionBannerProps) {
  const insets = useSafeAreaInsets();

  // Animation values
  const translateY = useRef(new Animated.Value(-100)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  // Animate in on mount
  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 12,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [translateY, opacity]);

  const handleOpenSettings = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    openAppSettings();
    onOpenSettings();
  }, [onOpenSettings]);

  const handleDismiss = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Animate out then dismiss
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -100,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss();
    });
  }, [onDismiss, translateY, opacity]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          top: insets.top + 8,
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      <View style={styles.banner}>
        {/* Icon */}
        <View style={styles.iconContainer}>
          <Ionicons name="clipboard-outline" size={16} color={colors.cloudWhite} />
        </View>

        {/* Message */}
        <View style={styles.content}>
          <Text style={styles.title}>Permission Needed</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            Enable clipboard to detect links
          </Text>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={handleOpenSettings}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Open iOS Settings"
          >
            <Text style={styles.settingsButtonText}>Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.dismissButton}
            onPress={handleDismiss}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Dismiss permission prompt"
          >
            <Ionicons name="close" size={20} color={colors.stormGray} />
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cloudWhite,
    borderRadius: 16,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 8,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    gap: 10,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.adobeBrick,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
  },
  subtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.stormGray,
    marginTop: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  settingsButton: {
    backgroundColor: colors.sunsetGold,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  settingsButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 13,
    color: colors.midnightNavy,
  },
  dismissButton: {
    padding: 8,
  },
});

export default ClipboardPermissionBanner;
