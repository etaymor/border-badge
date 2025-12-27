import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { SearchInput } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useDebounce } from '@hooks/useDebounce';
import { useFollowing } from '@hooks/useFollows';
import { useUserLookupByEmail } from '@hooks/useUserLookupByEmail';
import { useUserSearch, type UserSearchResult } from '@hooks/useUserSearch';

import { FriendChip } from './FriendChip';
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
    country_count: 0, // Not displayed in this context
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
  const [isExpanded, setIsExpanded] = useState(false);

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

  // Get selected user objects for chips (from following list, search cache, or email lookup)
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

  const toggleExpanded = useCallback(() => {
    if (!disabled) {
      setIsExpanded((prev) => !prev);
    }
  }, [disabled]);

  const isLoading = loadingFollowing || searchLoading || emailLoading;
  const totalSelected = selectedIds.size + invitedEmails.size;
  const hasChips = selectedUsers.length > 0 || invitedEmails.size > 0;

  return (
    <View style={styles.section}>
      <Text style={styles.label}>TAG FRIENDS</Text>

      {/* Selected friends and email invite chips */}
      {hasChips && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsContainer}
          contentContainerStyle={styles.chipsContent}
        >
          {selectedUsers.map((user) => (
            <FriendChip
              key={user.id}
              user={user}
              onRemove={disabled ? undefined : () => handleToggle(user.id)}
            />
          ))}
          {Array.from(invitedEmails).map((email) => (
            <FriendChip
              key={`email-${email}`}
              email={email}
              status="pending"
              onRemove={disabled ? undefined : () => handleRemoveEmail(email)}
            />
          ))}
        </ScrollView>
      )}

      {/* Expandable picker trigger */}
      <TouchableOpacity
        style={[styles.pickerTrigger, disabled && styles.pickerTriggerDisabled]}
        onPress={toggleExpanded}
        disabled={disabled}
        activeOpacity={0.7}
      >
        <Ionicons name="people" size={20} color={colors.mossGreen} />
        <Text style={styles.pickerText}>
          {totalSelected === 0
            ? 'Tag friends who traveled with you'
            : `${totalSelected} friend${totalSelected > 1 ? 's' : ''} selected`}
        </Text>
        <Ionicons
          name={isExpanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.textSecondary}
        />
      </TouchableOpacity>

      {/* Expanded picker content */}
      {isExpanded && (
        <View style={styles.pickerContent}>
          <SearchInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search users or enter email..."
            onFocus={onSearchFocus}
            style={styles.searchInput}
          />

          {(isLoading && debouncedSearch.length >= 2) || emailLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.mossGreen} />
              <Text style={styles.loadingText}>Searching...</Text>
            </View>
          ) : showInviteOption ? (
            <View style={styles.inviteContainer}>
              <View style={styles.inviteIconWrap}>
                <Ionicons name="mail-outline" size={28} color={colors.sunsetGold} />
              </View>
              <Text style={styles.inviteTitle}>Friend not found</Text>
              <Text style={styles.inviteSubtitle}>Send an invite to join the trip</Text>
              <TouchableOpacity
                style={styles.inviteButton}
                onPress={handleInviteEmail}
                activeOpacity={0.8}
              >
                <Ionicons name="paper-plane" size={16} color={colors.cloudWhite} />
                <Text style={styles.inviteButtonText}>Invite {search.trim()}</Text>
              </TouchableOpacity>
            </View>
          ) : combinedUsers.length === 0 ? (
            <View style={styles.noResultsContainer}>
              <Text style={styles.noResultsText}>
                {looksLikeEmail && !isCompleteEmail
                  ? 'Enter complete email address'
                  : debouncedSearch.length >= 2
                    ? 'No users found'
                    : following.length === 0
                      ? 'Search for friends to tag'
                      : 'Start typing to search'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={combinedUsers}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <SelectableUserItem
                  user={{
                    id: item.id,
                    username: item.username,
                    display_name: item.username, // Use username as fallback
                    avatar_url: item.avatar_url,
                  }}
                  isSelected={selectedIds.has(item.id)}
                  onToggle={() => handleToggle(item.id)}
                />
              )}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            />
          )}
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
    marginBottom: 10,
    letterSpacing: 1.5,
    opacity: 0.7,
    textTransform: 'uppercase',
  },
  chipsContainer: {
    marginBottom: 12,
  },
  chipsContent: {
    gap: 8,
    paddingRight: 4,
  },
  pickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    gap: 10,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  pickerTriggerDisabled: {
    opacity: 0.6,
  },
  pickerText: {
    flex: 1,
    fontSize: 16,
    color: colors.midnightNavy,
    fontFamily: fonts.openSans.regular,
  },
  pickerContent: {
    marginTop: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    maxHeight: 320,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  searchInput: {
    borderRadius: 0,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  list: {
    maxHeight: 260,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontFamily: fonts.openSans.regular,
  },
  noResultsContainer: {
    padding: 20,
    alignItems: 'center',
  },
  noResultsText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontFamily: fonts.openSans.regular,
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
  inviteTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 17,
    color: colors.midnightNavy,
    marginBottom: 4,
  },
  inviteSubtitle: {
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
  inviteButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
  },
});
