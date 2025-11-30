import { StyleSheet, Text, View } from 'react-native';

import { useAuthStore } from '@stores/authStore';
import type { MainTabScreenProps } from '@navigation/types';

type Props = MainTabScreenProps<'Profile'>;

export function ProfileScreen(_props: Props) {
  const { session, signOut } = useAuthStore();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.subtitle}>{session?.user.email || 'Not signed in'}</Text>
      <Text style={styles.link} onPress={signOut}>
        Sign Out
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 24,
  },
  link: {
    fontSize: 16,
    color: '#FF3B30',
    fontWeight: '600',
    minHeight: 44,
    textAlignVertical: 'center',
  },
});
