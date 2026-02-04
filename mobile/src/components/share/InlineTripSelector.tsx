/**
 * Inline trip selector that displays trip list directly (no modal).
 * Used in PhotoImportScreen for a streamlined single-page flow.
 * Shows a modal overlay when creating a new trip.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTrips, Trip } from '@hooks/useTrips';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

import { InlineTripForm } from './InlineTripForm';

interface InlineTripSelectorProps {
  selectedTripId: string | null;
  onSelectTrip: (tripId: string) => void;
  countryCode?: string; // When set, ONLY shows trips matching this country
  onCreateTrip: (name: string, countryCode: string) => Promise<string>; // Returns new trip ID
  isCreatingTrip?: boolean;
  isSelectingTrip?: boolean; // Loading state after selection
}

export function InlineTripSelector({
  selectedTripId,
  onSelectTrip,
  countryCode,
  onCreateTrip,
  isCreatingTrip = false,
  isSelectingTrip = false,
}: InlineTripSelectorProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const insets = useSafeAreaInsets();

  const { data: trips = [], isLoading } = useTrips();

  // When countryCode is set, ONLY show trips matching that country
  // Sort by created_at desc (most recent first)
  const filteredTrips = useMemo(
    () =>
      [...trips]
        .filter((trip) => (countryCode ? trip.country_code === countryCode : true))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [trips, countryCode]
  );

  const handleSelectTrip = useCallback(
    (trip: Trip) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onSelectTrip(trip.id);
    },
    [onSelectTrip]
  );

  const handleShowCreateModal = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowCreateModal(true);
  }, []);

  const handleCreateTrip = useCallback(
    async (name: string, code: string) => {
      const newTripId = await onCreateTrip(name, code);
      onSelectTrip(newTripId);
      setShowCreateModal(false);
    },
    [onCreateTrip, onSelectTrip]
  );

  const handleCancelCreate = useCallback(() => {
    setShowCreateModal(false);
  }, []);

  return (
    <View style={styles.container}>
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.sunsetGold} />
          <Text style={styles.loadingText}>Loading trips...</Text>
        </View>
      ) : filteredTrips.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>
            {countryCode ? 'No trips for this country yet.' : 'No trips yet.'}
          </Text>
          <TouchableOpacity
            style={styles.createButtonPrimary}
            onPress={handleShowCreateModal}
            activeOpacity={0.7}
          >
            <Ionicons name="add-circle-outline" size={20} color={colors.midnightNavy} />
            <Text style={styles.createButtonPrimaryText}>Create New Trip</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Trip List */}
          <View style={styles.tripsList}>
            {filteredTrips.map((trip) => {
              const isSelected = selectedTripId === trip.id;
              const isSelecting = isSelectingTrip && isSelected;

              return (
                <TouchableOpacity
                  key={trip.id}
                  style={[styles.tripItem, isSelected && styles.tripItemSelected]}
                  onPress={() => handleSelectTrip(trip)}
                  activeOpacity={0.7}
                  disabled={isSelectingTrip}
                >
                  <View style={styles.tripItemContent}>
                    <Text
                      style={[styles.tripItemName, isSelected && styles.tripItemNameSelected]}
                      numberOfLines={1}
                    >
                      {trip.name}
                    </Text>
                  </View>
                  {isSelecting ? (
                    <ActivityIndicator size="small" color={colors.mossGreen} />
                  ) : isSelected ? (
                    <Ionicons name="checkmark-circle" size={22} color={colors.mossGreen} />
                  ) : (
                    <Ionicons name="chevron-forward" size={20} color={colors.stormGray} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Create New Trip - secondary option */}
          <TouchableOpacity
            style={styles.createButtonSecondary}
            onPress={handleShowCreateModal}
            activeOpacity={0.7}
          >
            <Ionicons name="add-circle-outline" size={18} color={colors.stormGray} />
            <Text style={styles.createButtonSecondaryText}>Create New Trip</Text>
          </TouchableOpacity>
        </>
      )}

      {/* Create Trip Modal */}
      <Modal
        visible={showCreateModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleCancelCreate}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalContainer}
        >
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderSpacer} />
            <Text style={styles.modalTitle}>Create New Trip</Text>
            <TouchableOpacity onPress={handleCancelCreate} style={styles.modalCloseButton}>
              <Ionicons name="close" size={24} color={colors.midnightNavy} />
            </TouchableOpacity>
          </View>
          <View style={styles.modalContent}>
            <InlineTripForm
              defaultCountryCode={countryCode}
              onSubmit={handleCreateTrip}
              onCancel={handleCancelCreate}
              isSubmitting={isCreatingTrip}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },

  // Loading
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  loadingText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
  },

  // Empty state
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  emptyText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    marginBottom: 16,
  },

  // Trips List
  tripsList: {
    gap: 8,
  },

  // Trip Item
  tripItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tripItemSelected: {
    backgroundColor: 'rgba(84, 122, 95, 0.08)',
    borderColor: colors.mossGreen,
  },
  tripItemContent: {
    flex: 1,
  },
  tripItemName: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  tripItemNameSelected: {
    color: colors.mossGreen,
  },

  // Create Button - Primary (when no trips)
  createButtonPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sunsetGold,
    borderRadius: 9999,
    paddingVertical: 14,
    paddingHorizontal: 24,
    gap: 8,
    shadowColor: colors.sunsetGold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  createButtonPrimaryText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },

  // Create Button - Secondary (when trips exist)
  createButtonSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 8,
    gap: 6,
  },
  createButtonSecondaryText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
  },

  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  modalTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
  },
  modalHeaderSpacer: {
    width: 40,
  },
  modalCloseButton: {
    padding: 8,
    alignItems: 'flex-end',
    width: 40,
  },
  modalContent: {
    flex: 1,
    paddingHorizontal: 20,
  },
});
