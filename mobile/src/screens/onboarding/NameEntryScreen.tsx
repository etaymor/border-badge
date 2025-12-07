import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Input } from '@components/ui';
import { colors } from '@constants/colors';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { useOnboardingStore } from '@stores/onboardingStore';
import { validateDisplayName } from '@utils/displayNameValidation';

type Props = OnboardingStackScreenProps<'NameEntry'>;

export function NameEntryScreen({ navigation }: Props) {
  const { displayName, setDisplayName } = useOnboardingStore();
  const [name, setName] = useState(displayName ?? '');
  const [error, setError] = useState('');

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

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.content}>
          <Text style={styles.title}>What should we call you?</Text>
          <Text style={styles.subtitle}>This is how you&apos;ll appear in the app</Text>

          <Input
            label="Your name"
            value={name}
            onChangeText={(text) => {
              setName(text);
              if (error) setError('');
            }}
            placeholder="Enter your name"
            autoCapitalize="words"
            autoComplete="name"
            autoFocus
            error={error}
            containerStyle={styles.input}
            testID="name-entry-input"
          />
        </View>

        <View style={styles.footer}>
          <Button
            title="Continue"
            onPress={handleContinue}
            style={styles.continueButton}
            testID="name-entry-continue"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 32,
  },
  input: {
    marginBottom: 16,
  },
  footer: {
    paddingHorizontal: 24,
    paddingVertical: 24,
    borderTopWidth: 1,
    borderTopColor: colors.backgroundTertiary,
  },
  continueButton: {
    width: '100%',
  },
});
