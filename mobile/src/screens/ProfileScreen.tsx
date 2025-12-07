import { ActivityIndicator, StyleSheet, Text, View, Pressable } from 'react-native';

import { useSignOut } from '@hooks/useAuth';
import { useProfile } from '@hooks/useProfile';
import { useAuthStore } from '@stores/authStore';
import type { MainTabScreenProps } from '@navigation/types';

type Props = MainTabScreenProps<'Profile'>;

export function ProfileScreen(_props: Props) {
  const { session } = useAuthStore();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const signOut = useSignOut();

  const handleSignOut = () => {
    signOut.mutate();
  };

  // Show display name, fall back to phone number, then "Not signed in"
  const displayText = profile?.display_name || session?.user.phone || 'Not signed in';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>
      {profileLoading ? (
        <ActivityIndicator size="small" color="#666" />
      ) : (
        <Text style={styles.subtitle} testID="profile-display-name">
          {displayText}
        </Text>
      )}
      <Pressable onPress={handleSignOut} disabled={signOut.isPending} testID="sign-out-button">
        {signOut.isPending ? (
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
