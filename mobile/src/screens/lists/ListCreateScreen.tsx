import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Platform,
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

// Entry type display configuration - Icon-only tinted pills
const ENTRY_TYPE_CONFIG: Record<
  string,
  { icon: keyof typeof Ionicons.glyphMap; color: string; bgTint: string }
> = {
  place: {
    icon: 'location-outline',
    color: colors.midnightNavy,
    bgTint: 'rgba(23, 42, 58, 0.08)',
  },
  food: {
    icon: 'restaurant-outline',
    color: '#D4A373', // Latte gold
    bgTint: 'rgba(212, 163, 115, 0.15)',
  },
  stay: {
    icon: 'bed-outline',
    color: '#8D99AE', // Slate blue
    bgTint: 'rgba(141, 153, 174, 0.15)',
  },
  experience: {
    icon: 'sparkles-outline',
    color: '#6B705C', // Olive
    bgTint: 'rgba(107, 112, 92, 0.15)',
  },
};

interface EntrySelectionItemProps {
  entry: EntryWithPlace;
  selected: boolean;
  onToggle: () => void;
  isLast: boolean;
}

function EntrySelectionItem({ entry, selected, onToggle, isLast }: EntrySelectionItemProps) {
  const checkboxScale = useRef(new Animated.Value(1)).current;
  const typeConfig = ENTRY_TYPE_CONFIG[entry.entry_type] || ENTRY_TYPE_CONFIG.place;

  const handleToggle = () => {
    // Bounce animation
    Animated.sequence([
      Animated.spring(checkboxScale, {
        toValue: 1.15,
        friction: 3,
        tension: 200,
        useNativeDriver: true,
      }),
      Animated.spring(checkboxScale, {
        toValue: 1,
        friction: 5,
        tension: 100,
        useNativeDriver: true,
      }),
    ]).start();
    onToggle();
  };

  return (
    <View>
      <Pressable
        style={[styles.entryItem, selected && styles.entryItemSelected]}
        onPress={handleToggle}
      >
        {/* Checkbox with scale animation */}
        <Animated.View
          style={[styles.checkboxContainer, { transform: [{ scale: checkboxScale }] }]}
        >
          <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
            {selected && <Ionicons name="checkmark" size={14} color={colors.white} />}
          </View>
        </Animated.View>

        {/* Entry Info */}
        <View style={styles.entryContent}>
          <Text style={styles.entryTitle} numberOfLines={2}>
            {entry.title}
          </Text>
        </View>

        {/* Entry Type Icon Pill */}
        <View style={[styles.typeChip, { backgroundColor: typeConfig.bgTint }]}>
          <Ionicons name={typeConfig.icon} size={16} color={typeConfig.color} />
        </View>
      </Pressable>
      {!isLast && <View style={styles.separator} />}
    </View>
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
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize selected entries to all entries when loaded
  const effectiveSelectedIds =
    selectedEntryIds ?? (entries ? new Set(entries.map((e) => e.id)) : new Set<string>());
  const [createdList, setCreatedList] = useState<ListDetail | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Toggle entry selection
  const toggleEntry = useCallback(
    (entryId: string) => {
      setSelectedEntryIds((prev) => {
        // Initialize from entries if null
        const current = prev ?? (entries ? new Set(entries.map((e) => e.id)) : new Set<string>());
        const next = new Set(current);
        if (next.has(entryId)) {
          next.delete(entryId);
        } else {
          next.add(entryId);
        }
        return next;
      });
    },
    [entries]
  );

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

    if (effectiveSelectedIds.size === 0) {
      newErrors.entries = 'Select at least one entry';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, effectiveSelectedIds]);

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
          entry_ids: Array.from(effectiveSelectedIds),
        },
      });

      setCreatedList(list);
    } catch {
      Alert.alert('Error', 'Failed to create list. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [validateForm, tripId, name, description, effectiveSelectedIds, createList]);

  // Handle done
  const handleDone = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // Check if all entries are selected
  const allSelected = entries ? effectiveSelectedIds.size === entries.length : false;

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

      {/* Main Content */}
      {entriesLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.midnightNavy} />
          <Text style={styles.loadingText}>Loading entries...</Text>
        </View>
      ) : entries && entries.length > 0 ? (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Form Section */}
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

            {/* Entries Header */}
            <View style={styles.entriesHeader}>
              <Text style={styles.label}>SELECT ENTRIES</Text>
              <Pressable
                onPress={allSelected ? handleClearAll : handleSelectAll}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.actionText}>{allSelected ? 'Clear all' : 'Select all'}</Text>
              </Pressable>
            </View>
            {errors.entries && <Text style={styles.errorText}>{errors.entries}</Text>}
          </View>

          {/* Entry Selection List */}
          <View style={styles.glassWrapper}>
            <View style={styles.glassContainer}>
              <View style={styles.glassInner}>
                {entries.map((entry, index) => (
                  <EntrySelectionItem
                    key={entry.id}
                    entry={entry}
                    selected={effectiveSelectedIds.has(entry.id)}
                    onToggle={() => toggleEntry(entry.id)}
                    isLast={index === entries.length - 1}
                  />
                ))}
              </View>
            </View>
          </View>

          {/* Footer */}
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
            <Button
              title="Create List"
              onPress={handleSubmit}
              loading={isSubmitting}
              disabled={isSubmitting || effectiveSelectedIds.size === 0}
            />
          </View>
        </ScrollView>
      ) : (
        <View style={styles.emptyContainer}>
          <Ionicons name="bookmark-outline" size={48} color={colors.textTertiary} />
          <Text style={styles.emptyText}>No entries in this trip yet</Text>
          <Text style={styles.emptySubtext}>
            Add some entries to your trip first, then create a shareable list
          </Text>
          <View style={styles.backButtonContainer}>
            <Button title="Go Back" onPress={() => navigation.goBack()} variant="outline" />
          </View>
        </View>
      )}
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
    zIndex: 10,
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
  listContent: {
    flexGrow: 1,
  },
  formSection: {
    padding: 24,
    paddingTop: 8,
    paddingBottom: 0,
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
  // Public Status Card
  publicStatusCard: {
    flexDirection: 'row',
    backgroundColor: colors.white, // Pop against cream background
    borderRadius: 20, // Standardized 20px
    padding: 16,
    marginBottom: 32,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  publicStatusIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 198, 54, 0.15)', // Light Gold
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  publicStatusContent: {
    flex: 1,
  },
  publicStatusTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 18,
    color: colors.midnightNavy,
    marginBottom: 4,
  },
  publicStatusDescription: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  // Entries Header
  entriesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  actionText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 13,
    color: colors.sunsetGold,
  },
  // Glass Container for entries
  glassWrapper: {
    paddingHorizontal: 24,
    marginBottom: 8,
  },
  glassContainer: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    ...Platform.select({
      ios: {
        shadowColor: colors.midnightNavy,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  glassInner: {
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(23, 42, 58, 0.06)',
    marginHorizontal: 16,
  },
  // Entry Item
  entryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
  },
  entryItemSelected: {
    backgroundColor: 'rgba(255, 198, 54, 0.06)', // Subtle gold tint
  },
  checkboxContainer: {
    padding: 4,
    marginRight: 14,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11, // Circle
    borderWidth: 2,
    borderColor: 'rgba(23, 42, 58, 0.25)',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
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
    fontFamily: fonts.playfair.bold,
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  typeChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
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
    flex: 1,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 18,
    color: colors.midnightNavy,
    marginTop: 16,
  },
  emptySubtext: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  backButtonContainer: {
    minWidth: 120,
  },
  footer: {
    padding: 24,
    paddingTop: 16,
  },
});
