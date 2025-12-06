import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CountryCard, Snackbar } from '@components/ui';
import { colors } from '@constants/colors';
import { useCountries } from '@hooks/useCountries';
import { useAddUserCountry, useRemoveUserCountry, useUserCountries } from '@hooks/useUserCountries';
import type { DreamsStackScreenProps } from '@navigation/types';

type Props = DreamsStackScreenProps<'DreamsHome'>;

interface DreamCountry {
  code: string;
  name: string;
  region: string;
  isWishlisted: boolean;
}

interface SnackbarState {
  visible: boolean;
  message: string;
  countryCode?: string;
}

export function DreamsScreen({ navigation }: Props) {
  const { data: userCountries, isLoading: loadingUserCountries } = useUserCountries();
  const { data: countries, isLoading: loadingCountries } = useCountries();
  const addUserCountry = useAddUserCountry();
  const removeUserCountry = useRemoveUserCountry();
  const [searchQuery, setSearchQuery] = useState('');

  // Animation state
  const [animatingCard, setAnimatingCard] = useState<string | null>(null);
  const cardScale = useRef(new Animated.Value(1)).current;
  const cardOpacity = useRef(new Animated.Value(1)).current;
  const cardTranslateY = useRef(new Animated.Value(0)).current;

  // Snackbar state
  const [snackbar, setSnackbar] = useState<SnackbarState>({ visible: false, message: '' });

  // Compute visited and wishlist countries
  const { visitedCountries, wishlistCountries } = useMemo(() => {
    if (!userCountries) return { visitedCountries: [], wishlistCountries: [] };
    return {
      visitedCountries: userCountries.filter((uc) => uc.status === 'visited'),
      wishlistCountries: userCountries.filter((uc) => uc.status === 'wishlist'),
    };
  }, [userCountries]);

  // Pre-compute searchable country data (avoids repeated toLowerCase calls during search)
  const searchableCountries = useMemo(() => {
    if (!countries) return [];
    return countries.map((c) => ({
      ...c,
      searchName: c.name.toLowerCase(),
    }));
  }, [countries]);

  // Compute sorted countries: dreams first, then alphabetical, excluding visited
  const sortedCountries = useMemo((): DreamCountry[] => {
    if (!searchableCountries.length) return [];

    const query = searchQuery.toLowerCase().trim();
    const wishlistCodes = new Set(wishlistCountries.map((uc) => uc.country_code));
    const visitedCodes = new Set(visitedCountries.map((uc) => uc.country_code));

    // Filter by search, exclude visited
    const filtered = searchableCountries
      .filter((c) => !visitedCodes.has(c.code))
      .filter((c) => !query || c.searchName.includes(query));

    // Partition into wishlisted and not
    const wishlisted = filtered
      .filter((c) => wishlistCodes.has(c.code))
      .sort((a, b) => a.name.localeCompare(b.name));

    const notWishlisted = filtered
      .filter((c) => !wishlistCodes.has(c.code))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Dreams first, then rest alphabetically
    return [...wishlisted, ...notWishlisted].map((c) => ({
      code: c.code,
      name: c.name,
      region: c.region,
      isWishlisted: wishlistCodes.has(c.code),
    }));
  }, [searchableCountries, wishlistCountries, visitedCountries, searchQuery]);

  const handleCountryPress = useCallback(
    (country: DreamCountry) => {
      navigation.navigate('CountryDetail', {
        countryId: country.code,
        countryName: country.name,
        countryCode: country.code,
      });
    },
    [navigation]
  );

  const handleAddVisited = useCallback(
    (countryCode: string) => {
      addUserCountry.mutate({ country_code: countryCode, status: 'visited' });
    },
    [addUserCountry]
  );

  const handleToggleWishlist = useCallback(
    (countryCode: string, countryName: string) => {
      const isCurrentlyWishlisted = wishlistCountries.some((uc) => uc.country_code === countryCode);

      if (isCurrentlyWishlisted) {
        // Removing from wishlist - no exit animation needed
        removeUserCountry.mutate(countryCode);
      } else {
        // Adding to wishlist - animate card exit then add
        setAnimatingCard(countryCode);

        // Short delay to let the heart pulse animation start first
        setTimeout(() => {
          Animated.parallel([
            Animated.timing(cardScale, {
              toValue: 0.95,
              duration: 250,
              useNativeDriver: true,
            }),
            Animated.timing(cardOpacity, {
              toValue: 0,
              duration: 250,
              useNativeDriver: true,
            }),
            Animated.timing(cardTranslateY, {
              toValue: -20,
              duration: 250,
              useNativeDriver: true,
            }),
          ]).start(() => {
            // After animation completes, add to wishlist
            addUserCountry.mutate({ country_code: countryCode, status: 'wishlist' });

            // Reset animation values
            cardScale.setValue(1);
            cardOpacity.setValue(1);
            cardTranslateY.setValue(0);
            setAnimatingCard(null);
          });
        }, 150);

        // Show snackbar immediately
        setSnackbar({
          visible: true,
          message: `${countryName} added to your dreams`,
          countryCode,
        });
      }
    },
    [addUserCountry, removeUserCountry, wishlistCountries, cardScale, cardOpacity, cardTranslateY]
  );

  const renderItem = useCallback(
    ({ item }: { item: DreamCountry }) => {
      const isAnimating = animatingCard === item.code;

      return (
        <Animated.View
          style={[
            styles.countryCardWrapper,
            isAnimating && {
              transform: [{ scale: cardScale }, { translateY: cardTranslateY }],
              opacity: cardOpacity,
            },
          ]}
        >
          <CountryCard
            code={item.code}
            name={item.name}
            region={item.region}
            isVisited={false}
            isWishlisted={item.isWishlisted}
            onPress={() => handleCountryPress(item)}
            onAddVisited={() => handleAddVisited(item.code)}
            onToggleWishlist={() => handleToggleWishlist(item.code, item.name)}
          />
        </Animated.View>
      );
    },
    [
      handleCountryPress,
      handleAddVisited,
      handleToggleWishlist,
      animatingCard,
      cardScale,
      cardOpacity,
      cardTranslateY,
    ]
  );

  const getItemKey = useCallback((item: DreamCountry) => item.code, []);

  const ListHeader = useMemo(
    () => (
      <View style={styles.searchRow}>
        <View style={styles.searchInputContainer}>
          <Ionicons name="search" size={18} color={colors.textTertiary} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search countries..."
            placeholderTextColor={colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
        {searchQuery.length > 0 && (
          <TouchableOpacity
            style={styles.clearButton}
            onPress={() => setSearchQuery('')}
            activeOpacity={0.7}
          >
            <Text style={styles.clearButtonText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>
    ),
    [searchQuery]
  );

  const ListEmpty = useMemo(
    () => (
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>✨</Text>
        <Text style={styles.emptyTitle}>
          {searchQuery ? 'No countries found' : 'Start dreaming!'}
        </Text>
        <Text style={styles.emptySubtitle}>
          {searchQuery
            ? 'Try a different search term'
            : 'Tap the heart on any country to add it to your dreams'}
        </Text>
      </View>
    ),
    [searchQuery]
  );

  const handleSnackbarUndo = useCallback(() => {
    if (snackbar.countryCode) {
      removeUserCountry.mutate(snackbar.countryCode);
    }
    setSnackbar({ visible: false, message: '' });
  }, [snackbar.countryCode, removeUserCountry]);

  const handleSnackbarDismiss = useCallback(() => {
    setSnackbar({ visible: false, message: '' });
  }, []);

  const isLoading = loadingUserCountries || loadingCountries;

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <FlatList
        data={sortedCountries}
        renderItem={renderItem}
        keyExtractor={getItemKey}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={10}
      />
      <Snackbar
        visible={snackbar.visible}
        message={snackbar.message}
        actionLabel="Undo"
        onAction={handleSnackbarUndo}
        onDismiss={handleSnackbarDismiss}
        duration={3000}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  listContent: {
    paddingBottom: 24,
    flexGrow: 1,
  },
  // Search Row
  searchRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 16,
    gap: 12,
    alignItems: 'center',
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 20,
    paddingHorizontal: 16,
    height: 44,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  clearButton: {
    paddingHorizontal: 12,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.primary,
  },
  // Country Card Wrapper
  countryCardWrapper: {
    marginBottom: 12,
  },
  // Empty State
  emptyState: {
    flex: 1,
    paddingVertical: 80,
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
