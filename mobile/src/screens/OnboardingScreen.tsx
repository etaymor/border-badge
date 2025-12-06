import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { storeOnboardingComplete } from '@services/api';
import { useAuthStore } from '@stores/authStore';
import type { RootStackScreenProps } from '@navigation/types';

type Props = RootStackScreenProps<'Onboarding'>;

export function OnboardingScreen(_props: Props) {
  const { setHasCompletedOnboarding } = useAuthStore();

  const handleComplete = async () => {
    setHasCompletedOnboarding(true);
    await storeOnboardingComplete();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Welcome to Border Badge!</Text>
        <Text style={styles.subtitle}>
          {"Track your travels and see where you've been around the world."}
        </Text>
        <Text style={styles.link} onPress={handleComplete}>
          Get Started
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#1a1a1a',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 32,
    textAlign: 'center',
    lineHeight: 24,
  },
  link: {
    fontSize: 18,
    color: '#007AFF',
    fontWeight: '600',
    minHeight: 44,
    textAlignVertical: 'center',
  },
});
