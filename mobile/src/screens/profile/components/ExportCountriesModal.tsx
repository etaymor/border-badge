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
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface ExportCountriesModalProps {
  visible: boolean;
  onClose: () => void;
  exportText: string;
  onShare: () => void;
  onCopy: () => void;
  copyFeedback: boolean;
}

export function ExportCountriesModal({
  visible,
  onClose,
  exportText,
  onShare,
  onCopy,
  copyFeedback,
}: ExportCountriesModalProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.exportModalContent} onPress={(e) => e.stopPropagation()}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Export Countries</Text>
          <Text style={styles.modalSubtitle}>Share or copy your country list</Text>

          {/* Text Preview */}
          <View style={styles.exportPreviewContainer}>
            <BlurView intensity={30} tint="light" style={styles.exportPreviewGlass}>
              <ScrollView
                style={styles.exportPreviewScroll}
                contentContainerStyle={styles.exportPreviewContent}
                showsVerticalScrollIndicator={true}
                indicatorStyle="black"
              >
                <Text style={styles.exportPreviewText} selectable>
                  {exportText}
                </Text>
              </ScrollView>
            </BlurView>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionsContainer}>
            {/* Share button */}
            <TouchableOpacity
              style={[styles.actionButton, styles.primaryAction]}
              onPress={onShare}
              activeOpacity={0.7}
              hitSlop={{ top: 16, bottom: 16, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Share list"
              accessibilityHint="Opens share sheet to share this list"
            >
              <View style={[styles.actionIconContainer, styles.primaryIconContainer]}>
                <Ionicons name="share-outline" size={24} color={colors.white} />
              </View>
              <Text style={[styles.actionLabel, styles.primaryLabel]}>Share</Text>
            </TouchableOpacity>

            {/* Copy button */}
            <TouchableOpacity
              style={styles.actionButton}
              onPress={onCopy}
              activeOpacity={0.7}
              hitSlop={{ top: 16, bottom: 16, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={copyFeedback ? 'Copied' : 'Copy to clipboard'}
              accessibilityHint="Copies the list to your clipboard"
            >
              <View style={styles.actionIconContainer}>
                <Ionicons
                  name={copyFeedback ? 'checkmark-circle' : 'copy-outline'}
                  size={24}
                  color={copyFeedback ? colors.mossGreen : colors.midnightNavy}
                />
              </View>
              <Text style={[styles.actionLabel, copyFeedback && styles.successLabel]}>
                {copyFeedback ? 'Copied!' : 'Copy'}
              </Text>
            </TouchableOpacity>
          </View>

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
  exportModalContent: {
    backgroundColor: colors.warmCream,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 24,
    paddingBottom: 34,
    maxHeight: '85%',
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
  exportPreviewContainer: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    maxHeight: 320,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  exportPreviewGlass: {
    width: '100%',
    height: '100%',
  },
  exportPreviewScroll: {
    flex: 1,
  },
  exportPreviewContent: {
    padding: 20,
  },
  exportPreviewText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.midnightNavy,
    lineHeight: 22,
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 16,
    gap: 32,
  },
  actionButton: {
    alignItems: 'center',
  },
  primaryAction: {
    // Primary action styling hook
  },
  actionIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.cloudWhite,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  primaryIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.sunsetGold,
    borderWidth: 0,
    shadowOpacity: 0.2,
  },
  actionLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 12,
    color: colors.midnightNavy,
    textAlign: 'center',
  },
  primaryLabel: {
    color: colors.midnightNavy,
    fontSize: 13,
  },
  successLabel: {
    color: colors.mossGreen,
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
