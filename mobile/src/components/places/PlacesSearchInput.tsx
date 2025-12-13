/**
 * Places search input component with glass effect.
 * Handles text input, loading indicator, and clear button.
 */

import { forwardRef, memo, useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface PlacesSearchInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onClear: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  isLoading: boolean;
  placeholder?: string;
  testID?: string;
}

export const PlacesSearchInput = memo(
  forwardRef<TextInput, PlacesSearchInputProps>(function PlacesSearchInput(
    {
      value,
      onChangeText,
      onClear,
      onFocus,
      onBlur,
      isLoading,
      placeholder = 'Search for a place...',
      testID = 'places-search',
    },
    ref
  ) {
    const [isFocused, setIsFocused] = useState(false);

    const handleFocus = useCallback(() => {
      setIsFocused(true);
      onFocus?.();
    }, [onFocus]);

    const handleBlur = useCallback(() => {
      setIsFocused(false);
      onBlur?.();
    }, [onBlur]);

    return (
      <View style={[styles.inputWrapper, isFocused && styles.inputWrapperFocused]}>
        <BlurView
          intensity={40}
          tint="light"
          style={[styles.inputBlur, isFocused && styles.inputBlurFocused]}
        >
          <View style={styles.inputContainer}>
            <Ionicons name="search" size={18} color={colors.stormGray} style={styles.searchIcon} />
            <TextInput
              ref={ref}
              style={styles.textInput}
              placeholder={placeholder}
              placeholderTextColor={colors.textTertiary}
              value={value}
              onChangeText={onChangeText}
              onFocus={handleFocus}
              onBlur={handleBlur}
              returnKeyType="search"
              testID={`${testID}-input`}
            />
            {isLoading && (
              <ActivityIndicator size="small" color={colors.sunsetGold} style={styles.loader} />
            )}
            {!isLoading && value.length > 0 && (
              <Pressable onPress={onClear} hitSlop={8}>
                <Ionicons name="close-circle" size={20} color={colors.stormGray} />
              </Pressable>
            )}
          </View>
        </BlurView>
      </View>
    );
  })
);

const styles = StyleSheet.create({
  inputWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  inputWrapperFocused: {
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  inputBlur: {
    minHeight: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  inputBlurFocused: {
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    minHeight: 48,
  },
  searchIcon: {
    marginRight: 10,
    opacity: 0.7,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: fonts.openSans.regular,
    color: colors.textPrimary,
    paddingVertical: 12,
  },
  loader: {
    marginLeft: 8,
  },
});
