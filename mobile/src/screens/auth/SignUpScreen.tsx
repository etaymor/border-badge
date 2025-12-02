import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Input } from '@components/ui';
import { useSignUp } from '@hooks/useAuth';
import type { AuthStackScreenProps } from '@navigation/types';

type Props = AuthStackScreenProps<'SignUp'>;

export function SignUpScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');

  const signUp = useSignUp();

  // Basic email validation to catch obvious errors; Supabase validates fully on backend
  const validateEmail = (value: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
  };

  // Validate password meets complexity requirements
  const validatePassword = (value: string): { valid: boolean; error: string } => {
    if (value.length < 8) {
      return { valid: false, error: 'Password must be at least 8 characters' };
    }
    if (!/[A-Z]/.test(value)) {
      return { valid: false, error: 'Password must contain an uppercase letter' };
    }
    if (!/[a-z]/.test(value)) {
      return { valid: false, error: 'Password must contain a lowercase letter' };
    }
    if (!/[0-9]/.test(value)) {
      return { valid: false, error: 'Password must contain a number' };
    }
    return { valid: true, error: '' };
  };

  const validateForm = (): boolean => {
    let isValid = true;
    setEmailError('');
    setPasswordError('');
    setConfirmPasswordError('');

    if (!email.trim()) {
      setEmailError('Email is required');
      isValid = false;
    } else if (!validateEmail(email)) {
      setEmailError('Please enter a valid email');
      isValid = false;
    }

    if (!password) {
      setPasswordError('Password is required');
      isValid = false;
    } else {
      const passwordValidation = validatePassword(password);
      if (!passwordValidation.valid) {
        setPasswordError(passwordValidation.error);
        isValid = false;
      }
    }

    if (!confirmPassword) {
      setConfirmPasswordError('Please confirm your password');
      isValid = false;
    } else if (password !== confirmPassword) {
      setConfirmPasswordError('Passwords do not match');
      isValid = false;
    }

    return isValid;
  };

  const handleSignUp = () => {
    if (!validateForm()) return;
    signUp.mutate({ email: email.trim(), password });
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.content}>
            <Text style={styles.title}>Sign Up</Text>
            <Text style={styles.subtitle}>Create your account</Text>

            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              error={emailError}
              containerStyle={styles.input}
              testID="signup-email-input"
            />

            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Create a password"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              error={passwordError}
              containerStyle={styles.input}
              testID="signup-password-input"
            />

            <Input
              label="Confirm Password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm your password"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              error={confirmPasswordError}
              containerStyle={styles.input}
              testID="signup-confirm-password-input"
            />

            <Button
              title="Create Account"
              onPress={handleSignUp}
              loading={signUp.isPending}
              style={styles.button}
              testID="signup-submit-button"
            />

            <Text
              style={styles.link}
              onPress={() => navigation.navigate('Login')}
              testID="signup-login-link"
            >
              Already have an account? Sign in
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
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
    paddingTop: 60,
    paddingBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 32,
  },
  input: {
    marginBottom: 16,
  },
  button: {
    marginTop: 8,
  },
  link: {
    fontSize: 14,
    color: '#007AFF',
    marginTop: 24,
    textAlign: 'center',
    minHeight: 44,
    textAlignVertical: 'center',
  },
});
