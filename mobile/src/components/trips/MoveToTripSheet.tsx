/**
 * MoveToTripSheet - Bottom sheet for moving entries to a different trip.
 * Used in SavedPlacesScreen to organize uncategorized entries.
 */

import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTrips, useMoveEntry, useBulkMoveEntries, Trip } from '@hooks/useTrips';
import type { TripsStackParamList } from '@navigation/types';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { getFlagEmoji } from '@utils/flags';

const { height: SCREEN_HEIGHT } = Dimensions.get('screen');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.65;
const DISMISS_THRESHOLD = 100;

interface MoveToTripSheetProps {
  visible: boolean;
  entryIds: string[];
  onComplete: () => void;
  onCancel: () => void;
  /** Optional callback when user wants to create a new trip. If not provided, navigates to TripForm. */
  onCreateNewTrip?: () => void;
}

export function MoveToTripSheet({
  visible,
  entryIds,
  onComplete,
  onCancel,
  onCreateNewTrip,
}: MoveToTripSheetProps) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<TripsStackParamList>>();
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const { data: trips = [], isLoading: isLoadingTrips } = useTrips();
  const moveEntry = useMoveEntry();
  const bulkMoveEntries = useBulkMoveEntries();

  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  const isBulkMove = entryIds.length > 1;

  // Filter out system trips
  const regularTrips = useMemo(() => {
    return trips.filter((trip) => !trip.is_system);
  }, [trips]);

  // Group trips by country (most recent first)
  const sortedTrips = useMemo(() => {
    return [...regularTrips].sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [regularTrips]);

  // Animation handlers
  const openSheet = useCallback(() => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        friction: 8,
        tension: 65,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [translateY, backdropOpacity]);

  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  const closeSheet = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: SHEET_HEIGHT,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => onCancelRef.current());
  }, [translateY, backdropOpacity]);

  // Pan gesture for drag-to-dismiss
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 10,
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dy > 0) {
            translateY.setValue(gestureState.dy);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > DISMISS_THRESHOLD) {
            closeSheet();
          } else {
            Animated.spring(translateY, {
              toValue: 0,
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    [translateY, closeSheet]
  );

  // Handle move action
  const handleMove = useCallback(async () => {
    if (!selectedTripId || entryIds.length === 0) return;

    setIsMoving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    try {
      if (isBulkMove) {
        await bulkMoveEntries.mutateAsync({
          entryIds,
          targetTripId: selectedTripId,
        });
      } else {
        await moveEntry.mutateAsync({
          entryId: entryIds[0],
          tripId: selectedTripId,
        });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

      // Close sheet and notify parent
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: SHEET_HEIGHT,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setIsMoving(false);
        setSelectedTripId(null);
        onComplete();
      });
    } catch (error) {
      setIsMoving(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});

      // Show user-friendly error message
      const message =
        error instanceof Error ? error.message : 'Failed to move places. Please try again.';
      Alert.alert('Move Failed', message);
    }
  }, [
    selectedTripId,
    entryIds,
    isBulkMove,
    bulkMoveEntries,
    moveEntry,
    translateY,
    backdropOpacity,
    onComplete,
  ]);

  const handleTripSelect = useCallback((trip: Trip) => {
    Haptics.selectionAsync().catch(() => {});
    setSelectedTripId(trip.id);
  }, []);

  const handleCreateNewTrip = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // Close the sheet first
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: SHEET_HEIGHT,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onCancel();
      // Use callback if provided, otherwise navigate directly
      if (onCreateNewTrip) {
        onCreateNewTrip();
      } else {
        navigation.navigate('TripForm', {});
      }
    });
  }, [translateY, backdropOpacity, onCancel, onCreateNewTrip, navigation]);

  // Open animation on visible change
  useEffect(() => {
    if (visible) {
      setSelectedTripId(null);
      openSheet();
    }
  }, [visible, openSheet]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={closeSheet}
      statusBarTranslucent
    >
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} />
      </Animated.View>

      {/* Bottom Sheet */}
      <Animated.View
        style={[
          styles.sheetContainer,
          {
            transform: [{ translateY }],
          },
        ]}
        {...panResponder.panHandlers}
      >
        <BlurView intensity={80} tint="light" style={styles.blurContainer}>
          <View style={[styles.solidBackground, { paddingBottom: insets.bottom }]}>
            {/* Handle bar */}
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>

            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Move to Trip</Text>
              <Text style={styles.headerSubtitle}>
                {entryIds.length} {entryIds.length === 1 ? 'place' : 'places'} selected
              </Text>
            </View>

            {/* Trip List */}
            {isLoadingTrips ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.sunsetGold} />
              </View>
            ) : sortedTrips.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  No trips available. Create a trip first to organize your saved places.
                </Text>
                <TouchableOpacity
                  style={styles.emptyCreateTripButton}
                  activeOpacity={0.7}
                  onPress={handleCreateNewTrip}
                >
                  <View style={styles.createTripIcon}>
                    <Ionicons name="add" size={20} color={colors.white} />
                  </View>
                  <Text style={styles.createTripText}>Create New Trip</Text>
                  <Ionicons name="chevron-forward" size={20} color={colors.stormGray} />
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView
                style={styles.content}
                showsVerticalScrollIndicator={false}
                bounces={false}
              >
                {/* Create New Trip Button */}
                <TouchableOpacity
                  style={styles.createTripButton}
                  activeOpacity={0.7}
                  onPress={handleCreateNewTrip}
                >
                  <View style={styles.createTripIcon}>
                    <Ionicons name="add" size={20} color={colors.white} />
                  </View>
                  <Text style={styles.createTripText}>Create New Trip</Text>
                  <Ionicons name="chevron-forward" size={20} color={colors.stormGray} />
                </TouchableOpacity>

                {/* Recent Trips */}
                <Text style={styles.sectionTitle}>Your Trips</Text>
                {sortedTrips.map((trip) => (
                  <TouchableOpacity
                    key={trip.id}
                    style={[styles.tripItem, selectedTripId === trip.id && styles.tripItemSelected]}
                    onPress={() => handleTripSelect(trip)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.tripItemContent}>
                      {trip.country_code && (
                        <Text style={styles.tripFlag}>{getFlagEmoji(trip.country_code)}</Text>
                      )}
                      <Text
                        style={[
                          styles.tripName,
                          selectedTripId === trip.id && styles.tripNameSelected,
                        ]}
                        numberOfLines={1}
                      >
                        {trip.name}
                      </Text>
                    </View>
                    {selectedTripId === trip.id && (
                      <Ionicons name="checkmark-circle" size={24} color={colors.mossGreen} />
                    )}
                  </TouchableOpacity>
                ))}

                {/* Bottom padding */}
                <View style={{ height: 80 }} />
              </ScrollView>
            )}

            {/* Move Button */}
            <View style={styles.moveButtonContainer}>
              <TouchableOpacity
                style={[styles.moveButton, !selectedTripId && styles.moveButtonDisabled]}
                onPress={handleMove}
                disabled={!selectedTripId || isMoving}
                activeOpacity={0.8}
              >
                {isMoving ? (
                  <ActivityIndicator size="small" color={colors.midnightNavy} />
                ) : (
                  <Text style={styles.moveButtonText}>
                    Move {entryIds.length === 1 ? 'Place' : `${entryIds.length} Places`}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </BlurView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(23, 42, 58, 0.5)',
  },
  sheetContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_HEIGHT,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  blurContainer: {
    flex: 1,
  },
  solidBackground: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.stormGray,
    opacity: 0.4,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(23, 42, 58, 0.1)',
  },
  headerTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    color: colors.midnightNavy,
  },
  headerSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    marginTop: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.stormGray,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
  },
  emptyCreateTripButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(244, 194, 78, 0.15)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.sunsetGold,
    borderStyle: 'dashed',
    width: '100%',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  createTripButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(244, 194, 78, 0.15)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.sunsetGold,
    borderStyle: 'dashed',
  },
  createTripIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.sunsetGold,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  createTripText: {
    flex: 1,
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  sectionTitle: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 12,
    color: colors.stormGray,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  tripItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  tripItemSelected: {
    backgroundColor: 'rgba(84, 122, 95, 0.15)',
    borderColor: colors.mossGreen,
  },
  tripItemContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tripFlag: {
    fontSize: 24,
  },
  tripName: {
    flex: 1,
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  tripNameSelected: {
    color: colors.mossGreen,
  },
  moveButtonContainer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(23, 42, 58, 0.1)',
    backgroundColor: colors.warmCream,
  },
  moveButton: {
    backgroundColor: colors.sunsetGold,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  moveButtonDisabled: {
    backgroundColor: 'rgba(244, 194, 78, 0.5)',
  },
  moveButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
    letterSpacing: 0.5,
  },
});
