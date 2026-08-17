// TODO: Refactor - this file exceeds 500 lines (currently ~674 lines).
// Consider extracting:
// - useListForm hook for form state, validation, and mutations
// - EntrySelector component for entry selection UI
// - ListHeader component for list metadata input

import { useCallback, useState, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassBackButton, GlassInput } from '@components/ui';
import { ListSuccessView } from '@components/lists';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { TripsStackScreenProps } from '@navigation/types';
import { Analytics } from '@services/analytics';
import { useEntries, EntryWithPlace } from '@hooks/useEntries';
import {
  useList,
  useUpdateList,
  useUpdateListEntries,
  getPublicListUrl,
  ListDetail,
} from '@hooks/useLists';

type Props = TripsStackScreenProps<'ListEdit'>;

interface EntrySelectionItemProps {
  entry: EntryWithPlace;
  selected: boolean;
  onToggle: () => void;
}

function EntrySelectionItem({ entry, selected, onToggle }: EntrySelectionItemProps) {
  return (
    <TouchableOpacity
      style={[styles.entryItem, selected && styles.entryItemSelected]}
      onPress={onToggle}
      activeOpacity={0.7}
    >
      <View style={styles.entryContent}>
        <Text style={[styles.entryTitle, selected && styles.entryTitleSelected]} numberOfLines={2}>
          {entry.title}
        </Text>
      </View>

      <View style={styles.entryRightSide}>
        <View style={[styles.entryTypeBadge, selected && styles.entryTypeBadgeSelected]}>
          <Text style={[styles.entryTypeText, selected && styles.entryTypeTextSelected]}>
            {entry.entry_type}
          </Text>
        </View>

        {selected ? (
          <Ionicons
            name="checkmark-circle"
            size={24}
            color={colors.midnightNavy}
            style={styles.checkIcon}
          />
        ) : (
          <View style={styles.uncheckedCircle} />
        )}
      </View>
    </TouchableOpacity>
  );
}

export function ListEditScreen({ route, navigation }: Props) {
  const { listId, tripId } = route.params;
  const insets = useSafeAreaInsets();

  const { data: list, isLoading: listLoading } = useList(listId);
  const { data: entries, isLoading: _entriesLoading } = useEntries(tripId);
  const updateList = useUpdateList();
  const updateListEntries = useUpdateListEntries();

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // Initialize form with list data
  useEffect(() => {
    if (list) {
      setName(list.name);
      setDescription(list.description ?? '');
      setSelectedEntryIds(new Set(list.entries.map((e) => e.entry_id)));
    }
  }, [list]);

  const shareUrl = useMemo(() => (list ? getPublicListUrl(list.slug) : ''), [list]);

  // Check if anything changed
  const hasChanges = useMemo(() => {
    if (!list) return false;
    const originalEntryIds = new Set(list.entries.map((e) => e.entry_id));
    const nameChanged = name !== list.name;
    const descChanged = description !== (list.description ?? '');
    const entriesChanged =
      selectedEntryIds.size !== originalEntryIds.size ||
      [...selectedEntryIds].some((id) => !originalEntryIds.has(id));
    return nameChanged || descChanged || entriesChanged;
  }, [list, name, description, selectedEntryIds]);

  // Toggle entry selection
  const toggleEntry = useCallback((entryId: string) => {
    setSelectedEntryIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }, []);

  // Select all
  const handleSelectAll = useCallback(() => {
    if (!entries) return;
    setSelectedEntryIds(new Set(entries.map((e) => e.id)));
  }, [entries]);

  // Clear all
  const handleClearAll = useCallback(() => {
    setSelectedEntryIds(new Set());
  }, []);

  // Copy URL
  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [shareUrl]);

  // Share
  const handleShare = useCallback(async () => {
    if (!list) return;
    try {
      Analytics.shareList(list.id);
      await Share.share(
        Platform.OS === 'ios'
          ? { url: shareUrl }
          : { message: `Check out my list "${list.name}": ${shareUrl}` }
      );
    } catch (error) {
      console.error('Share error:', error);
    }
  }, [list, shareUrl]);

  // Validate form
  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = 'List name is required';
    }

    if (selectedEntryIds.size === 0) {
      newErrors.entries = 'Select at least one entry';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, selectedEntryIds]);

  // Submit
  const handleSubmit = useCallback(async () => {
    if (!validateForm() || !list) return;

    setIsSubmitting(true);
    try {
      // Check what changed
      const originalEntryIds = new Set(list.entries.map((e) => e.entry_id));
      const entriesChanged =
        selectedEntryIds.size !== originalEntryIds.size ||
        [...selectedEntryIds].some((id) => !originalEntryIds.has(id));

      const nameChanged = name.trim() !== list.name;
      const descChanged = description.trim() !== (list.description ?? '');

      // Update metadata if changed
      if (nameChanged || descChanged) {
        await updateList.mutateAsync({
          listId,
          data: {
            name: name.trim(),
            description: description.trim() || undefined,
          },
        });
      }

      // Update entries if changed
      if (entriesChanged) {
        await updateListEntries.mutateAsync({
          listId,
          entryIds: Array.from(selectedEntryIds),
        });
      }

      // Show success view with share URL
      setShowSuccess(true);
    } catch {
      Alert.alert('Error', 'Failed to update list. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    validateForm,
    list,
    listId,
    name,
    description,
    selectedEntryIds,
    updateList,
    updateListEntries,
  ]);

  // Render entry item
  const renderEntry = useCallback(
    ({ item }: { item: EntryWithPlace }) => (
      <EntrySelectionItem
        entry={item}
        selected={selectedEntryIds.has(item.id)}
        onToggle={() => toggleEntry(item.id)}
      />
    ),
    [selectedEntryIds, toggleEntry]
  );

  // Handle done from success view
  const handleDone = useCallback(() => {
    // Navigate back to trip detail (pop twice: ListEdit -> TripLists -> TripDetail)
    navigation.pop(2);
  }, [navigation]);

  // List Header Component
  const ListHeader = useCallback(
    () => (
      <View style={styles.content}>
        <Text style={styles.headerSubtitle}>Update your curated list</Text>

        {/* Share URL */}
        <View style={styles.urlContainer}>
          <Text style={styles.label}>PUBLIC LINK</Text>
          <View style={styles.urlBox}>
            <Text style={styles.urlText} numberOfLines={1}>
              {shareUrl}
            </Text>
            <Pressable style={styles.copyButton} onPress={handleCopy} hitSlop={8}>
              <Ionicons
                name={copied ? 'checkmark' : 'copy-outline'}
                size={18}
                color={colors.sunsetGold}
              />
            </Pressable>
            <Pressable style={styles.shareIconButton} onPress={handleShare} hitSlop={8}>
              <Ionicons name="share-outline" size={18} color={colors.sunsetGold} />
            </Pressable>
          </View>
        </View>

        {/* List Name */}
        <GlassInput
          label="LIST NAME"
          value={name}
          onChangeText={(text) => {
            setName(text);
            if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
          }}
          placeholder="e.g., Best Restaurants in Paris"
          error={errors.name}
          returnKeyType="next"
          testID="list-name-input"
        />

        {/* Description */}
        <GlassInput
          label="DESCRIPTION (OPTIONAL)"
          value={description}
          onChangeText={setDescription}
          placeholder="Tell people what this list is about..."
          multiline
          testID="list-description-input"
        />

        {/* Entries Header */}
        <View style={styles.entriesHeader}>
          <Text style={styles.label}>SELECT ENTRIES ({selectedEntryIds.size} selected)</Text>
          <View style={styles.selectionActions}>
            <Pressable onPress={handleSelectAll} hitSlop={12} style={styles.actionButton}>
              <Text style={styles.selectionAction}>Select All</Text>
            </Pressable>
            <Text style={styles.selectionDivider}>•</Text>
            <Pressable onPress={handleClearAll} hitSlop={12} style={styles.actionButton}>
              <Text style={styles.selectionAction}>Clear</Text>
            </Pressable>
          </View>
        </View>
        {errors.entries && <Text style={styles.errorTextSmall}>{errors.entries}</Text>}
      </View>
    ),
    [
      name,
      description,
      errors,
      selectedEntryIds.size,
      shareUrl,
      copied,
      handleCopy,
      handleShare,
      handleSelectAll,
      handleClearAll,
    ]
  );

  // List Footer Component
  const ListFooter = useCallback(
    () => (
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
        <Pressable
          style={[
            styles.submitButton,
            (isSubmitting || selectedEntryIds.size === 0 || !hasChanges) &&
              styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={isSubmitting || selectedEntryIds.size === 0 || !hasChanges}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark" size={20} color="#fff" />
              <Text style={styles.submitButtonText}>Save Changes</Text>
            </>
          )}
        </Pressable>
      </View>
    ),
    [insets.bottom, handleSubmit, isSubmitting, selectedEntryIds.size, hasChanges]
  );

  // Show success view after update
  if (showSuccess && list) {
    const updatedList: ListDetail = {
      ...list,
      name: name.trim(),
      description: description.trim() || null,
    };
    return (
      <ListSuccessView
        list={updatedList}
        onDone={handleDone}
        title="List Updated"
        subtitle="Your changes have been saved and are ready to share."
      />
    );
  }

  if (listLoading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.sunsetGold} />
      </View>
    );
  }

  if (!list) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.adobeBrick} />
        <Text style={styles.errorText}>List not found</Text>
        <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Custom Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <GlassBackButton onPress={() => navigation.goBack()} />
          <Text style={styles.headerTitle}>Edit List</Text>
          <View style={styles.headerSpacer} />
        </View>
      </View>

      {/* Main List */}
      <FlatList
        data={entries ?? []}
        keyExtractor={(item) => item.id}
        renderItem={renderEntry}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  header: {
    backgroundColor: colors.warmCream,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    zIndex: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
    textAlign: 'center',
    lineHeight: 44,
  },
  headerSpacer: {
    width: 44,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.warmCream,
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    color: colors.textSecondary,
    fontFamily: fonts.openSans.regular,
    marginTop: 12,
    marginBottom: 24,
  },
  backButton: {
    backgroundColor: colors.sunsetGold,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: fonts.openSans.semiBold,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    padding: 24,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 24,
    lineHeight: 24,
  },
  urlContainer: {
    marginBottom: 24,
  },
  urlBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.05)',
  },
  urlText: {
    flex: 1,
    fontSize: 14,
    color: colors.sunsetGold,
    fontFamily: fonts.openSans.regular,
    marginRight: 8,
  },
  copyButton: {
    padding: 4,
    marginRight: 4,
  },
  shareIconButton: {
    padding: 4,
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
  errorTextSmall: {
    fontSize: 13,
    color: colors.adobeBrick,
    fontFamily: fonts.openSans.regular,
    marginTop: -16,
    marginBottom: 16,
    marginLeft: 4,
  },
  // Entries Header
  entriesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  selectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButton: {
    padding: 4,
  },
  selectionAction: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.adobeBrick,
  },
  selectionDivider: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textTertiary,
    marginHorizontal: 8,
  },
  // Entry Item
  entryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.white,
    borderRadius: 20,
    marginHorizontal: 16,
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  entryItemSelected: {
    backgroundColor: colors.sunsetGold,
    ...Platform.select({
      ios: {
        shadowColor: colors.sunsetGold,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  entryContent: {
    flex: 1,
    marginRight: 16,
  },
  entryTitle: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
    lineHeight: 22,
  },
  entryTitleSelected: {
    color: colors.midnightNavy,
  },
  entryRightSide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  entryTypeBadge: {
    backgroundColor: 'rgba(23, 42, 58, 0.05)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  entryTypeBadgeSelected: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  entryTypeText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 11,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  entryTypeTextSelected: {
    color: colors.midnightNavy,
  },
  uncheckedCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(23, 42, 58, 0.1)',
    backgroundColor: 'transparent',
  },
  checkIcon: {
    // Icon handles its own size
  },
  footer: {
    padding: 24,
    paddingTop: 16,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sunsetGold,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  submitButtonDisabled: {
    backgroundColor: colors.textTertiary,
  },
  submitButtonText: {
    fontSize: 17,
    fontFamily: fonts.openSans.semiBold,
    color: '#fff',
  },
});
