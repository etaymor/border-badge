import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Input } from '@components/ui';
import { useSignIn } from '@hooks/useAuth';
import type { AuthStackScreenProps, OnboardingStackScreenProps } from '@navigation/types';

// LoginScreen can be accessed from both Auth and Onboarding stacks
type Props = AuthStackScreenProps<'Login'> | OnboardingStackScreenProps<'Login'>;

export function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const signIn = useSignIn();
  const canGoBack = navigation.canGoBack();

  // Type-safe navigation helper for screens available in both stacks
  const navigateToScreen = (screen: 'SignUp' | 'ForgotPassword') => {
    (navigation as { navigate: (screen: string) => void }).navigate(screen);
  };

  const validateEmail = (value: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
  };

  const validateForm = (): boolean => {
    const trimmedEmail = email.trim();
    let isValid = true;
    setEmailError('');
    setPasswordError('');

    if (!trimmedEmail) {
      setEmailError('Email is required');
      isValid = false;
    } else if (!validateEmail(trimmedEmail)) {
      setEmailError('Please enter a valid email');
      isValid = false;
    }

    if (!password) {
      setPasswordError('Password is required');
      isValid = false;
    }

    return isValid;
  };

  const handleLogin = () => {
    if (!validateForm()) return;
    signIn.mutate({ email: email.trim(), password });
  };

  return (
    <SafeAreaView style={styles.container}>
      {canGoBack && (
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
      )}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.content}>
          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.subtitle}>Sign in to your account</Text>

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
            testID="login-email-input"
          />

          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
            error={passwordError}
            containerStyle={styles.input}
            testID="login-password-input"
          />

          <Button
            title="Sign In"
            onPress={handleLogin}
            loading={signIn.isPending}
            style={styles.button}
            testID="login-submit-button"
          />

          <Text
            style={styles.link}
            onPress={() => navigateToScreen('SignUp')}
            testID="login-signup-link"
          >
            {"Don't have an account? Sign up"}
          </Text>
          <Text
            style={styles.link}
            onPress={() => navigateToScreen('ForgotPassword')}
            testID="login-forgot-link"
          >
            Forgot password?
          </Text>
        </View>
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
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
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
    marginTop: 16,
    textAlign: 'center',
    minHeight: 44,
    textAlignVertical: 'center',
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    alignSelf: 'flex-start',
  },
  backText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
  },
});
