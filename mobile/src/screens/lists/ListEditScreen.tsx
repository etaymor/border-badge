import { useCallback, useState, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

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
    <View style={styles.successContainer}>
      <View style={styles.successIcon}>
        <Ionicons name="checkmark-circle" size={64} color="#34C759" />
      </View>
      <Text style={styles.successTitle}>List Updated!</Text>
      <Text style={styles.successSubtitle}>
        Anyone with the link can view &quot;{list.name}&quot;
      </Text>

      {/* Share URL */}
      <View style={styles.successUrlContainer}>
        <Text style={styles.successUrlLabel}>Public link</Text>
        <View style={styles.successUrlBox}>
          <Text style={styles.successUrlText} numberOfLines={1}>
            {shareUrl}
          </Text>
          <Pressable style={styles.successCopyButton} onPress={handleCopy}>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={20} color="#007AFF" />
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
    navigation,
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
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (!list) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color="#FF3B30" />
        <Text style={styles.errorText}>List not found</Text>
        <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <FlatList
        data={entries ?? []}
        keyExtractor={(item) => item.id}
        renderItem={renderEntry}
        ListHeaderComponent={
          <View style={styles.formSection}>
            {/* Share URL */}
            <View style={styles.urlContainer}>
              <Text style={styles.label}>Public link</Text>
              <View style={styles.urlBox}>
                <Text style={styles.urlText} numberOfLines={1}>
                  {shareUrl}
                </Text>
                <Pressable style={styles.copyButton} onPress={handleCopy}>
                  <Ionicons
                    name={copied ? 'checkmark' : 'copy-outline'}
                    size={18}
                    color="#007AFF"
                  />
                </Pressable>
                <Pressable style={styles.shareIconButton} onPress={handleShare}>
                  <Ionicons name="share-outline" size={18} color="#007AFF" />
                </Pressable>
              </View>
            </View>

            {/* List Name */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>List Name *</Text>
              <TextInput
                style={[styles.input, errors.name && styles.inputError]}
                placeholder="e.g., Best Restaurants in Paris"
                value={name}
                onChangeText={(text) => {
                  setName(text);
                  if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
                }}
                returnKeyType="next"
              />
              {errors.name && <Text style={styles.errorTextSmall}>{errors.name}</Text>}
            </View>

            {/* Description */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Description (optional)</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Tell people what this list is about..."
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            {/* Public info */}
            <View style={styles.infoBanner}>
              <Ionicons name="globe-outline" size={18} color="#007AFF" style={styles.infoIcon} />
              <View style={styles.infoTextContainer}>
                <Text style={styles.infoTitle}>Lists are public</Text>
                <Text style={styles.infoDescription}>Anyone with the link can view this list.</Text>
              </View>
            </View>

            {/* Entries Header */}
            <View style={styles.entriesHeader}>
              <Text style={styles.label}>Select Entries * ({selectedEntryIds.size} selected)</Text>
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
        }
        ListEmptyComponent={
          entriesLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color="#007AFF" />
              <Text style={styles.loadingText}>Loading entries...</Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="bookmark-outline" size={48} color="#ccc" />
              <Text style={styles.emptyText}>No entries in this trip</Text>
            </View>
          )
        }
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      {/* Submit Button */}
      <View style={styles.footer}>
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    color: '#666',
    marginTop: 12,
    marginBottom: 24,
  },
  backButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  listContent: {
    paddingBottom: 100,
  },
  formSection: {
    padding: 20,
  },
  urlContainer: {
    marginBottom: 20,
  },
  urlBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  urlText: {
    flex: 1,
    fontSize: 14,
    color: '#007AFF',
    marginRight: 8,
  },
  copyButton: {
    padding: 4,
    marginRight: 4,
  },
  shareIconButton: {
    padding: 4,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1a1a1a',
  },
  inputError: {
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  textArea: {
    minHeight: 80,
    paddingTop: 14,
  },
  errorTextSmall: {
    fontSize: 13,
    color: '#FF3B30',
    marginTop: 6,
    marginLeft: 4,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f5ff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    marginBottom: 20,
  },
  infoIcon: {
    marginTop: 1,
  },
  infoTextContainer: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0a1a2f',
  },
  infoDescription: {
    fontSize: 13,
    color: '#2c3e5d',
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
    color: '#007AFF',
    fontWeight: '500',
  },
  selectionDivider: {
    fontSize: 14,
    color: '#ccc',
    marginHorizontal: 8,
  },
  entryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#ccc',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  checkboxSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  entryContent: {
    flex: 1,
    marginRight: 12,
  },
  entryTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  entryPlace: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  entryTypeBadge: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  entryTypeText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#666',
    textTransform: 'capitalize',
  },
  separator: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginLeft: 56,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginTop: 16,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  submitButtonDisabled: {
    backgroundColor: '#ccc',
  },
  submitButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  // Success view styles
  successContainer: {
    flex: 1,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  successIcon: {
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
  },
  successUrlContainer: {
    width: '100%',
    marginBottom: 32,
  },
  successUrlLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  successUrlBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  successUrlText: {
    flex: 1,
    fontSize: 14,
    color: '#007AFF',
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
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 10,
    gap: 8,
  },
  successShareButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  successDoneButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f0f0',
    paddingVertical: 14,
    borderRadius: 10,
  },
  successDoneButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
});
