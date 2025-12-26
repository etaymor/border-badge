import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
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
import type { OnboardingStackScreenProps } from '@navigation/types';
import { Analytics } from '@services/analytics';
import { useOnboardingStore } from '@stores/onboardingStore';
import {
  generateUsernameFromName,
  validateUsername,
} from '@utils/usernameValidation';

/* eslint-disable @typescript-eslint/no-require-imports */
const atlasLogo = require('../../../assets/atlasi-logo.png');
/* eslint-enable @typescript-eslint/no-require-imports */

type Props = OnboardingStackScreenProps<'NameEntry'>;

export function NameEntryScreen({ navigation }: Props) {
  const { username, setUsername, displayName, setDisplayName } = useOnboardingStore();
  const [usernameInput, setUsernameInput] = useState(username ?? '');
  const [error, setError] = useState('');

  // Generate username suggestion from display name if we have one
  useEffect(() => {
    if (!usernameInput && displayName) {
      const suggested = generateUsernameFromName(displayName);
      setUsernameInput(suggested);
    }
  }, [displayName, usernameInput]);

  // Animation values
  const titleAnim = useRef(new Animated.Value(0)).current;
  const accentAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;

  // Track screen view
  useEffect(() => {
    Analytics.viewOnboardingName();
  }, []);

  // Run entrance animations
  useEffect(() => {
    Animated.stagger(100, [
      Animated.timing(titleAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(accentAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(contentAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.spring(buttonAnim, {
        toValue: 1,
        friction: 8,
        tension: 60,
        useNativeDriver: true,
      }),
    ]).start();
  }, [titleAnim, accentAnim, contentAnim, buttonAnim]);

  const handleContinue = () => {
    const validation = validateUsername(usernameInput);

    if (!validation.isValid) {
      setError(validation.error ?? '');
      return;
    }

    setError('');
    // Store the username (also used as display name if not separately set)
    setUsername(validation.value);
    if (!displayName) {
      setDisplayName(validation.value);
    }

    // Navigate to account creation
    navigation.navigate('AccountCreation');
  };

  const titleTranslateY = titleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [15, 0],
  });

  const accentTranslateY = accentAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
  });

  const contentTranslateY = contentAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
  });

  const buttonScale = buttonAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1],
  });

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
          <Animated.View
            style={{
              opacity: titleAnim,
              transform: [{ translateY: titleTranslateY }],
            }}
          >
            <Text variant="title" style={styles.title}>
              Choose your username
            </Text>
          </Animated.View>

          {/* Accent subtitle */}
          <Animated.Text
            style={[
              styles.accentSubtitle,
              {
                opacity: accentAnim,
                transform: [{ translateY: accentTranslateY }],
              },
            ]}
          >
            How friends will find you
          </Animated.Text>

          {/* Input section - Liquid Glass Style */}
          <Animated.View
            style={{
              opacity: contentAnim,
              transform: [{ translateY: contentTranslateY }],
            }}
          >
            <View style={styles.inputGlassWrapper}>
              <BlurView intensity={60} tint="light" style={styles.inputGlassContainer}>
                <View style={[styles.inputWrapper, error && styles.inputWrapperError]}>
                  <Text style={styles.atSymbol}>@</Text>
                  <TextInput
                    style={styles.glassInput}
                    value={usernameInput}
                    onChangeText={(text) => {
                      // Remove spaces and special characters as user types
                      const cleaned = text.replace(/[^a-zA-Z0-9_]/g, '');
                      setUsernameInput(cleaned);
                      if (error) setError('');
                    }}
                    placeholder="username"
                    placeholderTextColor={colors.stormGray}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="username"
                    autoFocus
                    testID="username-entry-input"
                  />
                  {usernameInput.length > 0 && (
                    <TouchableOpacity
                      onPress={() => {
                        setUsernameInput('');
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
              Letters, numbers, and underscores only
            </Text>
          </Animated.View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Animated.View
            style={{
              opacity: buttonAnim,
              transform: [{ scale: buttonScale }],
              width: '100%',
            }}
          >
            <TouchableOpacity
              style={styles.continueButton}
              onPress={handleContinue}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel="Continue to next step"
              testID="username-entry-continue"
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
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 12,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  inputGlassContainer: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    backgroundColor: 'transparent',
  },
  atSymbol: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.stormGray,
    marginRight: 2,
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
    borderRadius: 12,
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
