import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

import type { TripsStackScreenProps } from '@navigation/types';
import type { EntryType } from '@navigation/types';
import {
  useCreateEntry,
  useUpdateEntry,
  useEntry,
  CreateEntryInput,
  PlaceInput,
} from '@hooks/useEntries';
import { useTrip } from '@hooks/useTrips';
import { EntryMediaGallery } from '@components/media';
import { PlacesAutocomplete, SelectedPlace } from '@components/places';
import { GlassBackButton, GlassInput, Button } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { MAX_PHOTOS_PER_ENTRY } from '@services/mediaUpload';

type Props = TripsStackScreenProps<'EntryForm'>;

// Entry type configuration with brand colors
const ENTRY_TYPES: {
  type: EntryType;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  emoji: string;
}[] = [
  { type: 'place', icon: 'location', label: 'Place', color: colors.adobeBrick, emoji: '📍' },
  { type: 'food', icon: 'restaurant', label: 'Food', color: colors.sunsetGold, emoji: '🍽️' },
  { type: 'stay', icon: 'bed', label: 'Stay', color: colors.mossGreen, emoji: '🏨' },
  {
    type: 'experience',
    icon: 'star',
    label: 'Experience',
    color: colors.midnightNavy,
    emoji: '✨',
  },
];

// Animated category button component
function CategoryButton({
  item,
  isSelected,
  onPress,
  index,
}: {
  item: (typeof ENTRY_TYPES)[0];
  isSelected: boolean;
  onPress: () => void;
  index: number;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Stagger entrance animation
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      delay: index * 80,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim, index]);

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      tension: 100,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View
      style={[
        styles.categoryButtonWrapper,
        {
          opacity: fadeAnim,
          transform: [
            { scale: scaleAnim },
            {
              translateY: fadeAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [20, 0],
              }),
            },
          ],
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        testID={`entry-type-${item.type}`}
      >
        <View style={styles.categoryButtonOuter}>
          <BlurView
            intensity={isSelected ? 50 : 30}
            tint="light"
            style={[
              styles.categoryButton,
              isSelected && {
                backgroundColor: `${item.color}15`,
              },
            ]}
          >
            <View
              style={[
                styles.categoryIconContainer,
                isSelected && { backgroundColor: `${item.color}20` },
              ]}
            >
              <Ionicons
                name={item.icon}
                size={22}
                color={isSelected ? item.color : colors.textSecondary}
              />
            </View>
            <Text
              style={[
                styles.categoryLabel,
                isSelected && { color: item.color, fontFamily: fonts.openSans.semiBold },
              ]}
            >
              {item.label}
            </Text>
            {isSelected && (
              <View style={[styles.selectedIndicator, { backgroundColor: item.color }]} />
            )}
          </BlurView>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export function EntryFormScreen({ route, navigation }: Props) {
  const { tripId, entryId, entryType: initialEntryType } = route.params;
  const isEditing = !!entryId;
  const insets = useSafeAreaInsets();

  // Refs
  const scrollViewRef = useRef<ScrollView>(null);

  // Animations
  const formFadeAnim = useRef(new Animated.Value(0)).current;
  const formSlideAnim = useRef(new Animated.Value(30)).current;

  // Fetch existing entry data for editing
  const { data: existingEntry, isLoading: isLoadingEntry } = useEntry(entryId ?? '');
  // Fetch trip to get country code for scoping place search
  const { data: trip } = useTrip(tripId);
  const createEntry = useCreateEntry();
  const updateEntry = useUpdateEntry();

  // Form state
  const [entryType, setEntryType] = useState<EntryType | null>(initialEntryType ?? null);
  const [hasSelectedType, setHasSelectedType] = useState(!!initialEntryType || isEditing);
  const [title, setTitle] = useState('');
  const [link, setLink] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<SelectedPlace | null>(null);
  const [pendingMediaIds, setPendingMediaIds] = useState<string[]>([]);
  const [photoCount, setPhotoCount] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Animate form appearance when type is selected
  useEffect(() => {
    if (hasSelectedType) {
      Animated.parallel([
        Animated.timing(formFadeAnim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.spring(formSlideAnim, {
          toValue: 0,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [hasSelectedType, formFadeAnim, formSlideAnim]);

  // Reset form when navigating to a new entry (different trip or creating new)
  useEffect(() => {
    if (!isEditing) {
      setTitle('');
      setEntryType(initialEntryType ?? null);
      setHasSelectedType(!!initialEntryType);
      setLink('');
      setNotes('');
      setSelectedPlace(null);
      setPendingMediaIds([]);
      setErrors({});
      // Reset animations
      formFadeAnim.setValue(initialEntryType ? 1 : 0);
      formSlideAnim.setValue(initialEntryType ? 0 : 30);
    }
  }, [tripId, entryId, isEditing, initialEntryType, formFadeAnim, formSlideAnim]);

  // Populate form when editing
  useEffect(() => {
    if (existingEntry && isEditing) {
      setTitle(existingEntry.title);
      setEntryType(existingEntry.entry_type as EntryType);
      setHasSelectedType(true);
      setNotes(existingEntry.notes ?? '');
      setLink(existingEntry.link ?? '');
      if (existingEntry.place) {
        setSelectedPlace({
          google_place_id:
            existingEntry.place.google_place_id ?? `existing_${existingEntry.place.id}`,
          name: existingEntry.place.name,
          address: existingEntry.place.address,
          latitude: existingEntry.place.latitude,
          longitude: existingEntry.place.longitude,
        });
      }
      // Set animations to final state for editing
      formFadeAnim.setValue(1);
      formSlideAnim.setValue(0);
    }
  }, [existingEntry, isEditing, formFadeAnim, formSlideAnim]);

  // Simple URL validation
  const isValidUrl = useCallback((url: string): boolean => {
    if (!url.trim()) return true; // Empty is valid (optional field)
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, []);

  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!entryType) {
      newErrors.type = 'Please select an entry type';
    }

    // Place is required for place, food, and stay types
    const requiresPlace = entryType && ['place', 'food', 'stay'].includes(entryType);
    if (requiresPlace && !selectedPlace) {
      newErrors.place = 'Please select or enter a location';
    }

    // Title is only required when no place is selected (for "experience" type)
    if (!selectedPlace && !title.trim()) {
      newErrors.title = 'Name is required';
    }

    // Validate URL if provided
    if (link.trim() && !isValidUrl(link)) {
      newErrors.link = 'Please enter a valid URL';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [title, entryType, selectedPlace, link, isValidUrl]);

  const handleSubmit = useCallback(async () => {
    if (!validateForm() || !entryType) return;

    setIsSubmitting(true);
    try {
      const place: PlaceInput | undefined = selectedPlace
        ? {
            google_place_id: selectedPlace.google_place_id,
            name: selectedPlace.name,
            address: selectedPlace.address,
            latitude: selectedPlace.latitude,
            longitude: selectedPlace.longitude,
          }
        : undefined;

      // Use place name as title when a place is selected, otherwise use the title field
      const entryTitle = selectedPlace ? selectedPlace.name : title.trim();

      if (isEditing && entryId) {
        await updateEntry.mutateAsync({
          entryId,
          data: {
            title: entryTitle,
            entry_type: entryType,
            notes: notes.trim() || undefined,
            link: link.trim() || undefined,
            place,
          },
        });
      } else {
        const entryData: CreateEntryInput = {
          trip_id: tripId,
          title: entryTitle,
          entry_type: entryType,
          notes: notes.trim() || undefined,
          link: link.trim() || undefined,
          place,
          pending_media_ids: pendingMediaIds.length > 0 ? pendingMediaIds : undefined,
        };

        await createEntry.mutateAsync(entryData);
      }

      navigation.goBack();
    } catch {
      Alert.alert(
        'Error',
        isEditing
          ? 'Failed to update entry. Please try again.'
          : 'Failed to create entry. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    validateForm,
    isEditing,
    entryId,
    tripId,
    title,
    entryType,
    link,
    notes,
    selectedPlace,
    pendingMediaIds,
    createEntry,
    updateEntry,
    navigation,
  ]);

  // Handle type selection with animation
  const handleTypeSelect = (type: EntryType) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setEntryType(type);
    if (!hasSelectedType) {
      setHasSelectedType(true);
    }
  };

  // Handle changing the selected type
  const handleChangeType = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setHasSelectedType(false);
    // Reset animations for when they come back
    formFadeAnim.setValue(0);
    formSlideAnim.setValue(30);
  };

  // Scroll to notes field when focused
  const handleNotesFocus = useCallback(() => {
    // Small delay to allow keyboard to appear, then scroll to end
    // since notes and save button are at the bottom of the form
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 150);
  }, []);

  // Get selected type config
  const selectedTypeConfig = entryType ? ENTRY_TYPES.find((t) => t.type === entryType) : null;

  if (isEditing && isLoadingEntry) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.sunsetGold} />
      </View>
    );
  }

  const showPlaceInput = entryType && ['place', 'food', 'stay'].includes(entryType);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Custom Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <GlassBackButton onPress={() => navigation.goBack()} />
          <Text style={styles.headerTitle}>{isEditing ? 'Edit Entry' : 'Add Entry'}</Text>
          <View style={styles.headerSpacer} />
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Subtitle with trip context */}
          <Text style={styles.headerSubtitle}>
            {isEditing
              ? 'Update your memory'
              : trip?.name
                ? `Adding to ${trip.name}`
                : 'What would you like to remember?'}
          </Text>

          {/* Category Selection */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>CATEGORY</Text>
            {hasSelectedType && selectedTypeConfig ? (
              // Selected category display
              <View style={styles.selectedCategoryOuter}>
                <BlurView intensity={40} tint="light" style={styles.selectedCategoryInner}>
                  <View style={styles.selectedCategoryContent}>
                    <View
                      style={[
                        styles.selectedCategoryIconContainer,
                        { backgroundColor: `${selectedTypeConfig.color}20` },
                      ]}
                    >
                      <Ionicons
                        name={selectedTypeConfig.icon}
                        size={24}
                        color={selectedTypeConfig.color}
                      />
                    </View>
                    <Text
                      style={[styles.selectedCategoryLabel, { color: selectedTypeConfig.color }]}
                    >
                      {selectedTypeConfig.label}
                    </Text>
                  </View>
                  <Pressable style={styles.changeButton} onPress={handleChangeType}>
                    <Ionicons name="swap-horizontal" size={16} color={colors.midnightNavy} />
                    <Text style={styles.changeButtonText}>Change</Text>
                  </Pressable>
                </BlurView>
              </View>
            ) : (
              // Category grid
              <View style={styles.categoryGrid}>
                {ENTRY_TYPES.map((item, index) => (
                  <CategoryButton
                    key={item.type}
                    item={item}
                    isSelected={entryType === item.type}
                    onPress={() => handleTypeSelect(item.type)}
                    index={index}
                  />
                ))}
              </View>
            )}
          </View>

          {/* Animated form fields */}
          {hasSelectedType && (
            <Animated.View
              style={{
                opacity: formFadeAnim,
                transform: [{ translateY: formSlideAnim }],
              }}
            >
              {/* Location (conditional - for place, food, stay) */}
              {showPlaceInput && (
                <View style={[styles.section, styles.locationSection]}>
                  <Text style={styles.sectionLabel}>LOCATION</Text>
                  <View style={styles.placesContainer}>
                    <PlacesAutocomplete
                      value={selectedPlace}
                      onSelect={(place) => {
                        setSelectedPlace(place);
                        if (errors.place) setErrors((prev) => ({ ...prev, place: '' }));
                      }}
                      placeholder="Search for a place..."
                      countryCode={trip?.country_code}
                    />
                  </View>
                  {errors.place && (
                    <Text style={styles.errorText} testID="error-location-required">
                      {errors.place}
                    </Text>
                  )}
                </View>
              )}

              {/* Name - only shown when no place is selected */}
              {!selectedPlace && (
                <View style={styles.section}>
                  <GlassInput
                    label="NAME"
                    placeholder="Give this entry a name"
                    value={title}
                    onChangeText={(text) => {
                      setTitle(text);
                      if (errors.title) setErrors((prev) => ({ ...prev, title: '' }));
                    }}
                    error={errors.title}
                    returnKeyType="next"
                    testID="entry-title-input"
                  />
                </View>
              )}

              {/* Link (optional) */}
              <View style={styles.section}>
                <GlassInput
                  label="LINK (OPTIONAL)"
                  placeholder="Add website URL"
                  value={link}
                  onChangeText={(text) => {
                    setLink(text);
                    if (errors.link) setErrors((prev) => ({ ...prev, link: '' }));
                  }}
                  error={errors.link}
                  keyboardType="url"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  testID="entry-link-input"
                />
              </View>

              {/* Photos Section */}
              <View style={styles.section}>
                <View style={styles.photosLabelRow}>
                  <Text style={[styles.sectionLabel, styles.photosLabel]}>PHOTOS</Text>
                  <Text style={styles.photoCountLabel}>
                    {photoCount}/{MAX_PHOTOS_PER_ENTRY}
                  </Text>
                </View>
                <View style={styles.photoGalleryContainer}>
                  <EntryMediaGallery
                    entryId={isEditing ? entryId : undefined}
                    tripId={!isEditing ? tripId : undefined}
                    editable={true}
                    onPendingMediaChange={!isEditing ? setPendingMediaIds : undefined}
                    onMediaCountChange={setPhotoCount}
                  />
                </View>
              </View>

              {/* Notes */}
              <View style={styles.section}>
                <GlassInput
                  label="NOTES"
                  placeholder="What made this memorable?"
                  value={notes}
                  onChangeText={setNotes}
                  onFocus={handleNotesFocus}
                  multiline
                  testID="entry-notes-input"
                />
              </View>

              {/* Submit Button */}
              <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
                <Button
                  title={isEditing ? 'Save Changes' : 'Save Entry'}
                  onPress={handleSubmit}
                  loading={isSubmitting}
                  disabled={isSubmitting}
                  testID="entry-save-button"
                />
              </View>
            </Animated.View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
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
  header: {
    backgroundColor: colors.warmCream,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
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
  keyboardAvoid: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingTop: 8,
    flexGrow: 1,
  },
  headerSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 24,
    lineHeight: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.midnightNavy,
    marginBottom: 12,
    letterSpacing: 1.5,
    opacity: 0.7,
    textTransform: 'uppercase',
  },

  // Category grid styles
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  categoryButtonWrapper: {
    width: '47%',
    flexGrow: 1,
  },
  categoryButtonOuter: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  categoryButton: {
    paddingVertical: 18,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    alignItems: 'center',
    gap: 10,
  },
  categoryIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryLabel: {
    fontSize: 14,
    color: colors.textSecondary,
    fontFamily: fonts.openSans.regular,
    textAlign: 'center',
  },
  selectedIndicator: {
    position: 'absolute',
    bottom: 0,
    left: '25%',
    right: '25%',
    height: 3,
    borderRadius: 2,
  },

  // Selected category display
  selectedCategoryOuter: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  selectedCategoryInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  selectedCategoryContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  selectedCategoryIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedCategoryLabel: {
    fontSize: 18,
    fontFamily: fonts.openSans.semiBold,
  },
  changeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(244, 194, 78, 0.15)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(244, 194, 78, 0.3)',
  },
  changeButtonText: {
    fontSize: 14,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
  },

  // Location section needs high zIndex for dropdown
  locationSection: {
    zIndex: 100,
  },

  // Places container
  placesContainer: {
    borderRadius: 12,
    overflow: 'visible', // Allow dropdown to appear
  },

  // Photo gallery
  photosLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  photosLabel: {
    marginBottom: 0, // Override when inside row
  },
  photoCountLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 12,
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  photoGalleryContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },

  // Error text
  errorText: {
    fontSize: 13,
    color: colors.adobeBrick,
    marginTop: 8,
    marginLeft: 4,
    fontFamily: fonts.openSans.regular,
  },

  // Footer
  footer: {
    paddingTop: 16,
  },
});
