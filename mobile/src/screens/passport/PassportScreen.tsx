import { useCallback, useMemo, useState } from 'react';
import { Alert, Animated, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import {
  CountryRow,
  PassportEmptyState,
  PassportListHeader,
  PassportSectionHeader,
  StampRow,
} from '@components/passport';
import { ExploreFilterSheet, PassportSkeleton } from '@components/ui';
import { ClipboardPasteModal, OnboardingShareOverlay, ShareCardOverlay } from '@components/share';
import { ClipboardEnableModal } from '@screens/profile/components/ClipboardEnableModal';
import { useSettingsStore, selectClipboardDetectionEnabled } from '@stores/settingsStore';
import type { DetectedClipboardUrl } from '@hooks/useClipboardListener';
import { usePassportData } from '@hooks/usePassportData';
import { usePassportAnimations } from '@hooks/usePassportAnimations';
import { buildMilestoneContext, type MilestoneContext } from '@utils/milestones';
import type { PassportStackScreenProps } from '@navigation/types';
import { styles } from './passportStyles';
import type { CountryDisplayItem, ListItem, UnvisitedCountry } from './passportTypes';

type Props = PassportStackScreenProps<'PassportHome'>;

export function PassportScreen({ navigation }: Props) {
  // Data hook
  const data = usePassportData();
  const {
    isLoading,
    stats,
    passportShareContext,
    flatListData,
    searchQuery,
    setSearchQuery,
    filters,
    setFilters,
    filterSheetVisible,
    setFilterSheetVisible,
    filtersActive,
    activeFilterCount,
    trackingPreference,
    addUserCountry,
    removeUserCountry,
    wishlistCountries,
    countries,
    userCountries,
  } = data;

  // Animation hook
  const animations = usePassportAnimations(isLoading);
  const {
    fadeAnim,
    viewabilityConfig,
    getRowAnimationValues,
    ensureRowVisible,
    handleViewableItemsChanged,
    computeLayoutData,
    getItemKey,
  } = animations;

  // Clipboard detection setting
  const clipboardDetectionEnabled = useSettingsStore(selectClipboardDetectionEnabled);

  // Share card state
  const [shareCardVisible, setShareCardVisible] = useState(false);
  const [shareCardContext, setShareCardContext] = useState<MilestoneContext | null>(null);
  const [passportShareVisible, setPassportShareVisible] = useState(false);

  // Paste modal state
  const [pasteModalVisible, setPasteModalVisible] = useState(false);
  const [enableModalVisible, setEnableModalVisible] = useState(false);

  // Settings store actions
  const setClipboardDetectionEnabled = useSettingsStore((s) => s.setClipboardDetectionEnabled);

  // Handlers
  const handleCountryPress = useCallback(
    (item: CountryDisplayItem) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate('CountryDetail', {
        countryId: item.code,
        countryName: item.name,
        countryCode: item.code,
      });
    },
    [navigation]
  );

  const handleUnvisitedCountryPress = useCallback(
    (country: UnvisitedCountry) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const context = buildMilestoneContext(countryCode, countries ?? [], userCountries ?? []);

      addUserCountry.mutate(
        { country_code: countryCode, status: 'visited' },
        {
          onSuccess: () => {
            if (context) {
              setShareCardContext(context);
              setShareCardVisible(true);
            }
          },
        }
      );
    },
    [addUserCountry, countries, userCountries]
  );

  const handleShareCardDismiss = useCallback(() => {
    setShareCardVisible(false);
    setShareCardContext(null);
  }, []);

  const handlePassportShare = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPassportShareVisible(true);
  }, []);

  const handlePassportShareDismiss = useCallback(() => {
    setPassportShareVisible(false);
  }, []);

  const handleToggleWishlist = useCallback(
    (countryCode: string) => {
      Haptics.selectionAsync();
      const isCurrentlyWishlisted = wishlistCountries.some((uc) => uc.country_code === countryCode);

      if (isCurrentlyWishlisted) {
        removeUserCountry.mutate(countryCode);
      } else {
        addUserCountry.mutate({ country_code: countryCode, status: 'wishlist' });
      }
    },
    [addUserCountry, removeUserCountry, wishlistCountries]
  );

  const handleExplorePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setFilterSheetVisible(true);
  }, [setFilterSheetVisible]);

  const handleProfilePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('ProfileSettings');
  }, [navigation]);

  const handlePastePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPasteModalVisible(true);
  }, []);

  const handlePasteModalClose = useCallback(() => {
    setPasteModalVisible(false);
  }, []);

  const handlePasteDetect = useCallback(
    (detected: DetectedClipboardUrl) => {
      setPasteModalVisible(false);
      // Navigate to ShareCapture with the detected URL
      navigation.navigate('ShareCapture', {
        url: detected.url,
        source: 'clipboard',
      });
    },
    [navigation]
  );

  const handlePasteInvalid = useCallback(() => {
    Alert.alert(
      'No Link Found',
      'No TikTok or Instagram link was found in your clipboard. Copy a link and try again.',
      [{ text: 'OK' }]
    );
  }, []);

  const handleEnableAutoDetect = useCallback(() => {
    setEnableModalVisible(true);
  }, []);

  const handleEnableModalClose = useCallback(() => {
    setEnableModalVisible(false);
  }, []);

  const handleEnableClipboardDetection = useCallback(() => {
    setClipboardDetectionEnabled(true);
  }, [setClipboardDetectionEnabled]);

  const handleCloseFilters = useCallback(() => {
    setFilterSheetVisible(false);
  }, [setFilterSheetVisible]);

  const handleClearFilters = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setFilters({
      status: [],
      continents: [],
      subregions: [],
      recognitionGroups: [],
    });
  }, [setFilters]);

  // Layout data for FlatList
  const layoutData = useMemo(
    () => computeLayoutData(flatListData),
    [computeLayoutData, flatListData]
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<ListItem> | null | undefined, index: number) => {
      const length = layoutData.lengths[index] ?? 0;
      const offset = layoutData.offsets[index] ?? 0;
      return { length, offset, index };
    },
    [layoutData]
  );

  // Render functions
  const renderStampRow = useCallback(
    (stamps: CountryDisplayItem[], rowKey: string) => {
      const animValues = getRowAnimationValues(rowKey, stamps.length);
      ensureRowVisible(rowKey, animValues);
      return (
        <StampRow stamps={stamps} animValues={animValues} onCountryPress={handleCountryPress} />
      );
    },
    [getRowAnimationValues, ensureRowVisible, handleCountryPress]
  );

  const renderUnvisitedRow = useCallback(
    (countries: UnvisitedCountry[], rowKey: string) => {
      const animValues = getRowAnimationValues(rowKey, countries.length);
      ensureRowVisible(rowKey, animValues);
      return (
        <CountryRow
          countries={countries}
          animValues={animValues}
          onCountryPress={handleUnvisitedCountryPress}
          onAddVisited={handleAddVisited}
          onToggleWishlist={handleToggleWishlist}
        />
      );
    },
    [
      getRowAnimationValues,
      ensureRowVisible,
      handleUnvisitedCountryPress,
      handleAddVisited,
      handleToggleWishlist,
    ]
  );

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      switch (item.type) {
        case 'section-header':
          return (
            <PassportSectionHeader
              title={item.title}
              showShareButton={item.key === 'header-visited' && !!passportShareContext}
              onSharePress={handlePassportShare}
              variant={
                item.key === 'header-visited'
                  ? 'visited'
                  : item.key === 'header-explore'
                    ? 'explore'
                    : 'default'
              }
            />
          );
        case 'stamp-row':
          return renderStampRow(item.data, item.key);
        case 'unvisited-row':
          return renderUnvisitedRow(item.data, item.key);
        case 'empty-state':
          return <PassportEmptyState />;
        default:
          return null;
      }
    },
    [renderStampRow, renderUnvisitedRow, passportShareContext, handlePassportShare]
  );

  // Show paste button when clipboard detection is disabled (iOS only)
  const showPasteButton = !clipboardDetectionEnabled;

  // List header
  const ListHeader = useMemo(
    () => (
      <PassportListHeader
        stats={stats}
        searchQuery={searchQuery}
        isLoading={isLoading}
        filtersActive={filtersActive}
        activeFilterCount={activeFilterCount}
        onSearchChange={setSearchQuery}
        onExplorePress={handleExplorePress}
        onProfilePress={handleProfilePress}
        onPastePress={handlePastePress}
        showPasteButton={showPasteButton}
      />
    ),
    [
      stats,
      searchQuery,
      isLoading,
      filtersActive,
      activeFilterCount,
      setSearchQuery,
      handleExplorePress,
      handleProfilePress,
      handlePastePress,
      showPasteButton,
    ]
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <PassportSkeleton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <Animated.View style={[styles.animatedContainer, { opacity: fadeAnim }]}>
        <FlatList
          data={flatListData}
          renderItem={renderItem}
          keyExtractor={getItemKey}
          getItemLayout={getItemLayout}
          ListHeaderComponent={ListHeader}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          removeClippedSubviews={true}
          maxToRenderPerBatch={20}
          windowSize={11}
          initialNumToRender={15}
          updateCellsBatchingPeriod={30}
          onViewableItemsChanged={handleViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
        />
      </Animated.View>

      <ExploreFilterSheet
        visible={filterSheetVisible}
        filters={filters}
        onFiltersChange={setFilters}
        onClose={handleCloseFilters}
        onClearAll={handleClearFilters}
        onApply={handleCloseFilters}
        trackingPreference={trackingPreference}
      />

      <ShareCardOverlay
        visible={shareCardVisible}
        context={shareCardContext}
        onDismiss={handleShareCardDismiss}
      />

      <OnboardingShareOverlay
        visible={passportShareVisible}
        context={passportShareContext}
        onDismiss={handlePassportShareDismiss}
      />

      <ClipboardPasteModal
        visible={pasteModalVisible}
        onClose={handlePasteModalClose}
        onDetect={handlePasteDetect}
        onInvalidContent={handlePasteInvalid}
        onEnableAutoDetect={handleEnableAutoDetect}
      />

      <ClipboardEnableModal
        visible={enableModalVisible}
        onClose={handleEnableModalClose}
        onEnable={handleEnableClipboardDetection}
      />
    </SafeAreaView>
  );
}
