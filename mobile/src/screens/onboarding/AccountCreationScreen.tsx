import { Ionicons } from '@expo/vector-icons';
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

import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useAppleAuthAvailable, useAppleSignIn } from '@hooks/useAppleAuth';
import { useSendMagicLink } from '@hooks/useAuth';
import { useGoogleAuthAvailable, useGoogleSignIn } from '@hooks/useGoogleAuth';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { Analytics } from '@services/analytics';
import { useOnboardingStore } from '@stores/onboardingStore';
import { validateEmail } from '@utils/emailValidation';

/* eslint-disable @typescript-eslint/no-require-imports */
const atlasLogo = require('../../../assets/atlasi-logo.png');
/* eslint-enable @typescript-eslint/no-require-imports */

type Props = OnboardingStackScreenProps<'AccountCreation'>;

type AuthStep = 'email' | 'check_email';

// Cooldown for resending magic link (in seconds)
const RESEND_COOLDOWN_SECONDS = 60;

export function AccountCreationScreen({ navigation }: Props) {
  const [step, setStep] = useState<AuthStep>('email');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [magicLinkSentAt, setMagicLinkSentAt] = useState<number | undefined>();
  const [resendCountdown, setResendCountdown] = useState(0);

  const { displayName } = useOnboardingStore();

  // Track screen view
  useEffect(() => {
    Analytics.viewOnboardingAccount();
  }, []);

  const sendMagicLink = useSendMagicLink();
  const appleSignIn = useAppleSignIn();
  const googleSignIn = useGoogleSignIn();
  const isAppleAvailable = useAppleAuthAvailable();
  const isGoogleAvailable = useGoogleAuthAvailable();

  // Resend countdown timer
  useEffect(() => {
    if (magicLinkSentAt) {
      const elapsed = Math.floor((Date.now() - magicLinkSentAt) / 1000);
      const remaining = Math.max(0, RESEND_COOLDOWN_SECONDS - elapsed);
      setResendCountdown(remaining);

      if (remaining > 0) {
        const interval = setInterval(() => {
          setResendCountdown((prev) => {
            if (prev <= 1) {
              clearInterval(interval);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
        return () => clearInterval(interval);
      }
    }
  }, [magicLinkSentAt]);

  // Animation values for email step
  const titleAnim = useRef(new Animated.Value(0)).current;
  const accentAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;

  // Animation values for check email step
  const checkEmailAnim = useRef(new Animated.Value(0)).current;

  // Run entrance animations
  useEffect(() => {
    if (step === 'email') {
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
    } else {
      // Check email step - minimal fade in
      checkEmailAnim.setValue(0);
      Animated.timing(checkEmailAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [step, titleAnim, accentAnim, contentAnim, buttonAnim, checkEmailAnim]);

  // Handle sending magic link
  const handleSendMagicLink = () => {
    const result = validateEmail(email);
    if (!result.isValid) {
      setEmailError(result.error!);
      return;
    }
    setEmailError('');

    sendMagicLink.mutate(
      { email: result.normalizedEmail!, displayName: displayName ?? undefined },
      {
        onSuccess: () => {
          setMagicLinkSentAt(Date.now());
          setStep('check_email');
        },
      }
    );
  };

  // Handle resend magic link
  const handleResendMagicLink = () => {
    if (resendCountdown > 0) return;

    const result = validateEmail(email);
    if (!result.isValid) return;

    sendMagicLink.mutate(
      { email: result.normalizedEmail!, displayName: displayName ?? undefined },
      {
        onSuccess: () => {
          setMagicLinkSentAt(Date.now());
        },
      }
    );
  };

  // Handle back to email entry
  const handleBackToEmail = () => {
    setStep('email');
    setEmail('');
    setEmailError('');
    setMagicLinkSentAt(undefined);
  };

  // Handle Apple Sign In
  const handleAppleSignIn = () => {
    appleSignIn.mutate();
  };

  // Handle Google Sign In
  const handleGoogleSignIn = () => {
    googleSignIn.mutate();
  };

  // Handle navigation to login for existing users
  const handleAlreadyHaveAccount = () => {
    Analytics.skipToLogin('AccountCreation');
    navigation.navigate('Auth', { screen: 'Login' });
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
      {/* Header with logo */}
      <View style={styles.headerRow}>
        {step === 'check_email' ? (
          <TouchableOpacity
            onPress={handleBackToEmail}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Use different email"
          >
            <Ionicons name="chevron-back" size={20} color={colors.midnightNavy} />
            <Text style={styles.backText}>Use different email</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.backButtonPlaceholder} />
        )}
        <Image source={atlasLogo} style={styles.logo} resizeMode="contain" />
        <View style={styles.backButtonPlaceholder} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {step === 'email' ? (
            // Email Entry Step
            <View style={styles.content}>
              {/* Title */}
              <Animated.View
                style={{
                  opacity: titleAnim,
                  transform: [{ translateY: titleTranslateY }],
                }}
              >
                <Text variant="title" style={styles.title}>
                  Save your passport
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
                Just one more step
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
                        testID="account-creation-email"
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
              </Animated.View>

              {/* Continue button */}
              <Animated.View
                style={{
                  opacity: buttonAnim,
                  transform: [{ scale: buttonScale }],
                }}
              >
                <TouchableOpacity
                  style={[styles.button, sendMagicLink.isPending && styles.buttonDisabled]}
                  onPress={handleSendMagicLink}
                  activeOpacity={0.9}
                  disabled={sendMagicLink.isPending}
                  accessibilityRole="button"
                  accessibilityLabel="Continue with email"
                  testID="account-creation-send-button"
                >
                  <Text style={styles.buttonText}>
                    {sendMagicLink.isPending ? 'Sending...' : 'Continue'}
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
                      testID="account-creation-google-button"
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
                      testID="account-creation-apple-button"
                    >
                      <Ionicons name="logo-apple" size={18} color={colors.white} />
                      <Text style={styles.appleButtonText}>
                        {appleSignIn.isPending ? 'Signing in...' : 'Continue with Apple'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </Animated.View>
              )}

              {/* Login link */}
              <Animated.View style={{ opacity: contentAnim }}>
                <TouchableOpacity
                  onPress={handleAlreadyHaveAccount}
                  style={styles.loginLink}
                  accessibilityRole="button"
                  accessibilityLabel="Sign in to existing account"
                >
                  <Text style={styles.loginLinkText}>Already have an account? Sign in</Text>
                </TouchableOpacity>
              </Animated.View>
            </View>
          ) : (
            // Check Your Email Step
            <Animated.View style={[styles.content, { opacity: checkEmailAnim }]}>
              {/* Mail Icon */}
              <View style={styles.mailIconContainer}>
                <Ionicons name="mail-outline" size={64} color={colors.sunsetGold} />
              </View>

              <Text variant="title" style={styles.checkEmailTitle}>
                Check your email
              </Text>
              <Text variant="body" style={styles.checkEmailSubtitle}>
                We sent a magic link to
              </Text>
              <Text variant="body" style={styles.emailDisplay}>
                {email}
              </Text>
              <Text variant="body" style={styles.checkEmailInstructions}>
                Click the link in the email to create your account.
              </Text>

              {/* Resend button */}
              <TouchableOpacity
                style={[
                  styles.resendButton,
                  (resendCountdown > 0 || sendMagicLink.isPending) && styles.resendButtonDisabled,
                ]}
                onPress={handleResendMagicLink}
                disabled={resendCountdown > 0 || sendMagicLink.isPending}
                accessibilityRole="button"
                accessibilityLabel={
                  resendCountdown > 0
                    ? `Resend available in ${resendCountdown} seconds`
                    : 'Resend email'
                }
                testID="account-creation-resend-button"
              >
                <Text
                  style={[
                    styles.resendButtonText,
                    (resendCountdown > 0 || sendMagicLink.isPending) &&
                      styles.resendButtonTextDisabled,
                  ]}
                >
                  {sendMagicLink.isPending
                    ? 'Sending...'
                    : resendCountdown > 0
                      ? `Resend email (${resendCountdown}s)`
                      : 'Resend email'}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          )}
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  logo: {
    width: 140,
    height: 40,
  },
  backButtonPlaceholder: {
    width: 140,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    width: 140,
  },
  backText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
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
    marginVertical: 24,
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
  loginLink: {
    marginTop: 24,
    alignItems: 'center',
    paddingVertical: 8,
  },
  loginLinkText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.mossGreen,
  },
  // Check your email step styles
  mailIconContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  checkEmailTitle: {
    textAlign: 'center',
    marginBottom: 16,
  },
  checkEmailSubtitle: {
    textAlign: 'center',
    color: colors.textSecondary,
  },
  emailDisplay: {
    textAlign: 'center',
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
    marginBottom: 16,
  },
  checkEmailInstructions: {
    textAlign: 'center',
    color: colors.textSecondary,
    marginBottom: 32,
  },
  resendButton: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  resendButtonDisabled: {
    opacity: 0.5,
  },
  resendButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.sunsetGold,
  },
  resendButtonTextDisabled: {
    color: colors.textSecondary,
  },
});
