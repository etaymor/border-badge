import { useState, useCallback } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View, Pressable } from 'react-native';

import { useAuthStore } from '@stores/authStore';
import type { MainTabScreenProps } from '@navigation/types';

type Props = MainTabScreenProps<'Profile'>;

export function ProfileScreen(_props: Props) {
  const { session, signOut } = useAuthStore();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      // Note: No need to reset isSigningOut on success - the auth store change
      // triggers navigation to login screen, unmounting this component
    } catch {
      Alert.alert('Error', 'Failed to sign out. Please try again.');
      setIsSigningOut(false);
    }
  }, [signOut]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.subtitle} testID="profile-email">
        {session?.user.email || 'Not signed in'}
      </Text>
      <Pressable onPress={handleSignOut} disabled={isSigningOut} testID="sign-out-button">
        {isSigningOut ? (
          <ActivityIndicator size="small" color="#FF3B30" />
        ) : (
          <Text style={styles.link}>Sign Out</Text>
        )}
      </Pressable>
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
