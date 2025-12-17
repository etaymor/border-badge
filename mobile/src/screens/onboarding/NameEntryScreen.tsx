import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OnboardingInput } from '@components/onboarding';
import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { OnboardingStackScreenProps } from '@navigation/types';
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

  // Animation values
  const titleAnim = useRef(new Animated.Value(0)).current;
  const accentAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;

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
    const validation = validateDisplayName(name);

    if (!validation.isValid) {
      setError(validation.error ?? '');
      return;
    }

    setError('');
    // Store the display name
    setDisplayName(validation.trimmedValue);

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
              What should we call you?
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
            ~ your adventure awaits ~
          </Animated.Text>

          {/* Input section */}
          <Animated.View
            style={{
              opacity: contentAnim,
              transform: [{ translateY: contentTranslateY }],
            }}
          >
            <OnboardingInput
              value={name}
              onChangeText={(text) => {
                setName(text);
                if (error) setError('');
              }}
              placeholder="Your Name"
              autoCapitalize="words"
              autoComplete="name"
              autoFocus
              error={error}
              containerStyle={styles.input}
              testID="name-entry-input"
            />
            <Text variant="caption" style={styles.helperText}>
              This is how you&apos;ll appear to friends
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
    fontSize: 18,
    color: colors.adobeBrick,
    marginBottom: 32,
  },
  input: {
    marginBottom: 12,
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
