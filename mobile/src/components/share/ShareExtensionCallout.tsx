/**
 * ShareExtensionCallout - Promotional callout for share extension feature
 *
 * Displays a small callout at the bottom of trip screens to educate users
 * about saving content from TikTok and Instagram via the share extension.
 *
 * Only shown on iOS (share extension is iOS-only) and only until the user
 * has used the feature or dismissed it for the current session.
 */

import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { selectShouldShowShareExtensionTutorial, useSettingsStore } from '@stores/settingsStore';

interface ShareExtensionCalloutProps {
  onLearnMore: () => void;
}

export function ShareExtensionCallout({ onLearnMore }: ShareExtensionCalloutProps) {
  const shouldShow = useSettingsStore(selectShouldShowShareExtensionTutorial);
  const dismissTutorial = useSettingsStore((s) => s.dismissShareExtensionTutorial);

  const handleDismiss = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    dismissTutorial();
  }, [dismissTutorial]);

  const handleLearnMore = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onLearnMore();
  }, [onLearnMore]);

  // Don't show on Android (share extension is iOS-only)
  if (Platform.OS !== 'ios') return null;

  // Don't show if user has used share extension or dismissed in this session
  if (!shouldShow) return null;

  return (
    <Pressable
      style={styles.container}
      onPress={handleLearnMore}
      accessibilityRole="button"
      accessibilityLabel="Learn how to save from TikTok and Instagram"
    >
      {/* Dismiss button - on the left */}
      <Pressable
        style={styles.dismissButton}
        onPress={handleDismiss}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      >
        <BlurView intensity={40} tint="light" style={styles.blurContent}>
          <Ionicons name="close" size={18} color={colors.stormGray} />
        </BlurView>
      </Pressable>

      {/* Text content - left aligned */}
      <View style={styles.textContainer}>
        <Text style={styles.title}>Need Inspiration?</Text>
        <Text style={styles.subtitle}>
          Save ideas from TikTok and Instagram directly to your trips.
        </Text>
      </View>

      {/* Question icon */}
      <View style={styles.questionButton}>
        <BlurView intensity={40} tint="light" style={styles.blurContent}>
          <Ionicons name="help" size={20} color={colors.midnightNavy} />
        </BlurView>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.paperBeige,
    borderRadius: 20,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 24,
    marginBottom: 8,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  textContainer: {
    flex: 1,
    marginHorizontal: 12,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 17,
    color: colors.midnightNavy,
    marginBottom: 2,
  },
  subtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
    lineHeight: 18,
  },
  questionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  dismissButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  blurContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
