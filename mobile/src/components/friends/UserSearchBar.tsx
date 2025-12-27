import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
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
  placeholder = 'Find fellow travelers...',
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
    Alert.alert('Send Expedition Invite', `Invite ${email} to join the adventure?`, [
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
    ]);
  }, [query, sendInviteMutation]);

  const showResults = isFocused && query.length >= 2;

  return (
    <View style={styles.container}>
      <View style={styles.searchGlassWrapper}>
        <BlurView intensity={60} tint="light" style={styles.searchGlassContainer}>
          <View
            style={[styles.searchInputContainer, isFocused && styles.searchInputContainerFocused]}
          >
            <Ionicons name="search" size={18} color={colors.stormGray} style={styles.searchIcon} />
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder={placeholder}
              placeholderTextColor={colors.stormGray}
              autoCapitalize="none"
              autoCorrect={false}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            />
            {isLoading && <ActivityIndicator size="small" color={colors.adobeBrick} />}
            {query.length > 0 && !isLoading && (
              <TouchableOpacity onPress={() => setQuery('')} style={styles.clearButton}>
                <Ionicons name="close-circle" size={18} color={colors.stormGray} />
              </TouchableOpacity>
            )}
          </View>
        </BlurView>
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
                  activeOpacity={0.7}
                >
                  <UserAvatar avatarUrl={item.avatar_url} username={item.username} size={44} />
                  <View style={styles.userInfo}>
                    <Text style={styles.username}>@{item.username}</Text>
                    <View style={styles.countryRow}>
                      <Ionicons name="compass" size={12} color={colors.adobeBrick} />
                      <Text style={styles.countryCount}>
                        {item.country_count} {item.country_count === 1 ? 'country' : 'countries'}
                      </Text>
                    </View>
                  </View>
                  <FollowButton userId={item.id} isFollowing={item.is_following} size="small" />
                </TouchableOpacity>
              )}
            />
          ) : showInviteOption ? (
            <View style={styles.inviteContainer}>
              <View style={styles.inviteIconWrap}>
                <Ionicons name="mail-outline" size={28} color={colors.sunsetGold} />
              </View>
              <Text style={styles.noResultsTitle}>Traveler not found</Text>
              <Text style={styles.noResultsSubtitle}>Send an invite to join the expedition</Text>
              <TouchableOpacity
                style={[
                  styles.inviteButton,
                  sendInviteMutation.isPending && styles.inviteButtonDisabled,
                ]}
                onPress={handleInviteByEmail}
                disabled={sendInviteMutation.isPending}
                activeOpacity={0.8}
              >
                {sendInviteMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.cloudWhite} />
                ) : (
                  <>
                    <Ionicons name="paper-plane" size={16} color={colors.cloudWhite} />
                    <Text style={styles.inviteButtonText}>Send Invite</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.emptyResults}>
              <Ionicons name="compass-outline" size={24} color={colors.stormGray} />
              <Text style={styles.noResults}>No travelers found</Text>
            </View>
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
  searchGlassWrapper: {
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  searchGlassContainer: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    backgroundColor: 'rgba(253, 246, 237, 0.5)',
  },
  searchInputContainerFocused: {
    borderColor: colors.adobeBrick,
    borderWidth: 1.5,
  },
  searchIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  clearButton: {
    padding: 4,
  },
  resultsContainer: {
    position: 'absolute',
    top: 54,
    left: 0,
    right: 0,
    backgroundColor: colors.cloudWhite,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.paperBeige,
    maxHeight: 320,
    overflow: 'hidden',
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.paperBeige,
  },
  userInfo: {
    flex: 1,
    marginLeft: 12,
  },
  username: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 15,
    color: colors.midnightNavy,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  countryCount: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
  },
  emptyResults: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  noResults: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
  },
  inviteContainer: {
    padding: 24,
    alignItems: 'center',
  },
  inviteIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.paperBeige,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  noResultsTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 17,
    color: colors.midnightNavy,
    marginBottom: 4,
  },
  noResultsSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
    textAlign: 'center',
    marginBottom: 16,
  },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sunsetGold,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
    gap: 8,
    minWidth: 140,
    shadowColor: colors.sunsetGold,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  inviteButtonDisabled: {
    opacity: 0.7,
  },
  inviteButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
  },
});
