import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FeedCard } from '@components/friends';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useFeed, getFeedItems, type FeedItem } from '@hooks/useFeed';
import type { FriendsStackScreenProps } from '@navigation/types';

type Props = FriendsStackScreenProps<'FeedHome'>;

export function FeedScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { data, isLoading, isRefetching, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    useFeed();

  const feedItems = useMemo(() => getFeedItems(data), [data]);

  const handleUserPress = useCallback(
    (userId: string, username: string) => {
      navigation.navigate('UserProfile', { userId, username });
    },
    [navigation]
  );

  const handleCountryPress = useCallback(
    (countryCode: string, countryName: string) => {
      const tabNavigator = navigation.getParent();
      if (tabNavigator) {
        tabNavigator.navigate('Passport', {
          screen: 'CountryDetail',
          params: {
            countryId: countryCode,
            countryName,
            countryCode,
          },
        });
      }
    },
    [navigation]
  );

  const handleEntryPress = useCallback(
    (entryId: string) => {
      const tabNavigator = navigation.getParent();
      if (tabNavigator) {
        tabNavigator.navigate('Trips', {
          screen: 'EntryDetail',
          params: { entryId },
        });
      }
    },
    [navigation]
  );

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => (
      <FeedCard
        item={item}
        onUserPress={handleUserPress}
        onCountryPress={handleCountryPress}
        onEntryPress={handleEntryPress}
      />
    ),
    [handleUserPress, handleCountryPress, handleEntryPress]
  );

  const ListHeader = useMemo(
    () => (
      <View style={[styles.headerContainer, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerDecoration}>
          <View style={styles.decorLine} />
          <Ionicons name="book" size={20} color={colors.midnightNavy} />
          <View style={styles.decorLine} />
        </View>
        <Text style={styles.headerTitle}>Travel Log</Text>
        <Text style={styles.headerSubtitle}>Stories from the trail</Text>
      </View>
    ),
    [insets.top]
  );

  const ListEmpty = useMemo(
    () => (
      <View style={styles.emptyState}>
        <View style={styles.emptyIconContainer}>
          <Ionicons name="map-outline" size={48} color={colors.dustyCoral} />
        </View>
        <Text style={styles.emptyTitle}>The trail is quiet</Text>
        <Text style={styles.emptySubtitle}>
          Follow fellow travelers to see their{'\n'}adventures unfold here
        </Text>
        <View style={styles.emptyDecor}>
          <View style={styles.decorDot} />
          <View style={styles.decorDot} />
          <View style={styles.decorDot} />
        </View>
      </View>
    ),
    []
  );

  const ListFooter = useMemo(
    () =>
      isFetchingNextPage ? (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={colors.adobeBrick} />
          <Text style={styles.footerText}>Loading more stories...</Text>
        </View>
      ) : null,
    [isFetchingNextPage]
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={[styles.headerContainer, { paddingTop: insets.top + 12 }]}>
          <View style={styles.headerDecoration}>
            <View style={styles.decorLine} />
            <Ionicons name="book" size={20} color={colors.midnightNavy} />
            <View style={styles.decorLine} />
          </View>
          <Text style={styles.headerTitle}>Travel Log</Text>
          <Text style={styles.headerSubtitle}>Stories from the trail</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.adobeBrick} />
          <Text style={styles.loadingText}>Gathering stories...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={feedItems}
        renderItem={renderItem}
        keyExtractor={(item, index) => `${item.activity_type}-${item.created_at}-${index}`}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={ListFooter}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.adobeBrick}
            colors={[colors.adobeBrick]}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  headerContainer: {
    backgroundColor: colors.lakeBlue,
    paddingBottom: 28,
    alignItems: 'center',
    marginBottom: 16,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerDecoration: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  decorLine: {
    width: 40,
    height: 1,
    backgroundColor: colors.midnightNavy,
    opacity: 0.3,
  },
  headerTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 32,
    color: colors.midnightNavy,
    fontStyle: 'italic',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.midnightNavy,
    opacity: 0.7,
    marginTop: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    fontStyle: 'italic',
  },
  listContent: {
    paddingBottom: 100,
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    paddingVertical: 48,
    alignItems: 'center',
    paddingHorizontal: 32,
    marginHorizontal: 16,
    backgroundColor: colors.cloudWhite,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.paperBeige,
    borderStyle: 'dashed',
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.paperBeige,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    color: colors.midnightNavy,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    color: colors.stormGray,
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyDecor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
  },
  decorDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.dustyCoral,
  },
  footerLoader: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  footerText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
    fontStyle: 'italic',
  },
});
