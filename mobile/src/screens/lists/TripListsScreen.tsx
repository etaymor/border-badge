import { Ionicons } from '@expo/vector-icons';
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
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassBackButton } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { ListSummary, getPublicListUrl, useDeleteList, useTripLists } from '@hooks/useLists';
import type { TripsStackScreenProps } from '@navigation/types';
import { Analytics } from '@services/analytics';

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
      <View style={styles.listItemContainer}>
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
              <Ionicons name="pencil-outline" size={20} color={colors.midnightNavy} />
            </Pressable>
            <Pressable style={[styles.actionButton, styles.shareActionButton]} onPress={onShare}>
              <Ionicons name="share-outline" size={20} color={colors.sunsetGold} />
            </Pressable>
          </View>
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
      Analytics.shareList(list.id);
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
        <ActivityIndicator size="large" color={colors.sunsetGold} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <FlatList
        data={lists}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <GlassBackButton onPress={() => navigation.goBack()} />
              <Text style={styles.headerTitle}>Shared Lists</Text>
            </View>

            <Text style={styles.headerSubtitle}>Curated collections from {tripName}</Text>

            {/* Create New List CTA */}
            <Pressable style={styles.createButton} onPress={handleCreateNew}>
              <View style={styles.createButtonIcon}>
                <Ionicons name="add" size={24} color="#fff" />
              </View>
              <View style={styles.createButtonText}>
                <Text style={styles.createButtonTitle}>Create New List</Text>
                <Text style={styles.createButtonSubtitle}>Share your favorite spots</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.sunsetGold} />
            </Pressable>

            {/* Section Header */}
            {lists && lists.length > 0 && (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Curated Collections</Text>
                <View style={styles.sectionLine} />
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📝</Text>
            <Text style={styles.emptyText}>No lists yet</Text>
            <Text style={styles.emptySubtext}>
              Create your first curated list to share your favorite spots with friends
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
        onRefresh={refetch}
        refreshing={isLoading}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.warmCream,
  },
  listContent: {
    paddingBottom: 40,
  },
  header: {
    padding: 20,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 12,
  },
  headerTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 32,
    color: colors.midnightNavy,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 24,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(244, 194, 78, 0.4)',
    borderStyle: 'dashed',
    marginBottom: 32,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  createButtonIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.sunsetGold,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    shadowColor: colors.sunsetGold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  createButtonText: {
    flex: 1,
  },
  createButtonTitle: {
    fontSize: 18,
    fontFamily: fonts.playfair.bold,
    color: colors.midnightNavy,
    marginBottom: 2,
  },
  createButtonSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    fontFamily: fonts.openSans.regular,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: fonts.dawning.regular,
    fontSize: 28,
    color: colors.adobeBrick,
    marginRight: 12,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(193, 84, 62, 0.2)',
    marginTop: 4,
  },
  listItemContainer: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderRadius: 16,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.02)',
  },
  listItemContent: {
    flex: 1,
  },
  listItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  listName: {
    fontSize: 18,
    fontFamily: fonts.playfair.bold,
    color: colors.midnightNavy,
    flex: 1,
    marginRight: 8,
  },
  entryCountBadge: {
    backgroundColor: 'rgba(84, 122, 95, 0.1)', // Moss Green light
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  entryCountText: {
    fontSize: 12,
    fontFamily: fonts.openSans.bold,
    color: colors.mossGreen,
  },
  listDate: {
    fontSize: 13,
    color: colors.textSecondary,
    fontFamily: fonts.openSans.regular,
  },
  listItemActions: {
    flexDirection: 'row',
    gap: 8,
    marginLeft: 12,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shareActionButton: {
    backgroundColor: 'rgba(244, 194, 78, 0.1)', // Sunset Gold light
  },
  deleteAction: {
    backgroundColor: colors.adobeBrick,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    height: '100%',
    marginLeft: 20,
    borderRadius: 16,
  },
  deleteActionText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: fonts.openSans.semiBold,
    marginTop: 4,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    fontFamily: fonts.playfair.bold,
    color: colors.midnightNavy,
    marginTop: 8,
  },
  emptySubtext: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
    fontFamily: fonts.openSans.regular,
  },
});
