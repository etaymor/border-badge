import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { colors } from '@constants/colors';

interface UserAvatarProps {
  avatarUrl: string | null | undefined;
  username: string;
  size?: number;
}

export function UserAvatar({ avatarUrl, username, size = 48 }: UserAvatarProps) {
  const initials = username.slice(0, 2).toUpperCase();
  const fontSize = size * 0.4;

  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
      />
    );
  }

  return (
    <View
      style={[
        styles.placeholder,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={[styles.initials, { fontSize }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: colors.surface,
  },
  placeholder: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: colors.textInverse,
    fontWeight: '600',
  },
});
