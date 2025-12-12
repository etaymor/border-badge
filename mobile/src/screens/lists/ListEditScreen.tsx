import { useCallback, useState, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassBackButton, GlassInput } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { TripsStackScreenProps } from '@navigation/types';
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
    <Pressable style={styles.entryItem} onPress={onToggle}>
      <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
        {selected && <Ionicons name="checkmark" size={16} color="#fff" />}
      </View>
      <View style={styles.entryContent}>
        <Text style={styles.entryTitle} numberOfLines={1}>
          {entry.title}
        </Text>
        {entry.place?.name && (
          <Text style={styles.entryPlace} numberOfLines={1}>
            {entry.place.name}
          </Text>
        )}
      </View>
      <View style={styles.entryTypeBadge}>
        <Text style={styles.entryTypeText}>{entry.entry_type}</Text>
      </View>
    </Pressable>
  );
}

interface SuccessViewProps {
  list: ListDetail;
  onDone: () => void;
}

function SuccessView({ list, onDone }: SuccessViewProps) {
  const shareUrl = getPublicListUrl(list.slug);
  const [copied, setCopied] = useState(false);
  const insets = useSafeAreaInsets();

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [shareUrl]);

  const handleShare = useCallback(async () => {
    try {
      await Share.share({
        message: `Check out my list "${list.name}": ${shareUrl}`,
        url: shareUrl,
      });
    } catch (error) {
      console.error('Share error:', error);
    }
  }, [list.name, shareUrl]);

  return (
    <View style={[styles.successContainer, { paddingTop: insets.top }]}>
      <View style={styles.successIcon}>
        <Ionicons name="checkmark-circle" size={64} color={colors.mossGreen} />
      </View>
      <Text style={styles.successTitle}>List Updated!</Text>
      <Text style={styles.successSubtitle}>
        Anyone with the link can view &quot;{list.name}&quot;
      </Text>

      {/* Share URL */}
      <View style={styles.successUrlContainer}>
        <Text style={styles.successUrlLabel}>PUBLIC LINK</Text>
        <View style={styles.successUrlBox}>
          <Text style={styles.successUrlText} numberOfLines={1}>
            {shareUrl}
          </Text>
          <Pressable style={styles.successCopyButton} onPress={handleCopy}>
            <Ionicons
              name={copied ? 'checkmark' : 'copy-outline'}
              size={20}
              color={colors.sunsetGold}
            />
          </Pressable>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.successActions}>
        <Pressable style={styles.successShareButton} onPress={handleShare}>
          <Ionicons name="share-outline" size={20} color="#fff" />
          <Text style={styles.successShareButtonText}>Share</Text>
        </Pressable>

        <Pressable style={styles.successDoneButton} onPress={onDone}>
          <Text style={styles.successDoneButtonText}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ListEditScreen({ route, navigation }: Props) {
  const { listId, tripId } = route.params;
  const insets = useSafeAreaInsets();

  const { data: list, isLoading: listLoading } = useList(listId);
  const { data: entries, isLoading: entriesLoading } = useEntries(tripId);
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
      await Share.share({
        message: `Check out my list "${list.name}": ${shareUrl}`,
        url: shareUrl,
      });
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

  // Show success view after update
  if (showSuccess && list) {
    // Create an updated list object with the new name for display
    const updatedList: ListDetail = {
      ...list,
      name: name.trim(),
      description: description.trim() || null,
    };
    return <SuccessView list={updatedList} onDone={handleDone} />;
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

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <Text style={styles.headerSubtitle}>Update your curated list</Text>

          {/* Share URL */}
          <View style={styles.urlContainer}>
            <Text style={styles.label}>PUBLIC LINK</Text>
            <View style={styles.urlBox}>
              <Text style={styles.urlText} numberOfLines={1}>
                {shareUrl}
              </Text>
              <Pressable style={styles.copyButton} onPress={handleCopy}>
                <Ionicons
                  name={copied ? 'checkmark' : 'copy-outline'}
                  size={18}
                  color={colors.sunsetGold}
                />
              </Pressable>
              <Pressable style={styles.shareIconButton} onPress={handleShare}>
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

          {/* Public info */}
          <View style={styles.infoBanner}>
            <Ionicons name="globe-outline" size={18} color={colors.sunsetGold} style={styles.infoIcon} />
            <View style={styles.infoTextContainer}>
              <Text style={styles.infoTitle}>Lists are public</Text>
              <Text style={styles.infoDescription}>Anyone with the link can view this list.</Text>
            </View>
          </View>

          {/* Entries Header */}
          <View style={styles.entriesHeader}>
            <Text style={styles.label}>SELECT ENTRIES ({selectedEntryIds.size} selected)</Text>
            <View style={styles.selectionActions}>
              <Pressable onPress={handleSelectAll}>
                <Text style={styles.selectionAction}>Select All</Text>
              </Pressable>
              <Text style={styles.selectionDivider}>|</Text>
              <Pressable onPress={handleClearAll}>
                <Text style={styles.selectionAction}>Clear</Text>
              </Pressable>
            </View>
          </View>
          {errors.entries && <Text style={styles.errorTextSmall}>{errors.entries}</Text>}
        </View>

        {/* Entries List */}
        {entriesLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.sunsetGold} />
            <Text style={styles.loadingText}>Loading entries...</Text>
          </View>
        ) : entries && entries.length > 0 ? (
          <FlatList
            data={entries}
            keyExtractor={(item) => item.id}
            renderItem={renderEntry}
            scrollEnabled={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="bookmark-outline" size={48} color={colors.textTertiary} />
            <Text style={styles.emptyText}>No entries in this trip</Text>
          </View>
        )}

        {/* Submit Button */}
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
      </ScrollView>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    padding: 24,
    paddingTop: 8,
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
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(218, 165, 32, 0.08)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(218, 165, 32, 0.15)',
  },
  infoIcon: {
    marginTop: 1,
  },
  infoTextContainer: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 15,
    fontFamily: fonts.playfair.bold,
    color: colors.midnightNavy,
  },
  infoDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    fontFamily: fonts.openSans.regular,
    marginTop: 2,
  },
  entriesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  selectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectionAction: {
    fontSize: 14,
    color: colors.sunsetGold,
    fontFamily: fonts.openSans.semiBold,
  },
  selectionDivider: {
    fontSize: 14,
    color: colors.textTertiary,
    marginHorizontal: 8,
  },
  entryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: colors.warmCream,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.textTertiary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  checkboxSelected: {
    backgroundColor: colors.sunsetGold,
    borderColor: colors.sunsetGold,
  },
  entryContent: {
    flex: 1,
    marginRight: 12,
  },
  entryTitle: {
    fontSize: 15,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
  },
  entryPlace: {
    fontSize: 13,
    color: colors.textSecondary,
    fontFamily: fonts.openSans.regular,
    marginTop: 2,
  },
  entryTypeBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  entryTypeText: {
    fontSize: 11,
    fontFamily: fonts.oswald.medium,
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    marginLeft: 60,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontFamily: fonts.openSans.regular,
    marginTop: 8,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
    marginTop: 16,
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
  // Success view styles
  successContainer: {
    flex: 1,
    backgroundColor: colors.warmCream,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  successIcon: {
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 24,
    fontFamily: fonts.playfair.bold,
    color: colors.midnightNavy,
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    fontFamily: fonts.openSans.regular,
    textAlign: 'center',
    marginBottom: 32,
  },
  successUrlContainer: {
    width: '100%',
    marginBottom: 32,
  },
  successUrlLabel: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.midnightNavy,
    letterSpacing: 1.5,
    opacity: 0.7,
    marginBottom: 8,
  },
  successUrlBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.05)',
  },
  successUrlText: {
    flex: 1,
    fontSize: 14,
    color: colors.sunsetGold,
    fontFamily: fonts.openSans.regular,
    marginRight: 8,
  },
  successCopyButton: {
    padding: 4,
  },
  successActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  successShareButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sunsetGold,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  successShareButtonText: {
    fontSize: 16,
    fontFamily: fonts.openSans.semiBold,
    color: '#fff',
  },
  successDoneButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    paddingVertical: 14,
    borderRadius: 12,
  },
  successDoneButtonText: {
    fontSize: 16,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
  },
});
