import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, GlassBackButton, GlassInput } from '@components/ui';
import { ListSuccessView } from '@components/lists';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { TripsStackScreenProps } from '@navigation/types';
import { useEntries, EntryWithPlace } from '@hooks/useEntries';
import { useCreateList, ListDetail } from '@hooks/useLists';

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

export function ListCreateScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const insets = useSafeAreaInsets();

  const { data: entries, isLoading: entriesLoading } = useEntries(tripId);
  const createList = useCreateList();

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
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
          entry_ids: Array.from(selectedEntryIds),
        },
      });

      setCreatedList(list);
    } catch {
      Alert.alert('Error', 'Failed to create list. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [validateForm, tripId, name, description, selectedEntryIds, createList]);

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
    return <ListSuccessView list={createdList} onDone={handleDone} />;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Custom Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <GlassBackButton onPress={() => navigation.goBack()} />
          <Text style={styles.headerTitle}>New List</Text>
          <View style={styles.headerSpacer} />
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.formSection}>
          {/* List Name */}
          <GlassInput
            label="LIST NAME"
            placeholder="e.g., Best Restaurants in Paris"
            value={name}
            onChangeText={(text) => {
              setName(text);
              if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
            }}
            error={errors.name}
            returnKeyType="next"
          />

          {/* Description */}
          <GlassInput
            label="DESCRIPTION (OPTIONAL)"
            placeholder="Tell people what this list is about..."
            value={description}
            onChangeText={setDescription}
            multiline
          />

          {/* Public info */}
          <View style={styles.infoBanner}>
            <Ionicons
              name="globe-outline"
              size={18}
              color={colors.midnightNavy}
              style={styles.infoIcon}
            />
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
          {errors.entries && <Text style={styles.errorText}>{errors.entries}</Text>}
        </View>

        {/* Entries List */}
        {entriesLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.midnightNavy} />
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
            <Text style={styles.emptyText}>No entries in this trip yet</Text>
            <Text style={styles.emptySubtext}>
              Add some entries to your trip first, then create a shareable list
            </Text>
          </View>
        )}

        {/* Submit Button */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
          <Button
            title="Create List"
            onPress={handleSubmit}
            loading={isSubmitting}
            disabled={isSubmitting || selectedEntryIds.size === 0}
          />
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  formSection: {
    padding: 24,
    paddingTop: 8,
  },
  label: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.midnightNavy,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    opacity: 0.7,
  },
  errorText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.adobeBrick,
    marginTop: 6,
    marginLeft: 4,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(23, 42, 58, 0.05)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(23, 42, 58, 0.1)',
  },
  infoIcon: {
    marginTop: 1,
    opacity: 0.7,
  },
  infoTextContainer: {
    flex: 1,
  },
  infoTitle: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 15,
    color: colors.midnightNavy,
  },
  infoDescription: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.textSecondary,
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
    fontFamily: fonts.openSans.semiBold,
    fontSize: 15,
    color: colors.midnightNavy,
  },
  entryPlace: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  entryTypeBadge: {
    backgroundColor: 'rgba(23, 42, 58, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  entryTypeText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 11,
    color: colors.midnightNavy,
    textTransform: 'capitalize',
    opacity: 0.7,
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(23, 42, 58, 0.08)',
    marginLeft: 60,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 8,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
    marginTop: 16,
  },
  emptySubtext: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  footer: {
    padding: 24,
    paddingTop: 16,
  },
});
