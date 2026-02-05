/**
 * Smart Link display component.
 * Shows the Open Graph title and domain for a link.
 */

import { memo } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Platform, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface SmartLinkDisplayProps {
  url: string;
  title: string;
  onChange: () => void;
}

function getDomain(url: string): string {
  try {
    const domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
    return domain.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export const SmartLinkDisplay = memo(function SmartLinkDisplay({
  url,
  title,
  onChange,
}: SmartLinkDisplayProps) {
  const domain = getDomain(url);

  const handlePress = () => {
    const targetUrl = url.startsWith('http') ? url : `https://${url}`;
    Linking.openURL(targetUrl).catch(() => {});
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={handlePress} style={styles.iconContainer}>
        <Ionicons name="link" size={20} color={colors.white} />
      </TouchableOpacity>

      <TouchableOpacity onPress={handlePress} style={styles.contentContainer}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.domain} numberOfLines={1}>
          {domain}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={onChange} style={styles.changeButton} hitSlop={10}>
        <Text style={styles.changeButtonText}>Change</Text>
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.paperBeige,
    borderRadius: 16,
    padding: 12,
    borderWidth: 0,
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.midnightNavy, // Dark background for link icon
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  contentContainer: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontSize: 15,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
    marginBottom: 2,
  },
  domain: {
    fontSize: 13,
    fontFamily: fonts.openSans.regular,
    color: colors.textSecondary,
  },
  changeButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(23, 42, 58, 0.05)',
    borderRadius: 12,
  },
  changeButtonText: {
    fontSize: 12,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
    opacity: 0.7,
  },
});
