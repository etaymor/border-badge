import React from 'react';
import {
  Modal,
  Pressable,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import {
  TRACKING_PRESETS,
  TRACKING_PRESET_ORDER,
  type TrackingPreset,
} from '@constants/trackingPreferences';

interface TrackingPreferenceModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (preset: TrackingPreset) => void;
  currentPreference?: TrackingPreset;
}

export function TrackingPreferenceModal({
  visible,
  onClose,
  onSelect,
  currentPreference,
}: TrackingPreferenceModalProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Country Tracking</Text>
          <Text style={styles.modalSubtitle}>Choose what counts as a country in your passport</Text>

          <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
            {TRACKING_PRESET_ORDER.map((preset) => {
              const presetData = TRACKING_PRESETS[preset];
              const isSelected = currentPreference === preset;
              return (
                <TouchableOpacity
                  key={preset}
                  style={[styles.presetOption, isSelected && styles.presetOptionSelected]}
                  onPress={() => onSelect(preset)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}>
                    {isSelected && <View style={styles.radioInner} />}
                  </View>
                  <View style={styles.presetOptionContent}>
                    <View style={styles.presetOptionHeader}>
                      <Text style={styles.presetOptionName}>{presetData.name}</Text>
                      <Text style={styles.presetOptionCount}>{presetData.count}</Text>
                    </View>
                    <Text style={styles.presetOptionDescription}>{presetData.description}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity style={styles.modalCloseButton} onPress={onClose}>
            <Text style={styles.modalCloseButtonText}>Done</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    maxHeight: '80%',
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
    marginBottom: 4,
  },
  modalSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    textAlign: 'center',
    marginBottom: 20,
  },
  modalScroll: {
    flexGrow: 0,
  },
  presetOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.cloudWhite,
    borderRadius: 16, // More rounded
    padding: 16,
    marginBottom: 12,
    borderWidth: 1, // Thinner border
    borderColor: 'rgba(0,0,0,0.05)',
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  presetOptionSelected: {
    borderColor: colors.mossGreen,
    backgroundColor: 'rgba(87, 120, 90, 0.04)',
    borderWidth: 1.5,
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.stormGray,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  radioCircleSelected: {
    borderColor: colors.mossGreen,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.mossGreen,
  },
  presetOptionContent: {
    flex: 1,
  },
  presetOptionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  presetOptionName: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  presetOptionCount: {
    fontFamily: fonts.oswald.medium,
    fontSize: 14,
    color: colors.stormGray,
  },
  presetOptionDescription: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
    lineHeight: 18,
  },
  modalCloseButton: {
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  modalCloseButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.stormGray,
  },
});
