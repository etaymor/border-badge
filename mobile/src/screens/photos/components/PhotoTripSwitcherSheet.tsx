/**
 * PhotoTripSwitcherSheet - Bottom sheet for switching between photo trips.
 * Used when a user has multiple photo trips for the same country and wants
 * to get suggestions from a different trip's photos.
 */

import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { TripCandidateDisplay } from '@services/photoImport';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

const { height: SCREEN_HEIGHT } = Dimensions.get('screen');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.5;
const DISMISS_THRESHOLD = 100;

export interface PhotoTripSwitcherSheetProps {
  visible: boolean;
  candidates: TripCandidateDisplay[];
  selectedCandidate: TripCandidateDisplay | null;
  onSelectCandidate: (candidate: TripCandidateDisplay) => void;
  onClose: () => void;
}

/**
 * Format date range for display (e.g., "Dec 15 - 22, 2022")
 */
const formatDateRange = (start: Date, end: Date): string => {
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = start.getMonth() === end.getMonth();

  const startStr = start.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

  if (sameMonth && sameYear) {
    // Same month: "Dec 15 - 22, 2022"
    const endStr = end.toLocaleDateString(undefined, {
      day: 'numeric',
      year: 'numeric',
    });
    return `${startStr} - ${endStr}`;
  }

  if (sameYear) {
    // Different months, same year: "Nov 28 - Dec 5, 2022"
    const endStr = end.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `${startStr} - ${endStr}`;
  }

  // Different years: "Dec 28, 2021 - Jan 5, 2022"
  const startWithYear = start.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const endWithYear = end.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${startWithYear} - ${endWithYear}`;
};

export function PhotoTripSwitcherSheet({
  visible,
  candidates,
  selectedCandidate,
  onSelectCandidate,
  onClose,
}: PhotoTripSwitcherSheetProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // Sort candidates by date (most recent first)
  const sortedCandidates = useMemo(() => {
    return [...candidates].sort((a, b) => b.dateRange.end.getTime() - a.dateRange.end.getTime());
  }, [candidates]);

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

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

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
    ]).start(() => onCloseRef.current());
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

  const handleSelect = useCallback(
    (candidate: TripCandidateDisplay) => {
      // Don't do anything if selecting the already-selected candidate
      if (candidate.id === selectedCandidate?.id) {
        closeSheet();
        return;
      }

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

      // Close sheet first, then trigger selection
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
        onSelectCandidate(candidate);
      });
    },
    [selectedCandidate, translateY, backdropOpacity, onSelectCandidate, closeSheet]
  );

  // Open animation on visible change
  useEffect(() => {
    if (visible) {
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
              <Text style={styles.headerTitle}>Switch Photo Trip</Text>
              <Text style={styles.headerSubtitle}>
                {candidates.length} trip{candidates.length !== 1 ? 's' : ''} available
              </Text>
            </View>

            {/* Trip List */}
            <ScrollView style={styles.content} showsVerticalScrollIndicator={false} bounces={false}>
              {sortedCandidates.map((candidate) => {
                const isSelected = candidate.id === selectedCandidate?.id;
                return (
                  <TouchableOpacity
                    key={candidate.id}
                    style={[styles.tripItem, isSelected && styles.tripItemSelected]}
                    onPress={() => handleSelect(candidate)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.tripItemContent}>
                      <Text style={[styles.tripDates, isSelected && styles.tripDatesSelected]}>
                        {formatDateRange(candidate.dateRange.start, candidate.dateRange.end)}
                      </Text>
                      <Text style={styles.tripMeta}>
                        {candidate.photoCount} photo{candidate.photoCount !== 1 ? 's' : ''} ·{' '}
                        {candidate.locationClusterIds.length} location
                        {candidate.locationClusterIds.length !== 1 ? 's' : ''}
                      </Text>
                    </View>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={24} color={colors.mossGreen} />
                    )}
                  </TouchableOpacity>
                );
              })}

              {/* Bottom padding */}
              <View style={{ height: 40 }} />
            </ScrollView>
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
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
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
  },
  tripDates: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
    marginBottom: 2,
  },
  tripDatesSelected: {
    color: colors.mossGreen,
  },
  tripMeta: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
  },
});
