import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface UserAvatarProps {
  avatarUrl: string | null | undefined;
  username: string;
  size?: number;
  showRing?: boolean;
}

export function UserAvatar({ avatarUrl, username, size = 48, showRing = false }: UserAvatarProps) {
  const initials = username.slice(0, 2).toUpperCase();
  const fontSize = size * 0.38;
  const ringSize = size + 8;

  const avatarContent = avatarUrl ? (
    <Image
      source={{ uri: avatarUrl }}
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
    />
  ) : (
    <View
      style={[
        styles.placeholder,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
    >
      <Text style={[styles.initials, { fontSize }]}>{initials}</Text>
    </View>
  );

  if (showRing) {
    return (
      <View
        style={[
          styles.ring,
          {
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
          },
        ]}
      >
        {avatarContent}
      </View>
    );
  }

  return avatarContent;
}

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: colors.paperBeige,
    borderWidth: 2,
    borderColor: colors.cloudWhite,
  },
  placeholder: {
    backgroundColor: colors.adobeBrick,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.cloudWhite,
  },
  initials: {
    fontFamily: fonts.playfair.bold,
    color: colors.cloudWhite,
  },
  ring: {
    borderWidth: 2,
    borderColor: colors.sunsetGold,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.paperBeige,
  },
});
