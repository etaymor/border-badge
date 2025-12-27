// TODO: Refactor - this file exceeds 500 lines (currently ~545 lines).
// Consider extracting:
// - useFriendSearch hook for search state and query logic
// - SelectedFriendCard component for friend display rows
// - FriendSearchResults component for autocomplete dropdown

import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { UserAvatar } from '@components/friends/UserAvatar';
import { colors } from '@constants/colors';
import { GLASS_CONFIG, liquidGlass } from '@constants/glass';
import { fonts } from '@constants/typography';
import { useDebounce } from '@hooks/useDebounce';
import { useFollowing } from '@hooks/useFollows';
import { useUserLookupByEmail } from '@hooks/useUserLookupByEmail';
import { useUserSearch, type UserSearchResult } from '@hooks/useUserSearch';

import { SelectableUserItem } from './SelectableUserItem';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface TravelFriendsSectionProps {
  selectedIds: Set<string>;
  invitedEmails: Set<string>;
  onToggleSelection: (userId: string) => void;
  onToggleEmailInvite: (email: string) => void;
  onSearchFocus?: () => void;
  disabled?: boolean;
}

// Convert following user to search result format
interface FollowingUser {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

function toSearchResult(user: FollowingUser): UserSearchResult {
  return {
    id: user.id,
    username: user.username,
    avatar_url: user.avatar_url,
    country_count: 0,
    is_following: true,
  };
}

export function TravelFriendsSection({
  selectedIds,
  invitedEmails,
  onToggleSelection,
  onToggleEmailInvite,
  onSearchFocus,
  disabled = false,
}: TravelFriendsSectionProps) {
  const [search, setSearch] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const debouncedSearch = useDebounce(search.trim(), 300);

  // Detect if input looks like an email (has @) vs a username
  const looksLikeEmail = search.includes('@');
  const isCompleteEmail = EMAIL_REGEX.test(search.trim());

  // Fetch followed users (cached longer, shown as suggestions)
  const { data: following = [], isLoading: loadingFollowing } = useFollowing({ limit: 100 });

  // Search all users by username when NOT typing an email
  const { data: searchResults = [], isLoading: searchLoading } = useUserSearch(debouncedSearch, {
    enabled: debouncedSearch.length >= 2 && !looksLikeEmail,
    limit: 20,
  });

  // Look up user by email when complete email is entered
  const { data: emailUser, isLoading: emailLoading } = useUserLookupByEmail(search.trim(), {
    enabled: isCompleteEmail,
  });

  // Combine results: followed users first, then others
  const combinedUsers = useMemo((): UserSearchResult[] => {
    // If we found a user by email, show only that user
    if (isCompleteEmail && emailUser) {
      return [emailUser];
    }

    // If typing an email but not complete yet, show nothing
    if (looksLikeEmail) {
      return [];
    }

    // No search: show all followed users as suggestions
    if (!debouncedSearch || debouncedSearch.length < 2) {
      return following.map(toSearchResult);
    }

    const query = debouncedSearch.toLowerCase();

    // Filter followed users by search query
    const matchingFollowed = following
      .filter(
        (u) =>
          u.username.toLowerCase().includes(query) || u.display_name.toLowerCase().includes(query)
      )
      .map(toSearchResult);

    // Deduplicate: filter out followed users from search results
    const followedIds = new Set(matchingFollowed.map((u) => u.id));
    const otherUsers = searchResults.filter((u) => !followedIds.has(u.id));

    return [...matchingFollowed, ...otherUsers];
  }, [following, searchResults, debouncedSearch, isCompleteEmail, emailUser, looksLikeEmail]);

  // Show invite option when complete email entered and no user found
  const showInviteOption =
    isCompleteEmail &&
    !emailLoading &&
    !emailUser &&
    !invitedEmails.has(search.trim().toLowerCase());

  // Get selected user objects (from following list, search cache, or email lookup)
  const selectedUsers = useMemo(() => {
    const users: UserSearchResult[] = [];

    // First try to get from following list
    for (const user of following) {
      if (selectedIds.has(user.id)) {
        users.push(toSearchResult(user));
      }
    }

    // Also check search results for non-followed users
    for (const user of searchResults) {
      if (selectedIds.has(user.id) && !users.some((u) => u.id === user.id)) {
        users.push(user);
      }
    }

    // Also check email lookup result
    if (emailUser && selectedIds.has(emailUser.id) && !users.some((u) => u.id === emailUser.id)) {
      users.push(emailUser);
    }

    return users;
  }, [following, searchResults, selectedIds, emailUser]);

  const handleToggle = useCallback(
    (userId: string) => {
      if (!disabled) {
        onToggleSelection(userId);
      }
    },
    [disabled, onToggleSelection]
  );

  const handleInviteEmail = useCallback(() => {
    if (!disabled) {
      const email = search.trim().toLowerCase();
      onToggleEmailInvite(email);
      setSearch('');
    }
  }, [disabled, search, onToggleEmailInvite]);

  const handleRemoveEmail = useCallback(
    (email: string) => {
      if (!disabled) {
        onToggleEmailInvite(email);
      }
    },
    [disabled, onToggleEmailInvite]
  );

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    onSearchFocus?.();
  }, [onSearchFocus]);

  const isLoading = loadingFollowing || searchLoading || emailLoading;
  const hasSelections = selectedUsers.length > 0 || invitedEmails.size > 0;
  const showResults = isFocused || search.length > 0;

  return (
    <View style={styles.section}>
      {/* Section Header */}
      <Text style={styles.label}>TAG FRIENDS</Text>

      {/* Search Input - Liquid Glass Style */}
      <View style={[styles.inputWrapper, isFocused && styles.inputWrapperFocused]}>
        <BlurView
          intensity={GLASS_CONFIG.intensity.medium}
          tint={GLASS_CONFIG.tint}
          style={[styles.inputBlur, isFocused && styles.inputBlurFocused]}
        >
          <View style={styles.inputContainer}>
            <Ionicons name="search" size={18} color={colors.stormGray} style={styles.searchIcon} />
            <TextInput
              ref={inputRef}
              style={styles.textInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search by username or email..."
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              onFocus={handleFocus}
              editable={!disabled}
            />
            {isLoading && (
              <ActivityIndicator size="small" color={colors.sunsetGold} style={styles.loader} />
            )}
            {!isLoading && search.length > 0 && (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <Ionicons name="close-circle" size={20} color={colors.stormGray} />
              </Pressable>
            )}
          </View>
        </BlurView>
      </View>

      {/* Selected Friends List - Wide Card Layout */}
      {hasSelections && (
        <View style={styles.selectedSection}>
          <Text style={styles.selectedLabel}>Tagged on this trip</Text>
          <View style={styles.selectedList}>
            {selectedUsers.map((user) => (
              <View key={user.id} style={styles.selectedCard}>
                <UserAvatar avatarUrl={user.avatar_url} username={user.username} size={36} />
                <View style={styles.selectedInfo}>
                  <Text style={styles.selectedName}>@{user.username}</Text>
                  {user.is_following && <Text style={styles.selectedMeta}>Following</Text>}
                </View>
                {!disabled && (
                  <TouchableOpacity
                    onPress={() => handleToggle(user.id)}
                    style={styles.removeButton}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={16} color={colors.stormGray} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            {Array.from(invitedEmails).map((email) => (
              <View key={`email-${email}`} style={[styles.selectedCard, styles.selectedCardInvite]}>
                <View style={styles.emailAvatarPlaceholder}>
                  <Ionicons name="mail-outline" size={18} color={colors.sunsetGold} />
                </View>
                <View style={styles.selectedInfo}>
                  <Text style={styles.selectedName} numberOfLines={1}>
                    {email}
                  </Text>
                  <Text style={styles.inviteBadge}>Invite pending</Text>
                </View>
                {!disabled && (
                  <TouchableOpacity
                    onPress={() => handleRemoveEmail(email)}
                    style={styles.removeButton}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={16} color={colors.stormGray} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Search Results */}
      {showResults && (
        <View style={styles.resultsContainer}>
          {(isLoading && debouncedSearch.length >= 2) || emailLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.mossGreen} />
              <Text style={styles.loadingText}>Searching...</Text>
            </View>
          ) : showInviteOption ? (
            <View style={styles.inviteContainer}>
              <View style={styles.inviteIconWrap}>
                <Ionicons name="mail-outline" size={24} color={colors.sunsetGold} />
              </View>
              <View style={styles.inviteTextWrap}>
                <Text style={styles.inviteTitle}>User not found</Text>
                <Text style={styles.inviteSubtitle}>Send an invite to {search.trim()}</Text>
              </View>
              <TouchableOpacity
                style={styles.inviteButton}
                onPress={handleInviteEmail}
                activeOpacity={0.8}
              >
                <Ionicons name="paper-plane" size={14} color={colors.midnightNavy} />
                <Text style={styles.inviteButtonText}>Invite</Text>
              </TouchableOpacity>
            </View>
          ) : combinedUsers.length === 0 && !hasSelections ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {looksLikeEmail && !isCompleteEmail
                  ? 'Enter complete email address'
                  : debouncedSearch.length >= 2
                    ? 'No users found'
                    : 'Search for friends to tag'}
              </Text>
            </View>
          ) : combinedUsers.length > 0 ? (
            <ScrollView
              style={styles.list}
              keyboardShouldPersistTaps="always"
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
              {combinedUsers.map((item) => (
                <SelectableUserItem
                  key={item.id}
                  user={{
                    id: item.id,
                    username: item.username,
                    display_name: item.username,
                    avatar_url: item.avatar_url,
                  }}
                  isSelected={selectedIds.has(item.id)}
                  onToggle={() => handleToggle(item.id)}
                />
              ))}
            </ScrollView>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 28,
  },
  label: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.midnightNavy,
    letterSpacing: 1.5,
    marginBottom: 10,
    opacity: 0.7,
  },
  inputWrapper: {
    ...liquidGlass.input,
    overflow: 'hidden',
  },
  inputWrapperFocused: {
    ...liquidGlass.floatingCard,
    borderRadius: 12,
    transform: [{ scale: 1.01 }],
  },
  inputBlur: {
    minHeight: 48,
  },
  inputBlurFocused: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    minHeight: 48,
  },
  searchIcon: {
    marginRight: 10,
    opacity: 0.7,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: fonts.openSans.regular,
    color: colors.textPrimary,
    paddingVertical: 12,
  },
  loader: {
    marginLeft: 8,
  },
  selectedSection: {
    marginTop: 16,
  },
  selectedLabel: {
    fontFamily: fonts.oswald.medium,
    fontSize: 11,
    color: colors.stormGray,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  selectedList: {
    gap: 8,
  },
  selectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cloudWhite,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(84, 122, 95, 0.15)',
    gap: 12,
  },
  selectedCardInvite: {
    borderStyle: 'dashed',
    borderColor: colors.sunsetGold,
    backgroundColor: 'rgba(244, 194, 78, 0.04)',
  },
  selectedInfo: {
    flex: 1,
    minWidth: 0,
  },
  selectedName: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
  },
  selectedMeta: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.mossGreen,
    marginTop: 1,
  },
  inviteBadge: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.sunsetGold,
    marginTop: 1,
  },
  emailAvatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(244, 194, 78, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(102, 109, 122, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultsContainer: {
    marginTop: 12,
    backgroundColor: colors.cloudWhite,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(23, 42, 58, 0.06)',
    maxHeight: 280,
    overflow: 'hidden',
  },
  list: {
    maxHeight: 260,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  loadingText: {
    fontSize: 14,
    color: colors.stormGray,
    fontFamily: fonts.openSans.regular,
  },
  emptyContainer: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: colors.stormGray,
    fontFamily: fonts.openSans.regular,
    textAlign: 'center',
  },
  inviteContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  inviteIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(244, 194, 78, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  inviteTextWrap: {
    flex: 1,
  },
  inviteTitle: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
  },
  inviteSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.stormGray,
    marginTop: 2,
  },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sunsetGold,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    gap: 6,
  },
  inviteButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 13,
    color: colors.midnightNavy,
  },
});
