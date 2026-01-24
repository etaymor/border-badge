/**
 * Trip selector dropdown with inline trip creation.
 * Used in ShareCaptureScreen to select or create a trip for saving entries.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';

import { useTrips, useUncategorizedTrip, Trip } from '@hooks/useTrips';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { liquidGlass, GLASS_CONFIG } from '@constants/glass';

import { InlineTripForm } from './InlineTripForm';

// Special ID for the uncategorized/Saved Places trip
export const SAVED_PLACES_TRIP_ID = '__saved_places__';

interface TripSelectorProps {
  selectedTripId: string | null;
  onSelectTrip: (tripId: string) => void;
  countryCode?: string; // When set, ONLY shows trips matching this country
  onCreateTrip: (name: string, countryCode: string) => Promise<string>; // Returns new trip ID
  isCreatingTrip?: boolean;
  showSavedPlacesOption?: boolean; // When true, shows "Save for Later" option
}

export function TripSelector({
  selectedTripId,
  onSelectTrip,
  countryCode,
  onCreateTrip,
  isCreatingTrip = false,
  showSavedPlacesOption = false,
}: TripSelectorProps) {
  const [showModal, setShowModal] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const { data: trips = [], isLoading } = useTrips();
  const { data: uncategorizedTrip } = useUncategorizedTrip();

  // Check if "Saved Places" is selected (either by magic constant or actual trip ID)
  const isSavedPlacesSelected =
    selectedTripId === SAVED_PLACES_TRIP_ID || selectedTripId === uncategorizedTrip?.id;

  // When countryCode is set, ONLY show trips matching that country
  // Sort by created_at desc (most recent first)
  const filteredTrips = useMemo(
    () =>
      [...trips]
        .filter((trip) => (countryCode ? trip.country_code === countryCode : true))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [trips, countryCode]
  );

  const selectedTrip = useMemo(() => {
    if (isSavedPlacesSelected && uncategorizedTrip) {
      return uncategorizedTrip;
    }
    return trips.find((t) => t.id === selectedTripId);
  }, [trips, selectedTripId, isSavedPlacesSelected, uncategorizedTrip]);

  const handleOpenModal = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Always show the trip list first - user can choose Saved Places or create a new trip
    setShowModal(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setShowModal(false);
    setShowCreateForm(false);
  }, []);

  const handleSelectTrip = useCallback(
    (trip: Trip) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onSelectTrip(trip.id);
      handleCloseModal();
    },
    [onSelectTrip, handleCloseModal]
  );

  const handleSelectSavedPlaces = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (uncategorizedTrip) {
      onSelectTrip(uncategorizedTrip.id);
    }
    handleCloseModal();
  }, [uncategorizedTrip, onSelectTrip, handleCloseModal]);

  const handleShowCreateForm = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowCreateForm(true);
  }, []);

  const handleCreateTrip = useCallback(
    async (name: string, code: string) => {
      const newTripId = await onCreateTrip(name, code);
      onSelectTrip(newTripId);
      handleCloseModal();
    },
    [onCreateTrip, onSelectTrip, handleCloseModal]
  );

  const handleCancelCreate = useCallback(() => {
    setShowCreateForm(false);
  }, []);

  return (
    <View>
      {/* Dropdown Button */}
      <Pressable onPress={handleOpenModal} style={styles.dropdownButtonContainer}>
        <BlurView
          intensity={GLASS_CONFIG.intensity.medium}
          tint={GLASS_CONFIG.tint}
          style={styles.dropdownButton}
        >
          <View style={styles.dropdownContent}>
            {selectedTrip ? (
              <>
                {selectedTrip.is_system ? (
                  <Ionicons
                    name="bookmark"
                    size={18}
                    color={colors.sunsetGold}
                    style={styles.savedPlacesIcon}
                  />
                ) : null}
                <Text style={styles.selectedTripName} numberOfLines={1}>
                  {selectedTrip.name}
                </Text>
                {selectedTrip.country_code ? (
                  <Text style={styles.selectedTripCountry} numberOfLines={1}>
                    {selectedTrip.country_code}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.placeholderText}>Select a trip...</Text>
            )}
          </View>
          <Ionicons name="chevron-down" size={20} color={colors.stormGray} />
        </BlurView>
      </Pressable>

      {/* Selection Modal */}
      <Modal visible={showModal} transparent animationType="fade" onRequestClose={handleCloseModal}>
        <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.keyboardAvoidingView}
          >
            <Pressable style={styles.modalBackdrop} onPress={handleCloseModal}>
              <View style={styles.modalContainer}>
                <BlurView
                  intensity={GLASS_CONFIG.intensity.high}
                  tint={GLASS_CONFIG.tint}
                  style={styles.modalBlur}
                >
                  <Pressable
                    onPress={(e) => e.stopPropagation()}
                    style={styles.modalContentContainer}
                  >
                    <View style={styles.modalHandle} />

                    {showCreateForm ? (
                      <InlineTripForm
                        defaultCountryCode={countryCode}
                        onSubmit={handleCreateTrip}
                        onCancel={handleCancelCreate}
                        isSubmitting={isCreatingTrip}
                      />
                    ) : (
                      <>
                        <Text style={styles.modalTitle}>Select Trip</Text>

                        <ScrollView
                          style={styles.tripsList}
                          showsVerticalScrollIndicator={false}
                          contentContainerStyle={styles.tripsListContent}
                        >
                          {/* Save for Later Option */}
                          {showSavedPlacesOption && uncategorizedTrip && (
                            <TouchableOpacity
                              style={[
                                styles.tripItem,
                                styles.savedPlacesItem,
                                (isSavedPlacesSelected ||
                                  selectedTripId === uncategorizedTrip.id) &&
                                  styles.tripItemSelected,
                              ]}
                              onPress={handleSelectSavedPlaces}
                              activeOpacity={0.7}
                            >
                              <View style={styles.tripItemContent}>
                                <Ionicons
                                  name="bookmark"
                                  size={18}
                                  color={colors.sunsetGold}
                                  style={styles.savedPlacesItemIcon}
                                />
                                <Text
                                  style={[
                                    styles.tripItemName,
                                    (isSavedPlacesSelected ||
                                      selectedTripId === uncategorizedTrip.id) &&
                                      styles.tripItemNameSelected,
                                  ]}
                                >
                                  Saved Places
                                </Text>
                                <Text style={styles.savedPlacesHint}>Organize later</Text>
                              </View>
                              {(isSavedPlacesSelected ||
                                selectedTripId === uncategorizedTrip.id) && (
                                <Ionicons
                                  name="checkmark-circle"
                                  size={22}
                                  color={colors.mossGreen}
                                />
                              )}
                            </TouchableOpacity>
                          )}

                          {showSavedPlacesOption &&
                            uncategorizedTrip &&
                            filteredTrips.length > 0 && (
                              <View style={styles.divider}>
                                <View style={styles.dividerLine} />
                                <Text style={styles.dividerText}>or add to a trip</Text>
                                <View style={styles.dividerLine} />
                              </View>
                            )}

                          {isLoading ? (
                            <Text style={styles.loadingText}>Loading trips...</Text>
                          ) : filteredTrips.length === 0 && !showSavedPlacesOption ? (
                            <Text style={styles.emptyText}>
                              {countryCode
                                ? 'No trips for this country yet. Create one below!'
                                : 'No trips yet. Create one below!'}
                            </Text>
                          ) : (
                            filteredTrips.map((trip) => (
                              <TouchableOpacity
                                key={trip.id}
                                style={[
                                  styles.tripItem,
                                  selectedTripId === trip.id && styles.tripItemSelected,
                                ]}
                                onPress={() => handleSelectTrip(trip)}
                                activeOpacity={0.7}
                              >
                                <View style={styles.tripItemContent}>
                                  <Text
                                    style={[
                                      styles.tripItemName,
                                      selectedTripId === trip.id && styles.tripItemNameSelected,
                                    ]}
                                    numberOfLines={1}
                                  >
                                    {trip.name}
                                  </Text>
                                  <Text style={styles.tripItemCountry}>{trip.country_code}</Text>
                                </View>
                                {selectedTripId === trip.id && (
                                  <Ionicons
                                    name="checkmark-circle"
                                    size={22}
                                    color={colors.mossGreen}
                                  />
                                )}
                              </TouchableOpacity>
                            ))
                          )}
                        </ScrollView>

                        {/* Create New Trip Button */}
                        <TouchableOpacity
                          style={styles.createButton}
                          onPress={handleShowCreateForm}
                          activeOpacity={0.7}
                        >
                          <View style={styles.createButtonIcon}>
                            <Ionicons name="add" size={20} color={colors.white} />
                          </View>
                          <Text style={styles.createButtonText}>Create New Trip</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.cancelButton} onPress={handleCloseModal}>
                          <Text style={styles.cancelButtonText}>Cancel</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </Pressable>
                </BlurView>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </BlurView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // Dropdown Button
  dropdownButtonContainer: {
    ...liquidGlass.container,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 0, // Handled by container style
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  dropdownContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectedTripName: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
    flex: 1,
  },
  selectedTripCountry: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
  },
  placeholderText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.stormGray,
  },

  // Modal
  keyboardAvoidingView: {
    flex: 1,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    ...liquidGlass.floatingCard,
    width: '100%',
    maxWidth: 400,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  modalBlur: {
    paddingTop: 12,
    paddingHorizontal: 24,
    paddingBottom: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
  },
  modalContentContainer: {
    width: '100%',
  },
  modalContent: {
    // Deprecated
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    color: colors.midnightNavy,
    textAlign: 'center',
    marginBottom: 20,
  },

  // Trips List
  tripsList: {
    maxHeight: 300,
    marginBottom: 16,
  },
  tripsListContent: {
    gap: 8,
  },
  loadingText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    textAlign: 'center',
    paddingVertical: 20,
  },
  emptyText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    textAlign: 'center',
    paddingVertical: 20,
  },

  // Trip Item
  tripItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
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
    gap: 8,
  },
  tripItemName: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 15,
    color: colors.midnightNavy,
    flex: 1,
  },
  tripItemNameSelected: {
    color: colors.mossGreen,
  },
  tripItemCountry: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
  },

  // Create Button
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sunsetGold,
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 12,
    gap: 8,
    shadowColor: colors.sunsetGold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  createButtonIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },

  // Cancel Button
  cancelButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.stormGray,
  },

  // Saved Places Option
  savedPlacesIcon: {
    marginRight: 4,
  },
  savedPlacesItem: {
    backgroundColor: 'rgba(244, 194, 78, 0.15)',
    borderColor: 'rgba(244, 194, 78, 0.3)',
    marginBottom: 8,
  },
  savedPlacesItemIcon: {
    marginRight: 8,
  },
  savedPlacesHint: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.stormGray,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  dividerText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.stormGray,
  },
});
