import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@components/ui';
import type { AuthStackScreenProps } from '@navigation/types';

type Props = AuthStackScreenProps<'Welcome'>;

export function WelcomeScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.logo}>Atlasi</Text>
          <Text style={styles.tagline}>Track your travels around the world</Text>
        </View>

        <View style={styles.buttonContainer}>
          <Button
            title="Get Started"
            // @ts-expect-error - React Navigation 7 typing issue with composite screens
            onPress={() => navigation.navigate('Auth')}
            style={styles.button}
            testID="welcome-get-started-button"
          />

          <Button
            title="I have an account"
            // @ts-expect-error - React Navigation 7 typing issue with composite screens
            onPress={() => navigation.navigate('Auth')}
            variant="outline"
            style={styles.button}
            testID="welcome-login-button"
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
});
