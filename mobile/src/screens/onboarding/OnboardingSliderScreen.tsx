import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FlatListProps } from 'react-native';
import {
  Animated,
  FlatList,
  Image,
  StyleSheet,
  TouchableOpacity,
  View,
  type ListRenderItem,
  type ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { useResponsive } from '@hooks/useResponsive';
import { useScreenEntrance } from '@hooks/useScreenEntrance';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { Analytics } from '@services/analytics';

/* eslint-disable @typescript-eslint/no-require-imports */
const atlasLogo = require('../../../assets/atlasi-logo.png');

const SLIDES = [
  {
    id: '1',
    video: require('../../../assets/onboarding-videos/onboarding1-share.mp4'),
    headline: 'From scroll to story',
    subtext:
      "Share any post from TikTok or Instagram directly to Atlasi. We'll extract the location and save the inspiration to your map instantly.",
  },
  {
    id: '2',
    video: require('../../../assets/onboarding-videos/onboarding3-trips.mp4'),
    headline: 'Your memories, mapped',
    subtext:
      'Atlasi intelligently scans your photo library to reconstruct your past adventures into a beautiful, chronological travelogue.',
  },
  {
    id: '3',
    video: require('../../../assets/onboarding-videos/onboarding2-country-track.mp4'),
    headline: 'Your global archive',
    subtext:
      "A signature gallery of where you've been and a curated bucket list for where the world takes you next.",
  },
];
/* eslint-enable @typescript-eslint/no-require-imports */

interface Slide {
  id: string;
  video: number;
  headline: string;
  subtext: string;
}

// Video dimensions (820x1280 aspect ratio)
const VIDEO_WIDTH = 820;
const VIDEO_HEIGHT = 1280;

// Responsive layout configuration per screen size
interface LayoutConfig {
  framePadding: number;
  textMarginTop: number;
  textPaddingHorizontal: number;
  paginationMarginTop: number;
  reservedHeight: number;
  borderRadius: number;
  videoBorderRadius: number;
}

const LAYOUT_CONFIGS: Record<'small' | 'medium' | 'large', Omit<LayoutConfig, 'reservedHeight'>> = {
  small: {
    framePadding: 8,
    textMarginTop: 12,
    textPaddingHorizontal: 24,
    paginationMarginTop: 8,
    borderRadius: 20,
    videoBorderRadius: 12,
  },
  medium: {
    framePadding: 10,
    textMarginTop: 16,
    textPaddingHorizontal: 32,
    paginationMarginTop: 12,
    borderRadius: 20,
    videoBorderRadius: 12,
  },
  large: {
    framePadding: 10,
    textMarginTop: 20,
    textPaddingHorizontal: 40,
    paginationMarginTop: 14,
    borderRadius: 20,
    videoBorderRadius: 12,
  },
};

function getLayoutConfig(
  screenSize: 'small' | 'medium' | 'large',
  screenWidth: number,
  screenHeight: number
) {
  const config = LAYOUT_CONFIGS[screenSize];

  // Reserve space for: header (~52), headline+subtext (~120), pagination (~30), bottom button area (~100)
  // Reserve space for header, text, pagination dots, and bottom button
  const reservedHeight = screenSize === 'small' ? 340 : screenSize === 'medium' ? 320 : 300;

  // Available height for the video frame
  const availableHeight = screenHeight - reservedHeight;

  // Derive frame dimensions from available height, scaled down to fit with text/dots/button
  const frameHeight = availableHeight * 0.75;
  let frameWidth = frameHeight * (VIDEO_WIDTH / VIDEO_HEIGHT);

  // Clamp frame width so it doesn't exceed screen width minus minimum margins
  const maxFrameWidth = screenWidth - 40;
  if (frameWidth > maxFrameWidth) {
    frameWidth = maxFrameWidth;
  }

  // Video fills the frame minus padding
  const videoWidth = frameWidth - config.framePadding * 2;
  const videoHeight = frameHeight - config.framePadding * 2;

  return {
    ...config,
    reservedHeight,
    videoWidth,
    videoHeight,
    frameWidth,
    frameHeight,
  };
}

type Props = OnboardingStackScreenProps<'OnboardingSlider'>;

export function OnboardingSliderScreen({ navigation }: Props) {
  const { screenWidth, screenHeight, screenSize } = useResponsive();
  const { getAnimatedStyle, getButtonStyle } = useScreenEntrance({ elementCount: 2 });

  // Get responsive layout configuration
  const layout = useMemo(
    () => getLayoutConfig(screenSize, screenWidth, screenHeight),
    [screenSize, screenWidth, screenHeight]
  );

  // Slide height: just enough for video frame + headline + subtext + dots + spacing
  const slideHeight = layout.frameHeight + 160;

  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList<Slide>>(null);

  // Animated opacity for fading in video after source swap
  const videoOpacity = useRef(new Animated.Value(1)).current;

  // Track screen view
  useEffect(() => {
    Analytics.viewOnboardingSlider();
  }, []);

  // Single video player — swap source on slide change to avoid 3 simultaneous decoders
  const player = useVideoPlayer(SLIDES[0].video, (p) => {
    p.loop = true;
    p.muted = true;
    p.audioMixingMode = 'mixWithOthers';
    p.play();
  });

  // Fade in the VideoView once the new source is ready to play
  useEffect(() => {
    const subscription = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') {
        Animated.timing(videoOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();
      }
    });
    return () => subscription.remove();
  }, [player, videoOpacity]);

  // Swap video source when active slide changes
  const prevIndexRef = useRef(0);
  useEffect(() => {
    if (activeIndex !== prevIndexRef.current) {
      prevIndexRef.current = activeIndex;
      videoOpacity.setValue(0);
      try {
        player.replace(SLIDES[activeIndex].video);
        player.play();
      } catch {
        // Native player may be released
      }
    }
  }, [activeIndex, player, videoOpacity]);

  // Pause video player when screen loses focus to free GPU resources
  useEffect(() => {
    const unsubscribeFocus = navigation.addListener('focus', () => {
      try {
        player.play();
      } catch {
        // Native player may be released
      }
    });
    const unsubscribeBlur = navigation.addListener('blur', () => {
      try {
        player.pause();
      } catch {
        // Native player may be released
      }
    });
    return () => {
      unsubscribeFocus();
      unsubscribeBlur();
    };
  }, [navigation, player]);

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
    navigation.replace('Motivation');
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
        {/* Video frame - simplified, no shadow layer */}
        <View
          style={[
            styles.videoFrame,
            {
              width: layout.frameWidth,
              height: layout.frameHeight,
              padding: layout.framePadding,
              borderRadius: layout.borderRadius,
            },
          ]}
        >
          {index === activeIndex ? (
            <Animated.View
              style={[
                styles.video,
                { borderRadius: layout.videoBorderRadius, opacity: videoOpacity },
              ]}
            >
              <VideoView
                player={player}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                nativeControls={false}
              />
            </Animated.View>
          ) : (
            <View
              style={[
                styles.video,
                styles.videoPlaceholder,
                { borderRadius: layout.videoBorderRadius },
              ]}
            />
          )}
        </View>

        {/* Text below video */}
        <View
          style={[
            styles.textContainer,
            {
              marginTop: layout.textMarginTop,
              paddingHorizontal: layout.textPaddingHorizontal,
            },
          ]}
        >
          <Text variant="title" style={styles.headline}>
            {item.headline}
          </Text>
          <Text variant="body" style={styles.subtext}>
            {item.subtext}
          </Text>
        </View>

        {/* Pagination dots */}
        <View style={[styles.pagination, { marginTop: layout.paginationMarginTop }]}>
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
      <Animated.View style={[styles.header, getAnimatedStyle(0)]}>
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
      </Animated.View>

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
        <Animated.View style={getButtonStyle(1)}>
          <TouchableOpacity
            style={styles.ctaButton}
            onPress={activeIndex === SLIDES.length - 1 ? handleStartJourney : goToNext}
            testID="start-journey-button"
          >
            <Text variant="label" style={styles.ctaButtonText}>
              {activeIndex === SLIDES.length - 1 ? 'Start my journey' : 'Continue'}
            </Text>
            {activeIndex < SLIDES.length - 1 && (
              <Ionicons name="arrow-forward" size={20} color={colors.midnightNavy} />
            )}
          </TouchableOpacity>
        </Animated.View>
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
    alignItems: 'flex-start',
  },
  slide: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  slideContent: {
    alignItems: 'center',
    paddingTop: 16,
  },
  videoFrame: {
    backgroundColor: colors.paperBeige,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  video: {
    flex: 1,
    overflow: 'hidden',
  },
  videoPlaceholder: {
    backgroundColor: colors.paperBeige,
  },
  textContainer: {
    alignItems: 'center',
  },
  headline: {
    color: colors.midnightNavy,
    textAlign: 'center',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.56, // -2% tracking
    marginBottom: 8,
  },
  subtext: {
    color: colors.midnightNavy,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '400',
    opacity: 0.7,
    lineHeight: 22,
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
    borderRadius: 9999,
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
