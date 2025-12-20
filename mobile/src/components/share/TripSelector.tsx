/**
 * Trip selector dropdown with inline trip creation.
 * Used in ShareCaptureScreen to select or create a trip for saving entries.
 */

import { useCallback, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useTrips, Trip } from '@hooks/useTrips';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

import { InlineTripForm } from './InlineTripForm';

interface TripSelectorProps {
  selectedTripId: string | null;
  onSelectTrip: (tripId: string) => void;
  countryCode?: string; // Filter/prioritize trips by country
  onCreateTrip: (name: string, countryCode: string) => Promise<string>; // Returns new trip ID
  isCreatingTrip?: boolean;
}

export function TripSelector({
  selectedTripId,
  onSelectTrip,
  countryCode,
  onCreateTrip,
  isCreatingTrip = false,
}: TripSelectorProps) {
  const [showModal, setShowModal] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const { data: trips = [], isLoading } = useTrips();

  // Sort trips: matching country first, then by created_at desc
  const sortedTrips = [...trips].sort((a, b) => {
    // If we have a country code, prioritize trips from that country
    if (countryCode) {
      const aMatch = a.country_code === countryCode;
      const bMatch = b.country_code === countryCode;
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
    }
    // Then sort by created_at descending (most recent first)
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const selectedTrip = trips.find((t) => t.id === selectedTripId);

  const handleOpenModal = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
      <TouchableOpacity style={styles.dropdownButton} onPress={handleOpenModal} activeOpacity={0.7}>
        <View style={styles.dropdownContent}>
          {selectedTrip ? (
            <>
              <Text style={styles.selectedTripName} numberOfLines={1}>
                {selectedTrip.name}
              </Text>
              <Text style={styles.selectedTripCountry} numberOfLines={1}>
                {selectedTrip.country_code}
              </Text>
            </>
          ) : (
            <Text style={styles.placeholderText}>Select a trip...</Text>
          )}
        </View>
        <Ionicons name="chevron-down" size={20} color={colors.stormGray} />
      </TouchableOpacity>

      {/* Selection Modal */}
      <Modal
        visible={showModal}
        transparent
        animationType="slide"
        onRequestClose={handleCloseModal}
      >
        <Pressable style={styles.modalBackdrop} onPress={handleCloseModal}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
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
                  {isLoading ? (
                    <Text style={styles.loadingText}>Loading trips...</Text>
                  ) : sortedTrips.length === 0 ? (
                    <Text style={styles.emptyText}>No trips yet. Create one below!</Text>
                  ) : (
                    sortedTrips.map((trip) => (
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
                          <Ionicons name="checkmark-circle" size={22} color={colors.mossGreen} />
                        )}
                        {countryCode && trip.country_code === countryCode && (
                          <View style={styles.matchBadge}>
                            <Text style={styles.matchBadgeText}>Match</Text>
                          </View>
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
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // Dropdown Button
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(23, 42, 58, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.warmCream,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 24,
    paddingBottom: 34,
    maxHeight: '75%',
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.stormGray,
    opacity: 0.4,
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
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  tripItemSelected: {
    backgroundColor: 'rgba(84, 122, 95, 0.1)',
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
  matchBadge: {
    backgroundColor: colors.sunsetGold,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
  },
  matchBadgeText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 10,
    color: colors.midnightNavy,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
});
