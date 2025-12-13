import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import {
  REGIONS,
  SUBREGIONS,
  RECOGNITION_GROUP_LABELS,
  type Region,
  type RecognitionGroup,
} from '@constants/regions';
import { countActiveFilters, type ExploreFilters, type CountryStatus } from '../../types/filters';
import { Chip } from './Chip';
import { Text } from './Text';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.75;
const DISMISS_THRESHOLD = 100;

interface ExploreFilterSheetProps {
  visible: boolean;
  filters: ExploreFilters;
  onFiltersChange: (filters: ExploreFilters) => void;
  onClose: () => void;
  onClearAll: () => void;
  onApply: () => void;
  showStatusSection?: boolean;
}

const STATUS_OPTIONS: { value: CountryStatus; label: string }[] = [
  { value: 'visited', label: 'Visited' },
  { value: 'dream', label: 'Dream' },
  { value: 'not_visited', label: 'Not Visited' },
];

export function ExploreFilterSheet({
  visible,
  filters,
  onFiltersChange,
  onClose,
  onClearAll,
  onApply,
  showStatusSection = true,
}: ExploreFilterSheetProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

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
    ]).start(() => onClose());
  }, [translateY, backdropOpacity, onClose]);

  // Pan gesture for drag-to-dismiss
  const panResponder = useRef(
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
    })
  ).current;

  // Toggle handlers
  const toggleStatus = useCallback(
    (status: CountryStatus) => {
      Haptics.selectionAsync();
      const newStatus = filters.status.includes(status)
        ? filters.status.filter((s) => s !== status)
        : [...filters.status, status];
      onFiltersChange({ ...filters, status: newStatus });
    },
    [filters, onFiltersChange]
  );

  const toggleContinent = useCallback(
    (continent: string) => {
      Haptics.selectionAsync();
      const newContinents = filters.continents.includes(continent)
        ? filters.continents.filter((c) => c !== continent)
        : [...filters.continents, continent];
      onFiltersChange({ ...filters, continents: newContinents });
    },
    [filters, onFiltersChange]
  );

  const toggleSubregion = useCallback(
    (subregion: string) => {
      Haptics.selectionAsync();
      const newSubregions = filters.subregions.includes(subregion)
        ? filters.subregions.filter((s) => s !== subregion)
        : [...filters.subregions, subregion];
      onFiltersChange({ ...filters, subregions: newSubregions });
    },
    [filters, onFiltersChange]
  );

  const toggleRecognition = useCallback(
    (group: RecognitionGroup) => {
      Haptics.selectionAsync();
      const newGroups = filters.recognitionGroups.includes(group)
        ? filters.recognitionGroups.filter((g) => g !== group)
        : [...filters.recognitionGroups, group];
      onFiltersChange({ ...filters, recognitionGroups: newGroups });
    },
    [filters, onFiltersChange]
  );

  // Active filter count (exclude status if not showing status section)
  const activeFilterCount = showStatusSection
    ? countActiveFilters(filters)
    : countActiveFilters(filters) - filters.status.length;

  // Handle apply button press - run close animation then call onApply
  // Note: We don't call closeSheet() here because it would call onClose(),
  // and if onApply === onClose, that would cause a double-close.
  const handleApply = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
    ]).start(() => onApply());
  }, [translateY, backdropOpacity, onApply]);

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
          {/* Solid background to prevent content showing through */}
          <View style={[styles.solidBackground, { paddingBottom: insets.bottom }]}>
            {/* Handle bar */}
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>

            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Explore Filters</Text>
              {activeFilterCount > 0 && (
                <TouchableOpacity onPress={onClearAll} style={styles.clearButton}>
                  <Text style={styles.clearButtonText}>Clear All</Text>
                </TouchableOpacity>
              )}
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false} bounces={false}>
              {/* Status Section - Only shown when showStatusSection is true */}
              {showStatusSection && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Status</Text>
                  <View style={styles.chipRow}>
                    {STATUS_OPTIONS.map(({ value, label }) => (
                      <Chip
                        key={value}
                        label={label}
                        selected={filters.status.includes(value)}
                        onPress={() => toggleStatus(value)}
                      />
                    ))}
                  </View>
                </View>
              )}

              {/* Continent Section */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Continent</Text>
                <View style={styles.chipRow}>
                  {REGIONS.map((region) => (
                    <Chip
                      key={region}
                      label={region}
                      selected={filters.continents.includes(region)}
                      onPress={() => toggleContinent(region)}
                    />
                  ))}
                </View>
              </View>

              {/* Subregion Section - Grouped by Continent */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Subregion</Text>
                {REGIONS.map((region) => (
                  <View key={region} style={styles.subregionGroup}>
                    <Text style={styles.subregionGroupTitle}>{region}</Text>
                    <View style={styles.chipRow}>
                      {SUBREGIONS[region as Region].map((subregion) => (
                        <Chip
                          key={subregion}
                          label={subregion}
                          selected={filters.subregions.includes(subregion)}
                          onPress={() => toggleSubregion(subregion)}
                        />
                      ))}
                    </View>
                  </View>
                ))}
              </View>

              {/* Recognition Section */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Recognition</Text>
                <View style={styles.chipRow}>
                  {RECOGNITION_GROUP_LABELS.map((group) => (
                    <Chip
                      key={group}
                      label={group}
                      selected={filters.recognitionGroups.includes(group)}
                      onPress={() => toggleRecognition(group)}
                    />
                  ))}
                </View>
              </View>

              {/* Bottom padding for scroll to account for apply button */}
              <View style={{ height: 80 }} />
            </ScrollView>

            {/* Apply Button - Fixed at bottom */}
            <View style={styles.applyButtonContainer}>
              <TouchableOpacity
                style={styles.applyButton}
                onPress={handleApply}
                activeOpacity={0.8}
              >
                <Text style={styles.applyButtonText}>Apply Filters</Text>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  clearButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  clearButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.adobeBrick,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  subregionGroup: {
    marginBottom: 16,
  },
  subregionGroupTitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
    marginBottom: 8,
  },
  applyButtonContainer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(23, 42, 58, 0.1)',
    backgroundColor: colors.warmCream,
  },
  applyButton: {
    backgroundColor: colors.mossGreen,
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
  applyButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.cloudWhite,
    letterSpacing: 0.5,
  },
});
