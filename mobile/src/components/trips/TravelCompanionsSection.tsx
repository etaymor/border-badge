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
import { useFollowing } from '@hooks/useFollows';

import { CompanionChip } from './CompanionChip';
import { SelectableUserItem } from './SelectableUserItem';

interface TravelCompanionsSectionProps {
  selectedIds: Set<string>;
  onToggleSelection: (userId: string) => void;
  disabled?: boolean;
}

export function TravelCompanionsSection({
  selectedIds,
  onToggleSelection,
  disabled = false,
}: TravelCompanionsSectionProps) {
  const [search, setSearch] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  const { data: following = [], isLoading } = useFollowing({ limit: 100 });

  const filteredFollowing = useMemo(() => {
    if (!search) return following;
    const query = search.toLowerCase();
    return following.filter(
      (user) =>
        user.username.toLowerCase().includes(query) ||
        user.display_name.toLowerCase().includes(query)
    );
  }, [following, search]);

  // Get selected user objects for chips
  const selectedUsers = useMemo(() => {
    return following.filter((user) => selectedIds.has(user.id));
  }, [following, selectedIds]);

  const handleToggle = useCallback(
    (userId: string) => {
      if (!disabled) {
        onToggleSelection(userId);
      }
    },
    [disabled, onToggleSelection]
  );

  const toggleExpanded = useCallback(() => {
    if (!disabled) {
      setIsExpanded((prev) => !prev);
    }
  }, [disabled]);

  // Empty state when user follows no one
  if (following.length === 0 && !isLoading) {
    return (
      <View style={styles.section}>
        <Text style={styles.label}>TRAVEL COMPANIONS</Text>
        <View style={styles.emptyState}>
          <Ionicons name="people-outline" size={32} color={colors.textSecondary} />
          <Text style={styles.emptyTitle}>No friends to tag yet</Text>
          <Text style={styles.emptyText}>
            Follow friends in the Friends tab to tag them as travel companions.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.label}>TRAVEL COMPANIONS</Text>

      {/* Selected companions chips */}
      {selectedUsers.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsContainer}
          contentContainerStyle={styles.chipsContent}
        >
          {selectedUsers.map((user) => (
            <CompanionChip
              key={user.id}
              user={user}
              onRemove={disabled ? undefined : () => handleToggle(user.id)}
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
          {selectedIds.size === 0
            ? 'Tag friends who traveled with you'
            : `${selectedIds.size} companion${selectedIds.size > 1 ? 's' : ''} selected`}
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
            placeholder="Search friends..."
            style={styles.searchInput}
          />

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.mossGreen} />
              <Text style={styles.loadingText}>Loading friends...</Text>
            </View>
          ) : filteredFollowing.length === 0 ? (
            <View style={styles.noResultsContainer}>
              <Text style={styles.noResultsText}>
                {search ? 'No friends match your search' : 'No friends to show'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredFollowing}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <SelectableUserItem
                  user={item}
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
    maxHeight: 280,
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
    maxHeight: 220,
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
  emptyState: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: 'rgba(84, 122, 95, 0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(84, 122, 95, 0.1)',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: fonts.playfair.bold,
    color: colors.midnightNavy,
    marginTop: 4,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontFamily: fonts.openSans.regular,
    textAlign: 'center',
    lineHeight: 20,
  },
});
