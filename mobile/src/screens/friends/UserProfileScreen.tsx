import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Animated,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  FeedCard,
  feedKeyExtractor,
  FollowButton,
  UserAvatar,
  UserProfileSkeleton,
} from '@components/friends';
import { ErrorState } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useBlockUser } from '@hooks/useBlocks';
import { useResponsive } from '@hooks/useResponsive';
import type { FeedItem } from '@hooks/useSocialHome';
import { useUserFeed, getUserFeedItems } from '@hooks/useUserFeed';
import { useUserProfile } from '@hooks/useUserProfile';
import type { FriendsStackScreenProps } from '@navigation/types';

// Animated stat box component matching passport style
interface ProfileStatBoxProps {
  value: string | number;
  label: string;
  backgroundColor: string;
  textColor?: string;
  labelColor?: string;
  index: number;
  show: boolean;
}

function ProfileStatBox({
  value,
  label,
  backgroundColor,
  textColor = colors.midnightNavy,
  labelColor,
  index,
  show,
}: ProfileStatBoxProps) {
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (show) {
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        tension: 50,
        delay: index * 100,
        useNativeDriver: true,
      }).start();
    }
  }, [show, index, scaleAnim]);

  return (
    <Animated.View
      style={[
        styles.statBox,
        {
          backgroundColor,
          transform: [{ scale: scaleAnim }],
          opacity: scaleAnim,
        },
      ]}
    >
      <Text style={[styles.statValue, { color: textColor }]}>{value}</Text>
      <Text
        style={[
          styles.statLabel,
          labelColor ? { color: labelColor } : { color: textColor, opacity: 0.7 },
        ]}
      >
        {label}
      </Text>
    </Animated.View>
  );
}

type Props = FriendsStackScreenProps<'UserProfile'>;

export function UserProfileScreen({ navigation, route }: Props) {
  const { userId, username } = route.params;
  const insets = useSafeAreaInsets();
  const { isTablet, screenWidth } = useResponsive();
  const [isBlocking, setIsBlocking] = useState(false);

  // On iPad, constrain feed cards to 75% width centered
  const feedCardPaddingHorizontal = isTablet ? (screenWidth * 0.25) / 2 : 0;

  const { data: profile, isLoading, error, refetch } = useUserProfile(username);

  // Universal links (/u/:username, U7) provide no userId; resolve it from
  // the fetched profile. Hooks below no-op until it is known.
  const resolvedUserId = userId ?? profile?.user_id ?? '';
  const blockMutation = useBlockUser(resolvedUserId, username);

  const {
    data: feedData,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useUserFeed(resolvedUserId);

  const feedItems = useMemo(() => getUserFeedItems(feedData), [feedData]);

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const confirmBlock = useCallback(async () => {
    if (!profile || isBlocking) return;

    setIsBlocking(true);
    try {
      await blockMutation.mutateAsync();
      Alert.alert(
        'User Blocked',
        `@${profile.username} has been blocked. They will no longer be able to see your profile or follow you.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch {
      setIsBlocking(false);
    }
  }, [profile, isBlocking, blockMutation, navigation]);

  const handleBlock = useCallback(() => {
    if (!profile) return;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Block User', 'Report User'],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 0,
          title: `@${profile.username}`,
          message:
            'Blocking will remove them from your followers and prevent them from seeing your profile.',
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {
            confirmBlock();
          } else if (buttonIndex === 2) {
            Alert.alert('Coming Soon', 'Reporting will be available in a future update.');
          }
        }
      );
    } else {
      Alert.alert(
        `Block @${profile.username}?`,
        'Blocking will remove them from your followers and prevent them from seeing your profile.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Block', style: 'destructive', onPress: confirmBlock },
        ]
      );
    }
  }, [profile, confirmBlock]);

  const handleCountryPress = useCallback(
    (countryCode: string, countryName: string) => {
      const tabNavigator = navigation.getParent();
      if (tabNavigator) {
        tabNavigator.navigate('Passport', {
          screen: 'CountryDetail',
          params: { countryId: countryCode, countryName, countryCode },
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

  const renderFeedItem = useCallback(
    ({ item }: { item: FeedItem }) => (
      <View style={isTablet && { paddingHorizontal: feedCardPaddingHorizontal }}>
        <FeedCard item={item} onCountryPress={handleCountryPress} onEntryPress={handleEntryPress} />
      </View>
    ),
    [handleCountryPress, handleEntryPress, isTablet, feedCardPaddingHorizontal]
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color={colors.midnightNavy} />
          </TouchableOpacity>
          <View style={styles.headerRight} />
        </View>
        <UserProfileSkeleton />
      </View>
    );
  }

  if (error || !profile) {
    const isNotFound =
      (error as { response?: { status?: number } } | null)?.response?.status === 404;
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color={colors.midnightNavy} />
          </TouchableOpacity>
          <View style={styles.headerRight} />
        </View>
        {isNotFound ? (
          <View style={styles.errorContainer}>
            <View style={styles.errorIconContainer}>
              <Ionicons name="compass-outline" size={48} color={colors.dustyCoral} />
            </View>
            <Text style={styles.errorTitle}>Trail gone cold</Text>
            <Text style={styles.errorSubtitle}>
              This traveler may have moved on,{'\n'}or perhaps they prefer solitude
            </Text>
          </View>
        ) : (
          <ErrorState
            title="Couldn't load this traveler"
            message="Something went wrong loading their profile."
            onRetry={() => refetch()}
          />
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color={colors.midnightNavy} />
          </TouchableOpacity>
          <Text style={styles.headerUsername}>@{profile.username}</Text>
        </View>
        <TouchableOpacity style={styles.moreButton} onPress={handleBlock}>
          <Ionicons name="ellipsis-horizontal" size={24} color={colors.midnightNavy} />
        </TouchableOpacity>
      </View>

      <FlashList
        data={feedItems}
        renderItem={renderFeedItem}
        keyExtractor={feedKeyExtractor}
        ListHeaderComponent={
          <>
            {/* Avatar and Identity */}
            <View style={styles.profileHeader}>
              <View style={styles.profileRow}>
                <View style={styles.avatarRing}>
                  <UserAvatar
                    avatarUrl={profile.avatar_url}
                    username={profile.username}
                    size={60}
                  />
                </View>
                <View style={styles.profileInfo}>
                  <Text style={styles.displayName}>{profile.display_name}</Text>
                  <View style={styles.actionRow}>
                    <FollowButton
                      userId={profile.user_id}
                      username={profile.username}
                      isFollowing={profile.is_following}
                    />
                  </View>
                </View>
              </View>
            </View>

            {/* Stats Grid - Passport Style */}
            <View style={styles.statsGrid}>
              <ProfileStatBox
                value={profile.country_count}
                label="COUNTRIES"
                backgroundColor={colors.adobeBrick}
                textColor={colors.cloudWhite}
                labelColor="rgba(255,255,255,0.8)"
                index={0}
                show={true}
              />
              <ProfileStatBox
                value={profile.follower_count}
                label="FOLLOWERS"
                backgroundColor={colors.sunsetGold}
                textColor={colors.midnightNavy}
                labelColor={colors.midnightNavy}
                index={1}
                show={true}
              />
              <ProfileStatBox
                value={profile.following_count}
                label="FOLLOWING"
                backgroundColor={colors.dustyCoral}
                textColor={colors.midnightNavy}
                labelColor={colors.midnightNavy}
                index={2}
                show={true}
              />
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIconContainer}>
              <Ionicons name="journal-outline" size={40} color={colors.dustyCoral} />
            </View>
            <Text style={styles.emptyTitle}>No stories yet</Text>
            <Text style={styles.emptySubtitle}>
              This traveler hasn&apos;t shared{'\n'}any adventures yet
            </Text>
          </View>
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator size="small" color={colors.adobeBrick} />
              <Text style={styles.footerText}>Loading more...</Text>
            </View>
          ) : null
        }
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
    paddingHorizontal: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerUsername: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.paperBeige,
    borderRadius: 20,
  },
  headerRight: {
    width: 40,
  },
  moreButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.paperBeige,
    borderRadius: 20,
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
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  errorIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.paperBeige,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  errorTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    color: colors.midnightNavy,
    marginBottom: 8,
  },
  errorSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    color: colors.stormGray,
    textAlign: 'center',
    lineHeight: 22,
  },
  contentContainer: {
    paddingBottom: 100,
  },
  profileHeader: {
    paddingTop: 8,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarRing: {
    padding: 3,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: colors.sunsetGold,
    borderStyle: 'dashed',
  },
  profileInfo: {
    marginLeft: 16,
    flex: 1,
  },
  displayName: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    color: colors.midnightNavy,
    fontStyle: 'italic',
  },
  actionRow: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  statsGrid: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 24,
    gap: 12,
  },
  statBox: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statValue: {
    fontFamily: fonts.openSans.bold,
    fontSize: 22,
    marginBottom: 4,
  },
  statLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: colors.cloudWhite,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.paperBeige,
    borderStyle: 'dashed',
  },
  emptyIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.paperBeige,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    textAlign: 'center',
    lineHeight: 20,
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
