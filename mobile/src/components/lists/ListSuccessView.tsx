import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, View, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { getPublicListUrl, ListDetail } from '@hooks/useLists';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const navIconBook = require('../../../assets/nav-icons/nav_icon_book.png');

interface ListSuccessViewProps {
  list: ListDetail;
  onDone: () => void;
  title?: string;
  subtitle?: string;
}

export function ListSuccessView({
  list,
  onDone,
  title = 'Ready to share',
  subtitle = 'Your curated list is ready for the world to see.',
}: ListSuccessViewProps) {
  const shareUrl = getPublicListUrl(list.slug);
  const [copied, setCopied] = useState(false);
  const insets = useSafeAreaInsets();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(shareUrl);
    setCopied(true);
    // Clear any existing timeout before setting a new one
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => setCopied(false), 2000);
  }, [shareUrl]);

  const handleShare = useCallback(async () => {
    try {
      // On iOS, only pass URL so "Copy" action copies just the link
      // Messaging apps will still receive the URL and users can add their own text
      // On Android, we need to use message since url is not well-supported
      await Share.share(
        Platform.OS === 'ios'
          ? { url: shareUrl }
          : { message: `Check out my list "${list.name}": ${shareUrl}` }
      );
    } catch (error) {
      console.error('Share error:', error);
    }
  }, [list.name, shareUrl]);

  return (
    <View style={[styles.successContainer, { paddingTop: insets.top }]}>
      <View style={styles.successContent}>
        <View style={styles.postcard}>
          {/* Header Icon */}
          <View style={styles.iconContainer}>
            <Image source={navIconBook} style={styles.iconImage} resizeMode="contain" />
          </View>

          <View style={styles.cardHeader}>
            <Text style={styles.cursiveHeader}>{title}</Text>
            <Text style={styles.cardTitle}>{list.name}</Text>
            <View style={styles.divider} />
            <Text style={styles.cardSubtitle}>{subtitle}</Text>
          </View>

          {/* Share URL Section */}
          <View style={styles.linkSection}>
            <View style={styles.urlBox}>
              <Text style={styles.urlText} numberOfLines={1}>
                {shareUrl}
              </Text>
              <Pressable
                style={[styles.copyButton, copied && styles.copyButtonSuccess]}
                onPress={handleCopy}
              >
                <Ionicons
                  name={copied ? 'checkmark' : 'copy-outline'}
                  size={16}
                  color={copied ? colors.white : colors.midnightNavy}
                />
              </Pressable>
            </View>
            <Text style={styles.urlHint}>Anyone with this link can view your list</Text>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.successActions}>
          <Pressable style={styles.shareButton} onPress={handleShare}>
            <Text style={styles.shareButtonText}>Share List</Text>
            <Ionicons name="share-outline" size={20} color={colors.midnightNavy} />
          </Pressable>

          <Pressable style={styles.doneButton} onPress={onDone}>
            <Text style={styles.doneButtonText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  successContainer: {
    flex: 1,
    backgroundColor: colors.warmCream,
    justifyContent: 'center',
    padding: 24,
  },
  successContent: {
    width: '100%',
    alignItems: 'center',
  },
  postcard: {
    backgroundColor: colors.white,
    borderRadius: 24,
    padding: 32,
    width: '100%',
    alignItems: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 8,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: 'rgba(23, 42, 58, 0.05)',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: withAlpha(colors.sunsetGold, 0.15),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  iconImage: {
    width: 32,
    height: 32,
  },
  cardHeader: {
    alignItems: 'center',
    marginBottom: 32,
    width: '100%',
  },
  cursiveHeader: {
    fontFamily: fonts.dawning.regular,
    fontSize: 28,
    color: colors.adobeBrick,
    marginBottom: 4,
    transform: [{ rotate: '-2deg' }],
  },
  cardTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 32,
  },
  divider: {
    height: 2,
    width: 40,
    backgroundColor: colors.sunsetGold,
    marginBottom: 16,
    borderRadius: 1,
  },
  cardSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  linkSection: {
    width: '100%',
    gap: 8,
  },
  urlBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    paddingHorizontal: 4,
    paddingVertical: 4,
    paddingLeft: 16,
    borderWidth: 1,
    borderColor: 'rgba(23, 42, 58, 0.05)',
  },
  urlText: {
    flex: 1,
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.midnightNavy,
    marginRight: 8,
  },
  copyButton: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.white,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  copyButtonSuccess: {
    backgroundColor: colors.mossGreen,
  },
  urlHint: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    opacity: 0.8,
    marginTop: 8,
  },
  successActions: {
    flexDirection: 'row',
    gap: 16,
    width: '100%',
    paddingHorizontal: 16,
  },
  shareButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sunsetGold,
    paddingVertical: 16,
    borderRadius: 16,
    gap: 8,
    shadowColor: colors.sunsetGold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  shareButtonText: {
    fontFamily: fonts.openSans.bold,
    fontSize: 16,
    color: colors.midnightNavy,
    letterSpacing: 0.5,
  },
  doneButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  doneButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.textSecondary,
  },
});
