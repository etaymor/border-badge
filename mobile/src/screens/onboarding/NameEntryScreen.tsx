import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useEffect, useState } from 'react';
import {
  Animated,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useScreenEntrance } from '@hooks/useScreenEntrance';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { Analytics } from '@services/analytics';
import { useOnboardingStore } from '@stores/onboardingStore';
import { validateDisplayName } from '@utils/displayNameValidation';

/* eslint-disable @typescript-eslint/no-require-imports */
const atlasLogo = require('../../../assets/atlasi-logo.png');
/* eslint-enable @typescript-eslint/no-require-imports */

type Props = OnboardingStackScreenProps<'NameEntry'>;

export function NameEntryScreen({ navigation }: Props) {
  const { displayName, setDisplayName } = useOnboardingStore();
  const [name, setName] = useState(displayName ?? '');
  const [error, setError] = useState('');

  // Premium entrance animation
  const { getAnimatedStyle, getButtonStyle } = useScreenEntrance({ elementCount: 4 });

  // Track screen view
  useEffect(() => {
    Analytics.viewOnboardingName();
  }, []);

  const handleContinue = () => {
    const validation = validateDisplayName(name);

    if (!validation.isValid) {
      setError(validation.error ?? '');
      return;
    }

    setError('');
    // Store the display name
    setDisplayName(validation.trimmedValue);

    // Dismiss keyboard immediately before navigating
    Keyboard.dismiss();

    // Navigate to value proposition screens before paywall
    navigation.navigate('EmotionalHook');
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        {/* Header with logo */}
        <View style={styles.headerRow}>
          <Image source={atlasLogo} style={styles.logo} resizeMode="contain" />
        </View>

        <View style={styles.content}>
          {/* Title */}
          <Animated.View style={getAnimatedStyle(0)}>
            <Text variant="title" style={styles.title}>
              What should we call you?
            </Text>
          </Animated.View>

          {/* Accent subtitle */}
          <Animated.View style={getAnimatedStyle(1)}>
            <Text style={styles.accentSubtitle}>Your adventure awaits</Text>
          </Animated.View>

          {/* Input section - Liquid Glass Style */}
          <Animated.View style={getAnimatedStyle(2)}>
            <View style={styles.inputGlassWrapper}>
              <BlurView intensity={60} tint="light" style={styles.inputGlassContainer}>
                <View style={[styles.inputWrapper, error && styles.inputWrapperError]}>
                  <TextInput
                    style={styles.glassInput}
                    value={name}
                    onChangeText={(text) => {
                      setName(text);
                      if (error) setError('');
                    }}
                    placeholder="Your Name"
                    placeholderTextColor={colors.stormGray}
                    autoCapitalize="words"
                    autoComplete="name"
                    autoFocus
                    testID="name-entry-input"
                  />
                  {name.length > 0 && (
                    <TouchableOpacity
                      onPress={() => {
                        setName('');
                        if (error) setError('');
                      }}
                      style={styles.clearButton}
                    >
                      <Ionicons name="close-circle" size={20} color={colors.stormGray} />
                    </TouchableOpacity>
                  )}
                </View>
              </BlurView>
            </View>
            {error && (
              <Text variant="caption" style={styles.errorText}>
                {error}
              </Text>
            )}
            <Text variant="caption" style={styles.helperText}>
              This is how you&apos;ll appear to friends
            </Text>
          </Animated.View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Animated.View style={[{ width: '100%' }, getButtonStyle(3)]}>
            <TouchableOpacity
              style={styles.continueButton}
              onPress={handleContinue}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel="Continue to next step"
              testID="name-entry-continue"
            >
              <Text style={styles.continueButtonText}>Continue</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  keyboardView: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  logo: {
    width: 140,
    height: 40,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  title: {
    marginBottom: 8,
  },
  accentSubtitle: {
    fontFamily: fonts.dawning.regular,
    fontSize: 24,
    color: colors.adobeBrick,
    marginBottom: 32,
  },
  inputGlassWrapper: {
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 12,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  inputGlassContainer: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 48,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    backgroundColor: 'transparent',
  },
  inputWrapperError: {
    borderColor: colors.error,
  },
  glassInput: {
    flex: 1,
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  clearButton: {
    padding: 4,
  },
  errorText: {
    color: colors.error,
    marginTop: 4,
    marginBottom: 8,
    marginLeft: 4,
  },
  helperText: {
    color: colors.textSecondary,
    marginLeft: 4,
  },
  footer: {
    paddingHorizontal: 24,
    paddingVertical: 24,
    alignItems: 'center',
  },
  continueButton: {
    backgroundColor: colors.sunsetGold,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  continueButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
});
