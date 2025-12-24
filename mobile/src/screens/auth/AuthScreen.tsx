import { Ionicons } from '@expo/vector-icons';
import { CommonActions } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, GlassBackButton } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useAppleAuthAvailable, useAppleSignIn } from '@hooks/useAppleAuth';
import { useSignInWithPassword } from '@hooks/useAuth';
import { useGoogleAuthAvailable, useGoogleSignIn } from '@hooks/useGoogleAuth';
import type { AuthStackScreenProps } from '@navigation/types';
import { useAuthStore } from '@stores/authStore';
import { validateEmail } from '@utils/emailValidation';

/* eslint-disable @typescript-eslint/no-require-imports */
const atlasLogo = require('../../../assets/atlasi-logo.png');
/* eslint-enable @typescript-eslint/no-require-imports */

type Props = AuthStackScreenProps<'Login'>;

// Minimum password length (Supabase default)
const MIN_PASSWORD_LENGTH = 6;

export function AuthScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const signIn = useSignInWithPassword();
  const appleSignIn = useAppleSignIn();
  const googleSignIn = useGoogleSignIn();
  const isAppleAvailable = useAppleAuthAvailable();
  const isGoogleAvailable = useGoogleAuthAvailable();
  const setHasCompletedOnboarding = useAuthStore((state) => state.setHasCompletedOnboarding);

  const canGoBack = navigation.canGoBack();

  // Check if email is valid to show password field
  const isEmailValid = validateEmail(email).isValid;

  // Handle restart onboarding
  const handleRestartOnboarding = () => {
    setHasCompletedOnboarding(false);
    // Defer navigation reset to next tick to ensure RootNavigator has re-rendered
    // with the Onboarding route available after state change propagates
    setTimeout(() => {
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'Onboarding' }],
        })
      );
    }, 0);
  };

  // Animation values
  const titleAnim = useRef(new Animated.Value(0)).current;
  const accentAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;
  const passwordAnim = useRef(new Animated.Value(0)).current;

  // Run entrance animations
  useEffect(() => {
    // Reset animations
    titleAnim.setValue(0);
    accentAnim.setValue(0);
    contentAnim.setValue(0);
    buttonAnim.setValue(0);

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

  // Animate password field when email becomes valid
  useEffect(() => {
    Animated.timing(passwordAnim, {
      toValue: isEmailValid ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isEmailValid, passwordAnim]);

  // Validate password
  const validatePassword = (pwd: string): { isValid: boolean; error?: string } => {
    if (!pwd) {
      return { isValid: false, error: 'Password is required' };
    }
    if (pwd.length < MIN_PASSWORD_LENGTH) {
      return {
        isValid: false,
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      };
    }
    return { isValid: true };
  };

  // Handle password authentication (sign in)
  const handlePasswordAuth = () => {
    const emailResult = validateEmail(email);
    if (!emailResult.isValid) {
      setEmailError(emailResult.error!);
      return;
    }
    setEmailError('');

    const passwordResult = validatePassword(password);
    if (!passwordResult.isValid) {
      setPasswordError(passwordResult.error!);
      return;
    }
    setPasswordError('');

    const credentials = { email: emailResult.normalizedEmail!, password };
    signIn.mutate(credentials);
  };

  // Handle Apple Sign In
  const handleAppleSignIn = () => {
    appleSignIn.mutate();
  };

  // Handle Google Sign In
  const handleGoogleSignIn = () => {
    googleSignIn.mutate();
  };

  // Animation interpolations
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

  const showSocialButtons = isAppleAvailable || isGoogleAvailable;

  return (
    <SafeAreaView style={styles.container}>
      {/* Back button */}
      {canGoBack && (
        <View style={styles.backButtonContainer}>
          <GlassBackButton onPress={() => navigation.goBack()} />
        </View>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.content}>
            {/* Logo at top */}
            <Animated.View
              style={[
                styles.logoContainer,
                {
                  opacity: titleAnim,
                },
              ]}
            >
              <Image source={atlasLogo} style={styles.logo} resizeMode="contain" />
            </Animated.View>

            {/* Spacer to push content to bottom */}
            <View style={styles.spacer} />

            {/* Title */}
            <Animated.View
              style={{
                opacity: titleAnim,
                transform: [{ translateY: titleTranslateY }],
              }}
            >
              <Text variant="title" style={styles.title}>
                Continue exploring
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
              The world awaits your next adventure
            </Animated.Text>

            {/* Email input - glass style */}
            <Animated.View
              style={{
                opacity: contentAnim,
                transform: [{ translateY: contentTranslateY }],
              }}
            >
              <View style={styles.inputGlassWrapper}>
                <BlurView intensity={60} tint="light" style={styles.inputGlassContainer}>
                  <View style={[styles.inputWrapper, emailError && styles.inputWrapperError]}>
                    <Ionicons
                      name="mail-outline"
                      size={20}
                      color={colors.stormGray}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={styles.glassInput}
                      value={email}
                      onChangeText={(value) => {
                        setEmail(value);
                        if (emailError) setEmailError('');
                      }}
                      placeholder="Email address"
                      placeholderTextColor={colors.stormGray}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="email"
                      textContentType="emailAddress"
                      testID="auth-email-input"
                    />
                    {email.length > 0 && (
                      <TouchableOpacity
                        onPress={() => {
                          setEmail('');
                          if (emailError) setEmailError('');
                        }}
                        style={styles.clearButton}
                      >
                        <Ionicons name="close-circle" size={18} color={colors.stormGray} />
                      </TouchableOpacity>
                    )}
                  </View>
                </BlurView>
              </View>
              {emailError && (
                <Text variant="caption" style={styles.errorText}>
                  {emailError}
                </Text>
              )}

              {/* Password input - only shown when email is valid */}
              {isEmailValid && (
                <Animated.View
                  style={{
                    opacity: passwordAnim,
                    transform: [
                      {
                        translateY: passwordAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [-8, 0],
                        }),
                      },
                    ],
                  }}
                >
                  <View style={styles.inputGlassWrapper}>
                    <BlurView intensity={60} tint="light" style={styles.inputGlassContainer}>
                      <View
                        style={[styles.inputWrapper, passwordError && styles.inputWrapperError]}
                      >
                        <Ionicons
                          name="lock-closed-outline"
                          size={20}
                          color={colors.stormGray}
                          style={styles.inputIcon}
                        />
                        <TextInput
                          style={styles.glassInput}
                          value={password}
                          onChangeText={(value) => {
                            setPassword(value);
                            if (passwordError) setPasswordError('');
                          }}
                          placeholder="Password"
                          placeholderTextColor={colors.stormGray}
                          secureTextEntry={!showPassword}
                          autoCapitalize="none"
                          autoCorrect={false}
                          autoComplete="password"
                          textContentType="password"
                          testID="auth-password-input"
                        />
                        <TouchableOpacity
                          onPress={() => setShowPassword(!showPassword)}
                          style={styles.clearButton}
                        >
                          <Ionicons
                            name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                            size={20}
                            color={colors.stormGray}
                          />
                        </TouchableOpacity>
                      </View>
                    </BlurView>
                  </View>
                  {passwordError && (
                    <Text variant="caption" style={styles.errorText}>
                      {passwordError}
                    </Text>
                  )}
                </Animated.View>
              )}
            </Animated.View>

            {/* Sign In button */}
            <Animated.View
              style={{
                opacity: buttonAnim,
                transform: [{ scale: buttonScale }],
              }}
            >
              <TouchableOpacity
                style={[styles.button, signIn.isPending && styles.buttonDisabled]}
                onPress={handlePasswordAuth}
                activeOpacity={0.9}
                disabled={signIn.isPending}
                accessibilityRole="button"
                accessibilityLabel="Sign In"
                testID="auth-send-button"
              >
                <Text style={styles.buttonText}>
                  {signIn.isPending ? 'Signing in...' : 'Sign In'}
                </Text>
              </TouchableOpacity>
            </Animated.View>

            {/* Social Sign In buttons */}
            {showSocialButtons && (
              <Animated.View
                style={{
                  opacity: buttonAnim,
                }}
              >
                {/* Divider */}
                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>or</Text>
                  <View style={styles.dividerLine} />
                </View>

                {/* Google Sign In Button */}
                {isGoogleAvailable && (
                  <TouchableOpacity
                    style={styles.googleButton}
                    onPress={handleGoogleSignIn}
                    activeOpacity={0.9}
                    disabled={googleSignIn.isPending}
                    accessibilityRole="button"
                    accessibilityLabel="Continue with Google"
                    testID="auth-google-button"
                  >
                    <Ionicons name="logo-google" size={18} color={colors.white} />
                    <Text style={styles.googleButtonText}>
                      {googleSignIn.isPending ? 'Signing in...' : 'Continue with Google'}
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Apple Sign In Button - only shown on iOS */}
                {isAppleAvailable && (
                  <TouchableOpacity
                    style={styles.appleButton}
                    onPress={handleAppleSignIn}
                    activeOpacity={0.9}
                    disabled={appleSignIn.isPending}
                    accessibilityRole="button"
                    accessibilityLabel="Continue with Apple"
                    testID="auth-apple-button"
                  >
                    <Ionicons name="logo-apple" size={18} color={colors.white} />
                    <Text style={styles.appleButtonText}>
                      {appleSignIn.isPending ? 'Signing in...' : 'Continue with Apple'}
                    </Text>
                  </TouchableOpacity>
                )}
              </Animated.View>
            )}

            {/* Start fresh link */}
            <Animated.View
              style={[
                styles.startFreshContainer,
                {
                  opacity: buttonAnim,
                },
              ]}
            >
              <TouchableOpacity
                onPress={handleRestartOnboarding}
                accessibilityRole="button"
                accessibilityLabel="Start fresh with onboarding"
              >
                <Text style={styles.startFreshText}>New here? Start fresh</Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  backButtonContainer: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  logo: {
    width: 180,
    height: 52,
  },
  spacer: {
    flex: 1,
  },
  title: {
    marginBottom: 8,
  },
  accentSubtitle: {
    fontFamily: fonts.dawning.regular,
    fontSize: 24,
    color: colors.adobeBrick,
    marginBottom: 24,
  },
  // Glass input styles
  inputGlassWrapper: {
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 16,
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
  inputWrapperError: {
    borderColor: colors.error,
  },
  inputIcon: {
    marginRight: 12,
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
  button: {
    backgroundColor: colors.sunsetGold,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    marginHorizontal: 16,
    color: colors.textSecondary,
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.adobeBrick,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 10,
    marginBottom: 12,
  },
  googleButtonText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    color: colors.white,
  },
  appleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.midnightNavy,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 10,
  },
  appleButtonText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    color: colors.white,
  },
  startFreshContainer: {
    alignItems: 'center',
    marginTop: 24,
    paddingBottom: 8,
  },
  startFreshText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
});
