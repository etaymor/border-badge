import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useSendInvite } from '@hooks/useInvites';
import { useUserSearch } from '@hooks/useUserSearch';

import { FollowButton } from './FollowButton';
import { UserAvatar } from './UserAvatar';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UserSearchBarProps {
  onUserSelect?: (userId: string, username: string) => void;
  placeholder?: string;
}

export function UserSearchBar({
  onUserSelect,
  placeholder = 'Search by username or email...',
}: UserSearchBarProps) {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const { data: users, isLoading } = useUserSearch(query, {
    enabled: query.length >= 2,
  });

  const sendInviteMutation = useSendInvite();

  const isEmail = useMemo(() => EMAIL_REGEX.test(query.trim()), [query]);
  const noUsersFound = users !== undefined && users.length === 0;
  const showInviteOption = isEmail && noUsersFound && !isLoading;

  const handleUserPress = useCallback(
    (userId: string, username: string) => {
      onUserSelect?.(userId, username);
      setQuery('');
    },
    [onUserSelect]
  );

  const handleInviteByEmail = useCallback(() => {
    const email = query.trim();
    Alert.alert(
      'Invite Friend',
      `Send an invitation to ${email}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Invite',
          onPress: () => {
            sendInviteMutation.mutate(
              { email, invite_type: 'follow' },
              {
                onSuccess: () => {
                  setQuery('');
                },
              }
            );
          },
        },
      ]
    );
  }, [query, sendInviteMutation]);

  const showResults = isFocused && query.length >= 2;

  return (
    <View style={styles.container}>
      <View style={styles.inputContainer}>
        <Text style={styles.atSymbol}>@</Text>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
        />
        {isLoading && <ActivityIndicator size="small" color={colors.primary} />}
      </View>

      {showResults && (
        <View style={styles.resultsContainer}>
          {users && users.length > 0 ? (
            <FlatList
              data={users}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.userRow}
                  onPress={() => handleUserPress(item.id, item.username)}
                >
                  <UserAvatar
                    avatarUrl={item.avatar_url}
                    username={item.username}
                    size={40}
                  />
                  <View style={styles.userInfo}>
                    <Text style={styles.username}>@{item.username}</Text>
                    <Text style={styles.countryCount}>
                      {item.country_count} {item.country_count === 1 ? 'country' : 'countries'}
                    </Text>
                  </View>
                  <FollowButton
                    userId={item.id}
                    isFollowing={item.is_following}
                    size="small"
                  />
                </TouchableOpacity>
              )}
            />
          ) : showInviteOption ? (
            <View style={styles.inviteContainer}>
              <Text style={styles.noResults}>No users found with this email</Text>
              <TouchableOpacity
                style={styles.inviteButton}
                onPress={handleInviteByEmail}
                disabled={sendInviteMutation.isPending}
              >
                {sendInviteMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.surface} />
                ) : (
                  <>
                    <Ionicons name="mail-outline" size={18} color={colors.surface} />
                    <Text style={styles.inviteButtonText}>Invite by Email</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.noResults}>No users found</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    zIndex: 10,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
  },
  atSymbol: {
    fontSize: 16,
    color: colors.textSecondary,
    marginRight: 4,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
  },
  resultsContainer: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  userInfo: {
    flex: 1,
    marginLeft: 12,
  },
  username: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  countryCount: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  noResults: {
    padding: 16,
    textAlign: 'center',
    color: colors.textSecondary,
  },
  inviteContainer: {
    padding: 16,
    alignItems: 'center',
  },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginTop: 12,
    gap: 8,
    minWidth: 160,
  },
  inviteButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.surface,
  },
});
