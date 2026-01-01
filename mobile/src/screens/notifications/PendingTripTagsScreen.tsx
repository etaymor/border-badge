import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UserAvatar } from '@components/friends/UserAvatar';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import {
  PendingTripTag,
  useApproveTripTag,
  useDeclineTripTag,
  usePendingTripTags,
} from '@hooks/useTripTags';
import { getFlagEmoji } from '@utils/flags';

interface PendingTripTagsScreenProps {
  onBack: () => void;
}

/**
 * Screen showing pending trip tag invitations.
 * Users can accept or decline invitations from here.
 */
export function PendingTripTagsScreen({ onBack }: PendingTripTagsScreenProps) {
  const insets = useSafeAreaInsets();
  const { data: pendingTags, isLoading, isRefetching, refetch } = usePendingTripTags();
  const approveMutation = useApproveTripTag();
  const declineMutation = useDeclineTripTag();

  const handleApprove = useCallback(
    (tripId: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      approveMutation.mutate(tripId, {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        },
      });
    },
    [approveMutation]
  );

  const handleDecline = useCallback(
    (tripId: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      declineMutation.mutate(tripId);
    },
    [declineMutation]
  );

  const formatTimeAgo = useCallback((dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return `${Math.floor(diffDays / 30)} months ago`;
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: PendingTripTag }) => {
      const flagEmoji = getFlagEmoji(item.trip_country_code);
      const isActionPending =
        (approveMutation.isPending && approveMutation.variables === item.trip_id) ||
        (declineMutation.isPending && declineMutation.variables === item.trip_id);

      return (
        <View style={styles.card}>
          {/* Trip Info */}
          <View style={styles.tripRow}>
            <Text style={styles.flagEmoji}>{flagEmoji}</Text>
            <View style={styles.tripInfo}>
              <Text style={styles.tripName} numberOfLines={1}>
                {item.trip_name}
              </Text>
              <Text style={styles.timeAgo}>{formatTimeAgo(item.created_at)}</Text>
            </View>
          </View>

          {/* Initiator Info */}
          {item.initiated_by_username && (
            <View style={styles.initiatorRow}>
              <UserAvatar
                avatarUrl={item.initiated_by_avatar_url}
                username={item.initiated_by_username}
                size={28}
              />
              <Text style={styles.initiatorText}>
                From <Text style={styles.username}>@{item.initiated_by_username}</Text>
              </Text>
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.declineButton, isActionPending && styles.buttonDisabled]}
              onPress={() => handleDecline(item.trip_id)}
              disabled={isActionPending}
              activeOpacity={0.7}
            >
              {declineMutation.isPending && declineMutation.variables === item.trip_id ? (
                <ActivityIndicator size="small" color={colors.stormGray} />
              ) : (
                <>
                  <Ionicons name="close" size={16} color={colors.stormGray} />
                  <Text style={styles.declineText}>Decline</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.acceptButton, isActionPending && styles.buttonDisabled]}
              onPress={() => handleApprove(item.trip_id)}
              disabled={isActionPending}
              activeOpacity={0.7}
            >
              {approveMutation.isPending && approveMutation.variables === item.trip_id ? (
                <ActivityIndicator size="small" color={colors.cloudWhite} />
              ) : (
                <>
                  <Ionicons name="checkmark" size={16} color={colors.cloudWhite} />
                  <Text style={styles.acceptText}>Accept</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [approveMutation, declineMutation, formatTimeAgo, handleApprove, handleDecline]
  );

  const ListEmpty = useMemo(
    () => (
      <View style={styles.emptyState}>
        <View style={styles.emptyIconContainer}>
          <Text style={styles.emptyEmoji}>✈️</Text>
        </View>
        <Text style={styles.emptyTitle}>No trip invitations</Text>
        <Text style={styles.emptySubtitle}>
          When friends tag you on their trips,{'\n'}you&apos;ll see invitations here.
        </Text>
      </View>
    ),
    []
  );

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={onBack}>
            <Ionicons name="arrow-back" size={24} color={colors.midnightNavy} />
          </Pressable>
          <Text style={styles.headerTitle}>Trip Invitations</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.adobeBrick} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={24} color={colors.midnightNavy} />
        </Pressable>
        <Text style={styles.headerTitle}>Trip Invitations</Text>
        <View style={styles.headerRight} />
      </View>

      {/* List */}
      <FlatList
        data={pendingTags ?? []}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={ListEmpty}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.adobeBrick}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.paperBeige,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    fontStyle: 'italic',
  },
  headerRight: {
    width: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
    flexGrow: 1,
  },
  card: {
    backgroundColor: colors.cloudWhite,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.paperBeige,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  flagEmoji: {
    fontSize: 32,
    marginRight: 12,
  },
  tripInfo: {
    flex: 1,
  },
  tripName: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 17,
    color: colors.midnightNavy,
    marginBottom: 2,
  },
  timeAgo: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
  },
  initiatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingLeft: 4,
  },
  initiatorText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    marginLeft: 10,
  },
  username: {
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  declineButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paperBeige,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 6,
  },
  declineText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.stormGray,
  },
  acceptButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.mossGreen,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 6,
  },
  acceptText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.cloudWhite,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 60,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.paperBeige,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyEmoji: {
    fontSize: 36,
  },
  emptyTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    color: colors.midnightNavy,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    color: colors.stormGray,
    textAlign: 'center',
    lineHeight: 22,
  },
});
