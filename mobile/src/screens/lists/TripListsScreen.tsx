import { useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';

import type { TripsStackScreenProps } from '@navigation/types';
import { useTripLists, useDeleteList, getPublicListUrl, ListSummary } from '@hooks/useLists';

type Props = TripsStackScreenProps<'TripLists'>;

interface ListItemProps {
  list: ListSummary;
  onEdit: () => void;
  onShare: () => void;
  onDelete: () => void;
}

function ListItem({ list, onEdit, onShare, onDelete }: ListItemProps) {
  const swipeableRef = useRef<Swipeable>(null);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    });
  };

  const renderRightActions = () => (
    <Pressable
      style={styles.deleteAction}
      onPress={() => {
        swipeableRef.current?.close();
        onDelete();
      }}
    >
      <Ionicons name="trash-outline" size={24} color="#fff" />
      <Text style={styles.deleteActionText}>Delete</Text>
    </Pressable>
  );

  return (
    <Swipeable ref={swipeableRef} renderRightActions={renderRightActions} overshootRight={false}>
      <View style={styles.listItem}>
        <View style={styles.listItemContent}>
          <View style={styles.listItemHeader}>
            <Text style={styles.listName} numberOfLines={1}>
              {list.name}
            </Text>
            <View style={styles.entryCountBadge}>
              <Text style={styles.entryCountText}>{list.entry_count}</Text>
            </View>
          </View>
          <Text style={styles.listDate}>Created {formatDate(list.created_at)}</Text>
        </View>
        <View style={styles.listItemActions}>
          <Pressable style={styles.actionButton} onPress={onEdit}>
            <Ionicons name="pencil-outline" size={20} color="#5856D6" />
          </Pressable>
          <Pressable style={styles.actionButton} onPress={onShare}>
            <Ionicons name="share-outline" size={20} color="#007AFF" />
          </Pressable>
        </View>
      </View>
    </Swipeable>
  );
}

export function TripListsScreen({ route, navigation }: Props) {
  const { tripId, tripName } = route.params;
  const { data: lists, isLoading, refetch } = useTripLists(tripId);
  const deleteList = useDeleteList();

  const handleCreateNew = useCallback(() => {
    navigation.navigate('ListCreate', { tripId, tripName });
  }, [navigation, tripId, tripName]);

  const handleEdit = useCallback(
    (listId: string) => {
      navigation.navigate('ListEdit', { listId, tripId, tripName });
    },
    [navigation, tripId, tripName]
  );

  const handleShare = useCallback(async (list: ListSummary) => {
    const shareUrl = getPublicListUrl(list.slug);
    try {
      await Share.share({
        message: `Check out my list "${list.name}": ${shareUrl}`,
        url: shareUrl,
      });
    } catch (error) {
      console.error('Share error:', error);
    }
  }, []);

  const handleDelete = useCallback(
    (list: ListSummary) => {
      Alert.alert(
        'Delete List',
        `Are you sure you want to delete "${list.name}"? This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteList.mutateAsync({ listId: list.id, tripId });
              } catch {
                Alert.alert('Error', 'Failed to delete list. Please try again.');
              }
            },
          },
        ]
      );
    },
    [deleteList, tripId]
  );

  const renderItem = useCallback(
    ({ item }: { item: ListSummary }) => (
      <ListItem
        list={item}
        onEdit={() => handleEdit(item.id)}
        onShare={() => handleShare(item)}
        onDelete={() => handleDelete(item)}
      />
    ),
    [handleEdit, handleShare, handleDelete]
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={lists}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={
          <View style={styles.header}>
            {/* Create New List CTA */}
            <Pressable style={styles.createButton} onPress={handleCreateNew}>
              <View style={styles.createButtonIcon}>
                <Ionicons name="add" size={24} color="#fff" />
              </View>
              <View style={styles.createButtonText}>
                <Text style={styles.createButtonTitle}>Create New List</Text>
                <Text style={styles.createButtonSubtitle}>Share more spots from this trip</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#FF9500" />
            </Pressable>

            {/* Section Header */}
            {lists && lists.length > 0 && <Text style={styles.sectionTitle}>YOUR LISTS</Text>}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="list-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>No lists yet</Text>
            <Text style={styles.emptySubtext}>
              Create your first shareable list to share your favorite spots with friends
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        onRefresh={refetch}
        refreshing={isLoading}
      />
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
    backgroundColor: '#f5f5f5',
  },
  listContent: {
    paddingBottom: 40,
  },
  header: {
    padding: 16,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: '#FF9500',
    borderStyle: 'dashed',
  },
  createButtonIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FF9500',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  createButtonText: {
    flex: 1,
  },
  createButtonTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  createButtonSubtitle: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#999',
    letterSpacing: 0.5,
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 4,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  listItemContent: {
    flex: 1,
  },
  listItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  listName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    flex: 1,
    marginRight: 8,
  },
  entryCountBadge: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  entryCountText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  listDate: {
    fontSize: 13,
    color: '#999',
    marginTop: 4,
  },
  listItemActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  separator: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginLeft: 16,
  },
  deleteAction: {
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    paddingHorizontal: 16,
  },
  deleteActionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
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
    lineHeight: 20,
  },
});
