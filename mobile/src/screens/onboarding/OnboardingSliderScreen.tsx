import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FlatListProps } from 'react-native';
import { FlatList, Image, StyleSheet, TouchableOpacity, View, type ListRenderItem, type ViewToken } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { useResponsive } from '@hooks/useResponsive';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { Analytics } from '@services/analytics';

/* eslint-disable @typescript-eslint/no-require-imports */
const atlasLogo = require('../../../assets/atlasi-logo.png');

const SLIDES = [
  {
    id: '1',
    video: require('../../../assets/country-images/wonders-world/gardens-babylon.mp4'),
    text: 'Stamp your passport for every country you visit.',
    showCTA: false,
  },
  {
    id: '2',
    video: require('../../../assets/country-images/wonders-world/lighthouse-alexandria.mp4'),
    text: 'Save your favorite spots. Remember the magic.',
    showCTA: false,
  },
  {
    id: '3',
    video: require('../../../assets/country-images/wonders-world/mausoleum-halicarnassus.mp4'),
    text: 'Share lists. Swap recs. Inspire your friends.',
    showCTA: true,
  },
];
/* eslint-enable @typescript-eslint/no-require-imports */

interface Slide {
  id: string;
  video: number;
  text: string;
  showCTA: boolean;
}

type Props = OnboardingStackScreenProps<'OnboardingSlider'>;

export function OnboardingSliderScreen({ navigation }: Props) {
  const { screenWidth, screenHeight, isSmallScreen } = useResponsive();

  // Responsive dimensions for layout
  const postcardWidth = screenWidth - (isSmallScreen ? 100 : 80);
  const postcardHeight = postcardWidth * (isSmallScreen ? 1.0 : 1.1);
  const slideHeight = screenHeight - (isSmallScreen ? 180 : 220);

  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList<Slide>>(null);

  // Track screen view
  useEffect(() => {
    Analytics.viewOnboardingSlider();
  }, []);

  // Create video players for each slide
  const player0 = useVideoPlayer(SLIDES[0].video, (p) => {
    p.loop = true;
    p.muted = true;
  });
  const player1 = useVideoPlayer(SLIDES[1].video, (p) => {
    p.loop = true;
    p.muted = true;
  });
  const player2 = useVideoPlayer(SLIDES[2].video, (p) => {
    p.loop = true;
    p.muted = true;
  });

  const players = useMemo(() => [player0, player1, player2], [player0, player1, player2]);

  // Play only active slide's video
  useEffect(() => {
    players.forEach((player, index) => {
      if (index === activeIndex) {
        player.play();
      } else {
        player.pause();
      }
    });
  }, [activeIndex, players]);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<Slide>[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index !== null) {
        setActiveIndex(viewableItems[0].index);
      }
    },
    []
  );

  const viewabilityConfig = useRef({
    viewAreaCoveragePercentThreshold: 50,
  }).current;

  const handleStartJourney = () => {
    navigation.navigate('Motivation');
  };

  const handleLogin = () => {
    Analytics.skipToLogin('OnboardingSlider');
    navigation.navigate('Auth', { screen: 'Login' });
  };

  const goToNext = () => {
    if (activeIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({
        index: activeIndex + 1,
        animated: true,
      });
    }
  };

  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; highestMeasuredFrameIndex: number; averageItemLength: number }) => {
      // Wait for items to render, then retry
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({
          index: info.index,
          animated: true,
        });
      }, 100);
    },
    []
  );

  const renderSlide: ListRenderItem<Slide> = ({ item, index }) => (
    <View
      style={[styles.slide, { width: screenWidth, height: slideHeight }]}
      testID={`carousel-slide-${item.id}`}
    >
      <View style={styles.slideContent}>
        {/* Postcard frame container */}
        <View
          style={[
            styles.postcardContainer,
            { width: postcardWidth + 16, height: postcardHeight + 16 },
          ]}
        >
          {/* Shadow layer behind for stacked effect */}
          <View
            style={[styles.postcardShadow, { width: postcardWidth, height: postcardHeight }]}
          />
          {/* Main postcard frame */}
          <View
            style={[styles.postcardFrame, { width: postcardWidth, height: postcardHeight }]}
          >
            <VideoView
              player={players[index]}
              style={styles.video}
              contentFit="cover"
              nativeControls={false}
            />
          </View>
        </View>

        {/* Text below postcard - Text component handles responsive sizing */}
        <Text variant="title" style={styles.slideText}>
          {item.text}
        </Text>

        {/* Pagination dots - inside slide content */}
        <View style={styles.pagination}>
          {SLIDES.map((_, dotIndex) => (
            <View
              key={dotIndex}
              style={[styles.dot, dotIndex === activeIndex && styles.dotActive]}
            />
          ))}
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header with logo and login */}
      <View style={styles.header}>
        <Image source={atlasLogo} style={styles.logo} resizeMode="contain" />
        <TouchableOpacity
          onPress={handleLogin}
          style={styles.loginButton}
          testID="carousel-login-button"
        >
          <Text variant="label" style={styles.loginText}>
            Login
          </Text>
        </TouchableOpacity>
      </View>

      {/* Carousel */}
      <FlatList
        ref={flatListRef}
        data={SLIDES}
        renderItem={renderSlide}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        bounces={false}
        contentContainerStyle={styles.carouselContent}
        onScrollToIndexFailed={
          handleScrollToIndexFailed as FlatListProps<Slide>['onScrollToIndexFailed']
        }
        extraData={activeIndex}
      />

      {/* Bottom section: button only - fixed position */}
      <View style={styles.bottomSection}>
        {/* Next / Start my journey button */}
        <TouchableOpacity
          style={styles.ctaButton}
          onPress={activeIndex === SLIDES.length - 1 ? handleStartJourney : goToNext}
          testID="start-journey-button"
        >
          <Text variant="label" style={styles.ctaButtonText}>
            {activeIndex === SLIDES.length - 1 ? 'Start my journey' : 'Next'}
          </Text>
          {activeIndex < SLIDES.length - 1 && (
            <Ionicons name="arrow-forward" size={20} color={colors.midnightNavy} />
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  logo: {
    width: 140,
    height: 40,
  },
  loginButton: {
    position: 'absolute',
    right: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  loginText: {
    color: colors.midnightNavy,
  },
  carouselContent: {
    alignItems: 'center',
  },
  slide: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  slideContent: {
    alignItems: 'center',
    paddingTop: 8,
  },
  postcardContainer: {
    position: 'relative',
  },
  postcardShadow: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: colors.stormGray,
    borderRadius: 16,
    opacity: 0.3,
  },
  postcardFrame: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: colors.paperBeige,
    borderRadius: 16,
    padding: 12,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  video: {
    flex: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  slideText: {
    color: colors.midnightNavy,
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 32,
  },
  bottomSection: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingVertical: 20,
    paddingBottom: 40,
    alignItems: 'center',
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.stormGray,
    opacity: 0.4,
  },
  dotActive: {
    backgroundColor: colors.midnightNavy,
    opacity: 1,
    width: 24,
  },
  ctaButton: {
    backgroundColor: colors.sunsetGold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 56,
    borderRadius: 12,
    gap: 8,
    minWidth: 260,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaButtonText: {
    fontSize: 16,
    color: colors.midnightNavy,
    fontWeight: '600',
  },
});
