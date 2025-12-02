import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@components/ui';
import type { AuthStackScreenProps } from '@navigation/types';
import { useAuthStore } from '@stores/authStore';

type Props = AuthStackScreenProps<'Welcome'>;

export function WelcomeScreen({ navigation }: Props) {
  const { setIsGuest } = useAuthStore();

  const handleGuestMode = () => {
    setIsGuest(true);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.logo}>Border Badge</Text>
          <Text style={styles.tagline}>Track your travels around the world</Text>
        </View>

        <View style={styles.buttonContainer}>
          <Button
            title="Get Started"
            onPress={() => navigation.navigate('SignUp')}
            style={styles.button}
            testID="welcome-get-started-button"
          />

          <Button
            title="I have an account"
            onPress={() => navigation.navigate('Login')}
            variant="outline"
            style={styles.button}
            testID="welcome-login-button"
          />

          <Button
            title="Browse as Guest"
            onPress={handleGuestMode}
            variant="ghost"
            style={styles.guestButton}
            testID="welcome-guest-button"
          />
        </View>
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
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingTop: 80,
    paddingBottom: 48,
  },
  header: {
    alignItems: 'center',
  },
  logo: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  tagline: {
    fontSize: 18,
    color: '#666',
    textAlign: 'center',
  },
  buttonContainer: {
    gap: 12,
  },
  button: {
    width: '100%',
  },
  guestButton: {
    width: '100%',
    marginTop: 8,
  },
});
