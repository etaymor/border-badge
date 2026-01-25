/**
 * ManualPlaceSearch - Full-screen form for saving photo clusters as entries.
 *
 * Redesigned to match ShareCaptureScreen/EntryFormScreen patterns with:
 * - Large photo preview at top
 * - Place search
 * - Trip selection
 * - Category selection
 * - Notes field
 */

import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, GlassBackButton, GlassInput } from '@components/ui';
import { PlacesAutocomplete, type SelectedPlace } from '@components/places';
import { CategorySelector } from '@components/entries';
import { TripSelector } from '@components/share/TripSelector';
import type { LocationCluster } from '@services/photoImport';
import type { EntryType } from '@navigation/types';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

export interface ManualPlaceSearchProps {
  cluster: LocationCluster;
  countryCode?: string;
  preSelectedTripId?: string; // Pre-selected trip from photo import context
  onSelect: (
    place: SelectedPlace,
    category: EntryType,
    tripId: string,
    notes?: string
  ) => Promise<string | undefined>;
  onCreateTrip: (name: string, countryCode: string) => Promise<string>;
  onCancel: () => void;
  isSaving?: boolean;
  /** Whether photos are currently being uploaded */
  isUploading?: boolean;
  /** Upload progress (0-100) */
  uploadProgress?: number;
  /** Current photo being uploaded (0-indexed) */
  uploadingPhotoIndex?: number;
  /** Total photos to upload */
  totalPhotosToUpload?: number;
  /** Cancel upload callback */
  onCancelUpload?: () => void;
}

export function ManualPlaceSearch({
  cluster,
  countryCode,
  preSelectedTripId,
  onSelect,
  onCreateTrip,
  onCancel,
  isSaving = false,
  isUploading = false,
  uploadProgress = 0,
  uploadingPhotoIndex = 0,
  totalPhotosToUpload = 0,
  onCancelUpload,
}: ManualPlaceSearchProps) {
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  const locationSectionY = useRef<number>(0);

  const [selectedPlace, setSelectedPlace] = useState<SelectedPlace | null>(null);
  // Initialize with pre-selected trip if provided
  const [selectedTripId, setSelectedTripId] = useState<string | null>(preSelectedTripId ?? null);
  const [selectedCategory, setSelectedCategory] = useState<EntryType | null>(null);
  const [hasSelectedType, setHasSelectedType] = useState(false);
  const [notes, setNotes] = useState('');
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [isCreatingTrip, setIsCreatingTrip] = useState(false);

  const handleConfirm = async () => {
    if (selectedPlace && selectedCategory && selectedTripId) {
      await onSelect(selectedPlace, selectedCategory, selectedTripId, notes.trim() || undefined);
    }
  };

  const handleTypeSelect = (type: EntryType) => {
    setSelectedCategory(type);
    setHasSelectedType(true);
  };

  const handleCreateTrip = async (name: string, code: string): Promise<string> => {
    setIsCreatingTrip(true);
    try {
      const tripId = await onCreateTrip(name, code);
      return tripId;
    } finally {
      setIsCreatingTrip(false);
    }
  };

  const photoCount = cluster.photos.length;
  const formattedDate = cluster.timeRange.start.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const canSave = selectedPlace && selectedCategory && selectedTripId;

  return (
    <Modal animationType="slide" visible={true} onRequestClose={onCancel}>
      <View style={[localStyles.container, { paddingTop: insets.top }]}>
        {/* Header with close button */}
        <View style={localStyles.header}>
          <GlassBackButton icon="close" onPress={onCancel} />
          <Text style={localStyles.headerTitle}>Save Place</Text>
          <View style={localStyles.headerSpacer} />
        </View>

        <KeyboardAvoidingView
          style={localStyles.keyboardAvoid}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
        >
          <ScrollView
            ref={scrollViewRef}
            style={localStyles.scrollView}
            contentContainerStyle={localStyles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            scrollEnabled={scrollEnabled}
          >
            {/* Photo Preview Card */}
            <View style={localStyles.photoCard}>
              {/* Large main photo */}
              <Image
                source={{ uri: cluster.photos[0]?.uri }}
                style={localStyles.mainPhoto}
                contentFit="cover"
              />

              {/* Additional photos strip */}
              {photoCount > 1 && (
                <View style={localStyles.photoStrip}>
                  {cluster.photos.slice(1, 5).map((photo) => (
                    <Image
                      key={photo.id}
                      source={{ uri: photo.uri }}
                      style={localStyles.stripPhoto}
                      contentFit="cover"
                    />
                  ))}
                  {photoCount > 5 && (
                    <View style={localStyles.morePhotos}>
                      <Text style={localStyles.morePhotosText}>+{photoCount - 5}</Text>
                    </View>
                  )}
                </View>
              )}

              {/* Photo metadata */}
              <View style={localStyles.photoMeta}>
                <Text style={localStyles.photoCount}>
                  {photoCount} photo{photoCount !== 1 ? 's' : ''}
                </Text>
                <Text style={localStyles.photoDate}>{formattedDate}</Text>
              </View>
            </View>

            {/* Location Section */}
            <View
              style={[localStyles.section, localStyles.locationSection]}
              onLayout={(event) => {
                locationSectionY.current = event.nativeEvent.layout.y;
              }}
            >
              <Text style={localStyles.sectionLabel}>SELECT LOCATION</Text>
              <PlacesAutocomplete
                value={selectedPlace}
                onSelect={setSelectedPlace}
                placeholder="Search for a place..."
                countryCode={countryCode}
                onDropdownOpen={(isOpen) => {
                  setScrollEnabled(!isOpen);
                  if (isOpen) {
                    scrollViewRef.current?.scrollTo({
                      y: locationSectionY.current - 20,
                      animated: true,
                    });
                  }
                }}
              />
            </View>

            {/* Trip Section - hidden when trip is pre-selected */}
            {!preSelectedTripId && (
              <View style={localStyles.section}>
                <Text style={localStyles.sectionLabel}>SAVE TO TRIP</Text>
                <TripSelector
                  selectedTripId={selectedTripId}
                  onSelectTrip={setSelectedTripId}
                  countryCode={countryCode}
                  onCreateTrip={handleCreateTrip}
                  isCreatingTrip={isCreatingTrip}
                />
              </View>
            )}

            {/* Category Selection */}
            <CategorySelector
              entryType={selectedCategory}
              hasSelectedType={hasSelectedType}
              onTypeSelect={handleTypeSelect}
              onChangeType={() => setHasSelectedType(false)}
            />

            {/* Notes Section */}
            <View style={localStyles.section}>
              <GlassInput
                label="NOTES (OPTIONAL)"
                placeholder="What made this place memorable?"
                value={notes}
                onChangeText={setNotes}
                multiline
              />
            </View>

            {/* Save Button or Upload Progress */}
            <View style={[localStyles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
              {isUploading ? (
                <View style={localStyles.uploadContainer}>
                  <View style={localStyles.uploadContent}>
                    <ActivityIndicator size="small" color={colors.sunsetGold} />
                    <Text style={localStyles.uploadText}>
                      Uploading {uploadingPhotoIndex + 1} of {totalPhotosToUpload}...
                    </Text>
                  </View>
                  <View style={localStyles.uploadProgressBar}>
                    <View
                      style={[localStyles.uploadProgressFill, { width: `${uploadProgress}%` }]}
                    />
                  </View>
                  {onCancelUpload && (
                    <TouchableOpacity onPress={onCancelUpload} style={localStyles.cancelButton}>
                      <Text style={localStyles.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <Button
                  title="Save to Trip"
                  onPress={handleConfirm}
                  loading={isSaving}
                  disabled={!canSave || isSaving}
                />
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const localStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 44,
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    overflow: 'visible',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    overflow: 'visible',
  },

  // Photo Card
  photoCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 24,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  mainPhoto: {
    width: '100%',
    height: 200,
  },
  photoStrip: {
    flexDirection: 'row',
    padding: 8,
    paddingTop: 8,
    gap: 8,
  },
  stripPhoto: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  morePhotos: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: colors.midnightNavy + '80',
    justifyContent: 'center',
    alignItems: 'center',
  },
  morePhotosText: {
    fontFamily: fonts.openSans.bold,
    fontSize: 14,
    color: colors.white,
  },
  photoMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  photoCount: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
  },
  photoDate: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
  },

  // Sections
  section: {
    marginBottom: 24,
  },
  locationSection: {
    zIndex: 2000,
    overflow: 'visible',
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

  // Footer
  footer: {
    paddingTop: 16,
  },

  // Upload progress
  uploadContainer: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 16,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  uploadContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  uploadText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginLeft: 8,
  },
  uploadProgressBar: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 12,
  },
  uploadProgressFill: {
    height: '100%',
    backgroundColor: colors.sunsetGold,
  },
  cancelButton: {
    alignSelf: 'center',
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  cancelText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.adobeBrick,
  },
});
