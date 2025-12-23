import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OnboardingInput } from '@components/onboarding';
import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useAppleAuthAvailable, useAppleSignIn } from '@hooks/useAppleAuth';
import { useSendMagicLink } from '@hooks/useAuth';
import { useGoogleAuthAvailable, useGoogleSignIn } from '@hooks/useGoogleAuth';
import type { AuthStackScreenProps } from '@navigation/types';
import { validateEmail } from '@utils/emailValidation';

type Props = AuthStackScreenProps<'Login'>;

type AuthStep = 'email' | 'check_email';

// Cooldown for resending magic link (in seconds)
const RESEND_COOLDOWN_SECONDS = 60;

export function AuthScreen({ navigation }: Props) {
  const [step, setStep] = useState<AuthStep>('email');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [magicLinkSentAt, setMagicLinkSentAt] = useState<number | undefined>();
  const [resendCountdown, setResendCountdown] = useState(0);

  const sendMagicLink = useSendMagicLink();
  const appleSignIn = useAppleSignIn();
  const googleSignIn = useGoogleSignIn();
  const isAppleAvailable = useAppleAuthAvailable();
  const isGoogleAvailable = useGoogleAuthAvailable();

  const canGoBack = navigation.canGoBack();

  // Animation values for email step
  const titleAnim = useRef(new Animated.Value(0)).current;
  const accentAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;

  // Animation values for check email step - start at 1 to ensure visibility
  const checkEmailAnim = useRef(new Animated.Value(1)).current;

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
      // Check email step - fade in from current value
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
      { email: result.normalizedEmail! },
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
      { email: result.normalizedEmail! },
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
      {(canGoBack || step === 'check_email') && (
        <TouchableOpacity
          onPress={step === 'check_email' ? handleBackToEmail : () => navigation.goBack()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={step === 'check_email' ? 'Use different email' : 'Go back'}
        >
          <Ionicons name="chevron-back" size={20} color={colors.midnightNavy} />
          <Text style={styles.backText}>
            {step === 'check_email' ? 'Use different email' : 'Back'}
          </Text>
        </TouchableOpacity>
      )}

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
                  Welcome back
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
                ~ let&apos;s pick up where you left off ~
              </Animated.Text>

              {/* Email input */}
              <Animated.View
                style={{
                  opacity: contentAnim,
                  transform: [{ translateY: contentTranslateY }],
                }}
              >
                <OnboardingInput
                  value={email}
                  onChangeText={(value) => {
                    setEmail(value);
                    if (emailError) setEmailError('');
                  }}
                  placeholder="Email address"
                  error={emailError}
                  containerStyle={styles.input}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  icon="mail-outline"
                  testID="auth-email-input"
                />
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
                  testID="auth-send-button"
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
                      testID="auth-google-button"
                    >
                      <Ionicons name="logo-google" size={20} color={colors.midnightNavy} />
                      <Text style={styles.googleButtonText}>
                        {googleSignIn.isPending ? 'Signing in...' : 'Continue with Google'}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* Apple Sign In Button - only shown on iOS */}
                  {isAppleAvailable && (
                    <AppleAuthentication.AppleAuthenticationButton
                      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                      cornerRadius={12}
                      style={styles.appleButton}
                      onPress={handleAppleSignIn}
                    />
                  )}
                </Animated.View>
              )}
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
                Click the link in the email to sign in.
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
                testID="auth-resend-button"
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
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
    gap: 4,
  },
  backText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
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
    paddingTop: 48,
    paddingBottom: 24,
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
    marginBottom: 24,
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
    backgroundColor: colors.white,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
    marginBottom: 12,
  },
  googleButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  appleButton: {
    width: '100%',
    height: 50,
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
