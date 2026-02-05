/**
 * ShareCaptureScreen - Main UI for saving places from TikTok/Instagram.
 *
 * Flow:
 * 1. Receive URL from clipboard/share extension
 * 2. Call /ingest/social to process URL and detect place(s)
 * 3. Show thumbnail, let user confirm/edit place(s)
 * 4. Select trip and entry type
 * 5. Save to trip via /ingest/save-to-trip or /ingest/save-places (multi-place)
 */

import { useCallback, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { PassportStackScreenProps, RootStackParamList } from '@navigation/types';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { PlacesAutocomplete, MultiPlaceList } from '@components/places';
import { CategorySelector } from '@components/entries';
import { SatisfactionModal } from '@components/review';
import { GlassBackButton, GlassInput, Button } from '@components/ui';
import { TripSelector } from '@components/share/TripSelector';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useReviewRequest } from '@hooks/useReviewRequest';
import { FREE_LIMITS, useShareExtensionRemaining } from '@stores/subscriptionStore';

import { ShareCaptureLoadingState, ShareCaptureErrorState } from './ShareCaptureStates';
import { ThumbnailCard, ManualEntryBanner } from './ShareCaptureThumbnail';
import { useShareCapture } from './useShareCapture';
import { detectProviderFromUrl } from './shareCaptureUtils';

type Props = PassportStackScreenProps<'ShareCapture'>;

export function ShareCaptureScreen({ route, navigation }: Props) {
  const { url, caption, source } = route.params;
  const insets = useSafeAreaInsets();
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // Premium gating
  const remainingSaves = useShareExtensionRemaining();

  // Review request state
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [pendingNavigationTripId, setPendingNavigationTripId] = useState<string | undefined>();
  const {
    checkEligibility,
    startReviewFlow,
    handlePositiveResponse,
    handleNegativeResponse,
    handleDismiss,
  } = useReviewRequest();

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
    userClearedPlace,
    // Multi-place state
    isMultiPlaceMode,
    placeSelections,
    selectedPlaceCount,
    editingPlaceKey,
    // Premium gating
    canSave,
    // Handlers
    handleTypeSelect,
    handleChangeType,
    handlePlaceSelect,
    handleTogglePlace,
    handleEditPlace,
    handleUpdatePlace,
    handleCancelEditPlace,
    handlePlaceEntryTypeChange,
    handleSelectAllPlaces,
    handleClearAllPlaces,
    handleCreateTrip,
    handleSave,
    handleRetry,
    handleManualEntry,
    handleSaveForLater,
    setNotes,
    setSelectedTripId,
  } = useShareCapture({
    url,
    caption,
    source,
    onComplete: (tripId?: string) => {
      // Check if we should show review prompt after first social save
      if (checkEligibility('first_social_save')) {
        if (startReviewFlow('first_social_save')) {
          setPendingNavigationTripId(tripId);
          setShowReviewModal(true);
          return; // Don't navigate yet - wait for review modal to close
        }
      }

      // Navigate normally
      if (tripId) {
        navigation.navigate('Trips', { screen: 'TripDetail', params: { tripId } });
      } else {
        navigation.goBack();
      }
    },
  });

  // Navigate after review modal closes
  const navigateAfterReview = useCallback(() => {
    if (pendingNavigationTripId) {
      navigation.navigate('Trips', {
        screen: 'TripDetail',
        params: { tripId: pendingNavigationTripId },
      });
    } else {
      navigation.goBack();
    }
  }, [navigation, pendingNavigationTripId]);

  const handleReviewPositive = useCallback(async () => {
    setShowReviewModal(false);
    await handlePositiveResponse('first_social_save');
    navigateAfterReview();
  }, [handlePositiveResponse, navigateAfterReview]);

  const handleReviewNegative = useCallback(() => {
    setShowReviewModal(false);
    handleNegativeResponse('first_social_save');
    navigateAfterReview();
  }, [handleNegativeResponse, navigateAfterReview]);

  const handleReviewDismiss = useCallback(() => {
    setShowReviewModal(false);
    handleDismiss('first_social_save');
    navigateAfterReview();
  }, [handleDismiss, navigateAfterReview]);

  // Derive effective country code:
  // - If user explicitly cleared the place, don't bias by country (search worldwide)
  // - Otherwise, use selected place country, detected place country, or detected country hint
  const effectiveCountryCode = userClearedPlace
    ? undefined
    : (selectedPlace?.country_code ??
      ingestResult?.detected_place?.country_code ??
      ingestResult?.detected_country?.country_code);

  // Handle save with premium gating
  const handleSaveWithGate = () => {
    if (!canSave) {
      // Show paywall modal
      rootNavigation.navigate('PaywallModal', { feature: 'shareExtension' });
      return;
    }
    handleSave();
  };

  // Loading state
  if (isLoading) {
    return (
      <ShareCaptureLoadingState
        provider={detectProviderFromUrl(url)}
        onCancel={() => navigation.goBack()}
      />
    );
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
    <View style={styles.container}>
      <View style={[styles.closeButtonContainer, { top: insets.top + 12 }]}>
        <GlassBackButton icon="close" onPress={() => navigation.goBack()} />
      </View>

      <KeyboardAvoidingView
        style={[styles.keyboardAvoid, { paddingTop: insets.top }]}
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

          {ingestResult && <ThumbnailCard ingestResult={ingestResult} />}

          <ManualEntryBanner visible={isManualEntryMode && !ingestResult?.detected_place} />

          {/* Location Section */}
          {isMultiPlaceMode && editingPlaceKey && placeSelections[editingPlaceKey] ? (
            <View
              style={[styles.section, styles.locationSection]}
              onLayout={(event) => {
                locationSectionY.current = event.nativeEvent.layout.y;
              }}
            >
              <View style={styles.editPlaceHeader}>
                <Text style={[styles.sectionLabel, { marginBottom: 0 }]}>EDIT PLACE</Text>
                <Pressable onPress={handleCancelEditPlace} hitSlop={8}>
                  <Text style={styles.cancelEditText}>Cancel</Text>
                </Pressable>
              </View>
              <PlacesAutocomplete
                value={null}
                onSelect={(place) => {
                  if (place) {
                    handleUpdatePlace(editingPlaceKey, place);
                  }
                }}
                placeholder={`Replace "${placeSelections[editingPlaceKey].name}"...`}
                countryCode={placeSelections[editingPlaceKey].country_code ?? effectiveCountryCode}
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
          ) : isMultiPlaceMode ? (
            <View style={styles.section}>
              <MultiPlaceList
                selections={placeSelections}
                onTogglePlace={handleTogglePlace}
                onEditPlace={handleEditPlace}
                onEntryTypeChange={handlePlaceEntryTypeChange}
                onSelectAll={handleSelectAllPlaces}
                onClearAll={handleClearAllPlaces}
                showEditButtons
              />
            </View>
          ) : (
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
                countryCode={effectiveCountryCode}
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
          )}

          {/* Trip Section */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>SAVE TO TRIP</Text>
            <TripSelector
              selectedTripId={selectedTripId}
              onSelectTrip={setSelectedTripId}
              countryCode={effectiveCountryCode}
              onCreateTrip={handleCreateTrip}
              isCreatingTrip={isCreatingTrip}
              showSavedPlacesOption
            />
          </View>

          {/* Only show CategorySelector in single-place mode */}
          {!isMultiPlaceMode && (
            <CategorySelector
              entryType={entryType}
              hasSelectedType={hasSelectedType}
              onTypeSelect={handleTypeSelect}
              onChangeType={handleChangeType}
            />
          )}

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
            {/* Show remaining saves for free users */}
            {remainingSaves !== Infinity && remainingSaves > 0 && (
              <Text style={styles.remainingText}>
                {remainingSaves} of {FREE_LIMITS.shareExtension} free saves remaining
              </Text>
            )}
            {!canSave && (
              <Text style={styles.limitReachedText}>
                Free limit reached. Upgrade to save unlimited places.
              </Text>
            )}
            <Button
              title={
                !canSave
                  ? 'Upgrade to Save'
                  : isMultiPlaceMode
                    ? `Save ${selectedPlaceCount} Place${selectedPlaceCount !== 1 ? 's' : ''}`
                    : 'Save to Trip'
              }
              onPress={handleSaveWithGate}
              loading={isSaving}
              disabled={
                isSaving ||
                !selectedTripId ||
                (isMultiPlaceMode ? selectedPlaceCount === 0 : !selectedPlace)
              }
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <SatisfactionModal
        visible={showReviewModal}
        onPositive={handleReviewPositive}
        onNegative={handleReviewNegative}
        onDismiss={handleReviewDismiss}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  closeButtonContainer: {
    position: 'absolute',
    right: 16,
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
  editPlaceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cancelEditText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.sunsetGold,
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
  remainingText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 12,
  },
  limitReachedText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 13,
    color: colors.sunsetGold,
    textAlign: 'center',
    marginBottom: 12,
  },
});

export default ShareCaptureScreen;
