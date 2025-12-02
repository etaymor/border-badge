import { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { TripsStackScreenProps } from '@navigation/types';
import { useEntries, EntryWithPlace } from '@hooks/useEntries';
import { EntryCard } from '@components/entries';

type Props = TripsStackScreenProps<'EntryList'>;

interface EntrySection {
  title: string;
  data: EntryWithPlace[];
}

function formatSectionDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

function groupEntriesByMonth(entries: EntryWithPlace[]): EntrySection[] {
  const groups = new Map<string, EntryWithPlace[]>();

  // Sort entries by date descending
  const sorted = [...entries].sort((a, b) => {
    const dateA = a.entry_date ? new Date(a.entry_date).getTime() : 0;
    const dateB = b.entry_date ? new Date(b.entry_date).getTime() : 0;
    return dateB - dateA;
  });

  for (const entry of sorted) {
    const dateKey = entry.entry_date
      ? entry.entry_date.substring(0, 7) // YYYY-MM
      : 'no-date';

    if (!groups.has(dateKey)) {
      groups.set(dateKey, []);
    }
    groups.get(dateKey)!.push(entry);
  }

  return Array.from(groups.entries()).map(([key, data]) => ({
    title: key === 'no-date' ? 'No Date' : formatSectionDate(data[0].entry_date!),
    data,
  }));
}

function EmptyState({ onAddEntry }: { onAddEntry: () => void }) {
  return (
    <View style={styles.emptyContainer}>
      <Ionicons name="bookmark-outline" size={64} color="#ccc" />
      <Text style={styles.emptyTitle}>No entries yet</Text>
      <Text style={styles.emptySubtitle}>
        Log the places you visited, food you tried, and experiences you had
      </Text>
      <Pressable style={styles.emptyButton} onPress={onAddEntry} testID="empty-add-entry-button">
        <Ionicons name="add" size={20} color="#fff" />
        <Text style={styles.emptyButtonText}>Add Your First Entry</Text>
      </Pressable>
    </View>
  );
}

export function EntryListScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const { data: entries, isLoading, isRefetching, refetch, error } = useEntries(tripId);

  const sections = useMemo(() => {
    if (!entries?.length) return [];
    return groupEntriesByMonth(entries);
  }, [entries]);

  const handleAddEntry = useCallback(() => {
    navigation.navigate('EntryForm', { tripId });
  }, [navigation, tripId]);

  const handleEntryPress = useCallback(
    (entryId: string) => {
      navigation.navigate('EntryDetail', { entryId });
    },
    [navigation]
  );

  const renderItem = useCallback(
    ({ item }: { item: EntryWithPlace }) => (
      <EntryCard entry={item} onPress={() => handleEntryPress(item.id)} />
    ),
    [handleEntryPress]
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: EntrySection }) => (
      <Text style={styles.sectionHeader}>{section.title}</Text>
    ),
    []
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color="#FF3B30" />
        <Text style={styles.errorText}>Failed to load entries</Text>
        <Pressable style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryButtonText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  if (!entries?.length) {
    return <EmptyState onAddEntry={handleAddEntry} />;
  }

  return (
    <View style={styles.container}>
      {/* Stats Header */}
      <View style={styles.statsHeader}>
        <Text style={styles.statsText}>
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </Text>
      </View>

      {/* Entry List */}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#007AFF" />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        SectionSeparatorComponent={() => <View style={styles.sectionSeparator} />}
        testID="entries-list"
      />

      {/* FAB for adding new entry */}
      <Pressable style={styles.fab} onPress={handleAddEntry} testID="fab-add-entry">
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
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
  retryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  statsHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  statsText: {
    fontSize: 14,
    color: '#666',
  },
  listContent: {
    padding: 16,
    paddingBottom: 100, // Space for FAB
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  separator: {
    height: 10,
  },
  sectionSeparator: {
    height: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  emptyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});
