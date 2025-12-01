import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

import type { TripsStackScreenProps } from '@navigation/types';
import { useEntries, EntryWithPlace } from '@hooks/useEntries';
import { useCreateList, getPublicListUrl, ListDetail } from '@hooks/useLists';

type Props = TripsStackScreenProps<'ListCreate'>;

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
      <Text style={styles.successTitle}>List Created!</Text>
      <Text style={styles.successSubtitle}>
        Your list &quot;{list.name}&quot; is ready to share
      </Text>

      {/* Share URL */}
      <View style={styles.urlContainer}>
        <Text style={styles.urlLabel}>Share Link</Text>
        <View style={styles.urlBox}>
          <Text style={styles.urlText} numberOfLines={1}>
            {shareUrl}
          </Text>
          <Pressable style={styles.copyButton} onPress={handleCopy}>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={20} color="#007AFF" />
          </Pressable>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.successActions}>
        <Pressable style={styles.shareButton} onPress={handleShare}>
          <Ionicons name="share-outline" size={20} color="#fff" />
          <Text style={styles.shareButtonText}>Share</Text>
        </Pressable>

        <Pressable style={styles.doneButton} onPress={onDone}>
          <Text style={styles.doneButtonText}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ListCreateScreen({ route, navigation }: Props) {
  const { tripId } = route.params;

  const { data: entries, isLoading: entriesLoading } = useEntries(tripId);
  const createList = useCreateList();

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdList, setCreatedList] = useState<ListDetail | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

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
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      const list = await createList.mutateAsync({
        tripId,
        data: {
          name: name.trim(),
          description: description.trim() || undefined,
          is_public: isPublic,
          entry_ids: Array.from(selectedEntryIds),
        },
      });

      setCreatedList(list);
    } catch {
      Alert.alert('Error', 'Failed to create list. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [validateForm, tripId, name, description, isPublic, selectedEntryIds, createList]);

  // Handle done
  const handleDone = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

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

  // Show success view after creation
  if (createdList) {
    return <SuccessView list={createdList} onDone={handleDone} />;
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
              {errors.name && <Text style={styles.errorText}>{errors.name}</Text>}
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

            {/* Public Toggle */}
            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Text style={styles.toggleLabel}>Public List</Text>
                <Text style={styles.toggleHint}>
                  {isPublic
                    ? 'Anyone with the link can view this list'
                    : 'Only you can see this list'}
                </Text>
              </View>
              <Switch
                value={isPublic}
                onValueChange={setIsPublic}
                trackColor={{ false: '#e0e0e0', true: '#007AFF' }}
                ios_backgroundColor="#e0e0e0"
              />
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
            {errors.entries && <Text style={styles.errorText}>{errors.entries}</Text>}
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
              <Text style={styles.emptyText}>No entries in this trip yet</Text>
              <Text style={styles.emptySubtext}>
                Add some entries to your trip first, then create a shareable list
              </Text>
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
            (isSubmitting || selectedEntryIds.size === 0) && styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={isSubmitting || selectedEntryIds.size === 0}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="share-outline" size={20} color="#fff" />
              <Text style={styles.submitButtonText}>Create List</Text>
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
  listContent: {
    paddingBottom: 100,
  },
  formSection: {
    padding: 20,
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
  errorText: {
    fontSize: 13,
    color: '#FF3B30',
    marginTop: 6,
    marginLeft: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 20,
  },
  toggleInfo: {
    flex: 1,
    marginRight: 16,
  },
  toggleLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  toggleHint: {
    fontSize: 13,
    color: '#666',
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
  emptySubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
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
  // Success view
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
  urlContainer: {
    width: '100%',
    marginBottom: 32,
  },
  urlLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
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
  },
  successActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  shareButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 10,
    gap: 8,
  },
  shareButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  doneButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f0f0',
    paddingVertical: 14,
    borderRadius: 10,
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
});
