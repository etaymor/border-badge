/**
 * ClipboardBanner - Floating banner that appears when a TikTok/Instagram URL is detected.
 *
 * Shows a non-blocking prompt at the top of the screen with options to:
 * - Save the place from the detected URL
 * - Dismiss the banner
 */

import { useCallback, useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import type { SocialProvider } from '../../types/shared';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface ClipboardBannerProps {
  provider: SocialProvider;
  onSave: () => void;
  onDismiss: () => void;
}

const PROVIDER_CONFIG = {
  tiktok: {
    icon: 'musical-notes' as const,
    label: 'TikTok',
    color: '#000000',
    subtitle: 'We detected a TikTok link',
  },
  instagram: {
    icon: 'logo-instagram' as const,
    label: 'Instagram',
    color: '#C13584', // Instagram gradient purple-pink
    subtitle: 'We detected an Instagram link',
  },
};

function ClipboardBanner({ provider, onSave, onDismiss }: ClipboardBannerProps) {
  const insets = useSafeAreaInsets();
  const config = PROVIDER_CONFIG[provider];

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

  const handleSave = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSave();
  }, [onSave]);

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
        {/* Provider Icon */}
        <View style={[styles.iconContainer, { backgroundColor: config.color }]}>
          <Ionicons name={config.icon} size={16} color={colors.white} />
        </View>

        {/* Message */}
        <View style={styles.content}>
          <Text style={styles.title}>Save {config.label} place?</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {config.subtitle}
          </Text>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.saveButton}
            onPress={handleSave}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Save place from clipboard"
          >
            <Text style={styles.saveButtonText}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.dismissButton}
            onPress={handleDismiss}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Dismiss clipboard prompt"
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
  saveButton: {
    backgroundColor: colors.sunsetGold,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 13,
    color: colors.midnightNavy,
  },
  dismissButton: {
    padding: 8,
  },
});

export default ClipboardBanner;
