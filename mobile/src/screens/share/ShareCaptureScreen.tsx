/**
 * ShareCaptureScreen - Main UI for saving places from TikTok/Instagram.
 *
 * Flow:
 * 1. Receive URL from clipboard/share extension
 * 2. Call /ingest/social to process URL and detect place
 * 3. Show thumbnail, let user confirm/edit place
 * 4. Select trip and entry type
 * 5. Save to trip via /ingest/save-to-trip
 */

import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { PassportStackScreenProps } from '@navigation/types';
import { PlacesAutocomplete } from '@components/places';
import { CategorySelector } from '@components/entries';
import { GlassBackButton, GlassInput, Button } from '@components/ui';
import { TripSelector } from '@components/share/TripSelector';
import { PendingSharesBanner } from '@components/share/PendingSharesBanner';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

import { ShareCaptureLoadingState, ShareCaptureErrorState } from './ShareCaptureStates';
import { ThumbnailCard, ManualEntryBanner } from './ShareCaptureThumbnail';
import { useShareCapture } from './useShareCapture';
import { detectProviderFromUrl } from './shareCaptureUtils';

type Props = PassportStackScreenProps<'ShareCapture'>;

export function ShareCaptureScreen({ route, navigation }: Props) {
  const { url, caption, source } = route.params;
  const insets = useSafeAreaInsets();

  // Refs for scroll behavior
  const scrollViewRef = useRef<ScrollView>(null);
  const locationSectionY = useRef<number>(0);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  // All state and handlers from custom hook
  const {
    ingestResult,
    selectedPlace,
    selectedTripId,
    entryType,
    hasSelectedType,
    notes,
    isCreatingTrip,
    isManualEntryMode,
    error,
    isLoading,
    isSaving,
    handleTypeSelect,
    handleChangeType,
    handlePlaceSelect,
    handleCreateTrip,
    handleSave,
    handleRetry,
    handleManualEntry,
    handleSaveForLater,
    checkShareConnectivity,
    setNotes,
    setSelectedTripId,
  } = useShareCapture({
    url,
    caption,
    source,
    onComplete: (tripId?: string) => {
      if (tripId) {
        // Navigate to the trip detail screen after saving
        navigation.navigate('Trips', { screen: 'TripDetail', params: { tripId } });
      } else {
        navigation.goBack();
      }
    },
  });

  // Loading state
  if (isLoading) {
    return <ShareCaptureLoadingState provider={detectProviderFromUrl(url)} />;
  }

  // Error state
  if (error && !ingestResult) {
    return (
      <ShareCaptureErrorState
        error={error}
        onRetry={handleRetry}
        onManualEntry={handleManualEntry}
        onSaveForLater={handleSaveForLater}
        onCancel={() => navigation.goBack()}
      />
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.backButtonContainer}>
        <GlassBackButton onPress={() => navigation.goBack()} />
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEnabled={scrollEnabled}
        >
          <Text style={styles.scrollHeaderTitle}>Save Place</Text>

          <PendingSharesBanner retryFn={checkShareConnectivity} />

          {ingestResult && <ThumbnailCard ingestResult={ingestResult} />}

          <ManualEntryBanner visible={isManualEntryMode && !ingestResult?.detected_place} />

          {/* Location Section */}
          <View
            style={[styles.section, styles.locationSection]}
            onLayout={(event) => {
              locationSectionY.current = event.nativeEvent.layout.y;
            }}
          >
            <Text style={styles.sectionLabel}>
              {ingestResult?.detected_place ? 'CONFIRM LOCATION' : 'SELECT LOCATION'}
            </Text>
            <PlacesAutocomplete
              value={selectedPlace}
              onSelect={handlePlaceSelect}
              placeholder="Search for a place..."
              countryCode={ingestResult?.detected_place?.country_code ?? undefined}
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

          {/* Trip Section */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>SAVE TO TRIP</Text>
            <TripSelector
              selectedTripId={selectedTripId}
              onSelectTrip={setSelectedTripId}
              countryCode={
                selectedPlace?.country_code ??
                ingestResult?.detected_place?.country_code ??
                undefined
              }
              onCreateTrip={handleCreateTrip}
              isCreatingTrip={isCreatingTrip}
            />
          </View>

          <CategorySelector
            entryType={entryType}
            hasSelectedType={hasSelectedType}
            onTypeSelect={handleTypeSelect}
            onChangeType={handleChangeType}
          />

          <View style={styles.section}>
            <GlassInput
              label="NOTES (OPTIONAL)"
              placeholder="Why did this catch your eye?"
              value={notes}
              onChangeText={setNotes}
              multiline
            />
          </View>

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
            <Button
              title="Save to Trip"
              onPress={handleSave}
              loading={isSaving}
              disabled={isSaving || !selectedPlace || !selectedTripId}
            />
          </View>
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
  backButtonContainer: {
    position: 'absolute',
    top: 8,
    left: 16,
    zIndex: 3000,
  },
  scrollHeaderTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
    textAlign: 'center',
    marginBottom: 16,
    marginTop: 8,
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
  footer: {
    paddingTop: 16,
  },
});

export default ShareCaptureScreen;
