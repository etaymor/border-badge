import { useIsFocused } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated as RNAnimated,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type FlatList,
  type ListRenderItem,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import IntroBeatPage from '@components/onboarding/introBeats/IntroBeatPage';
import {
  INTRO_BEATS,
  introAnnouncement,
  type IntroBeatCopy,
} from '@components/onboarding/introBeats/introBeats';
import IntroCta from '@components/onboarding/introBeats/IntroCta';
import IntroPageDots from '@components/onboarding/introBeats/IntroPageDots';
import { useSplashDone } from '@components/splash/splashGate';
import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { useReducedMotion } from '@hooks/useReducedMotion';
import { useScreenEntrance } from '@hooks/useScreenEntrance';
import { useStableCallback } from '@hooks/useStableCallback';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { Analytics, type OnboardingIntroSlideVia } from '@services/analytics';

/* eslint-disable @typescript-eslint/no-require-imports */
const atlasLogo = require('../../../assets/atlasi-logo.png');
/* eslint-enable @typescript-eslint/no-require-imports */

const HEADER_HEIGHT = 52;
/** Kicker + two-line headline + up to three lines of subtext. */
const TEXT_HEIGHT = 158;
/** Dots (8) + gap (20) + CTA (56) + top padding (8), excluding the bottom inset. */
const BOTTOM_BAND = 92;
const MIN_HERO_HEIGHT = 260;
const MAX_HERO_ASPECT = 1.3;
/** The cream sheet rises over the navy hero by this much (as in the photo flow). */
const SHEET_OVERLAP = 28;
const LAST_INDEX = INTRO_BEATS.length - 1;

type Props = OnboardingStackScreenProps<'OnboardingSlider'>;

/**
 * The new-user intro: four animated beats that tell the Atlasi story (find the
 * places you forgot, save from Instagram/TikTok, collect the world, Guess
 * Where), then hand off to Motivation with `replace`, which unmounts
 * everything here. Layout follows the photo onboarding: a full-bleed navy hero
 * with a cream sheet rising over it for the copy and the CTA.
 *
 * Performance contract (see useIntroBeatClock): only the settled beat
 * animates, only while this screen is focused and the splash has gone; pages
 * two or more away render no visual at all. No timers, no per-frame setState.
 *
 * Page tracking: `nearestIndex` follows the scroll position (set from the UI
 * thread only when the rounded page changes) and drives mounting and the CTA
 * action. `activeIndex` is the settled page and drives playback and analytics;
 * swipes and animated Continue taps both reach it through `settle`, only once
 * the scroll has landed, so an outgoing beat keeps its final frame while it
 * slides away.
 */
export function OnboardingSliderScreen({ navigation }: Props) {
  const { width: pageWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const isFocused = useIsFocused();
  const splashDone = useSplashDone();
  const canPlay = isFocused && splashDone;

  const [activeIndex, setActiveIndex] = useState(0);
  const [nearestIndex, setNearestIndex] = useState(0);
  const scrollX = useSharedValue(0);
  const nearestOnUi = useSharedValue(0);
  /** Page an animated Continue tap is scrolling to, or -1. Read by the scroll worklet. */
  const tapTarget = useSharedValue(-1);
  const pendingTapRef = useRef<number | null>(null);
  /** Mirrors `activeIndex` synchronously, so two settles in one batch see each other. */
  const settledRef = useRef(0);
  const listRef = useRef<FlatList<IntroBeatCopy>>(null);
  const reportedRef = useRef<Set<number>>(new Set());
  const announcedRef = useRef(0);

  const { getAnimatedStyle, getButtonStyle, startAnimation } = useScreenEntrance({
    elementCount: 3,
    autoStart: false,
  });

  const bottomPadding = Math.max(insets.bottom, 16) + 8;
  const heroHeight = Math.round(
    Math.min(
      pageWidth * MAX_HERO_ASPECT,
      Math.max(
        MIN_HERO_HEIGHT,
        windowHeight - insets.top - HEADER_HEIGHT - TEXT_HEIGHT - BOTTOM_BAND - bottomPadding
      )
    )
  );

  const reportSlide = useStableCallback((index: number, via: OnboardingIntroSlideVia) => {
    if (reportedRef.current.has(index)) return;
    reportedRef.current.add(index);
    Analytics.viewOnboardingSlide({ index: index + 1, beat: INTRO_BEATS[index].key, via });
  });

  useEffect(() => {
    Analytics.viewOnboardingSlider();
  }, []);

  // Hold the entrance (and the first slide view) until the splash dissolves.
  useEffect(() => {
    if (!splashDone) return;
    startAnimation();
    reportSlide(0, 'initial');
  }, [reportSlide, splashDone, startAnimation]);

  useEffect(() => {
    if (announcedRef.current === activeIndex) return;
    announcedRef.current = activeIndex;
    AccessibilityInfo.announceForAccessibility(
      introAnnouncement(activeIndex, INTRO_BEATS.length, INTRO_BEATS[activeIndex].headline)
    );
  }, [activeIndex]);

  const settle = useStableCallback((rawIndex: number, via: OnboardingIntroSlideVia) => {
    const index = Math.max(0, Math.min(LAST_INDEX, rawIndex));
    const from = settledRef.current;
    if (index === from) return;
    // A fast double flick cancels the first deceleration, so only one settle
    // fires; the beats it passed through were still dragged into view.
    const step = index > from ? 1 : -1;
    for (let skipped = from + step; skipped !== index; skipped += step) {
      reportSlide(skipped, via);
    }
    settledRef.current = index;
    setActiveIndex(index);
    setNearestIndex(index);
    if (via === 'swipe') Haptics.selectionAsync().catch(() => {});
    reportSlide(index, via);
  });

  const handleSettle = useStableCallback((rawIndex: number) => {
    const via = pendingTapRef.current === rawIndex ? 'tap' : 'swipe';
    pendingTapRef.current = null;
    tapTarget.value = -1;
    settle(rawIndex, via);
  });

  const scrollHandler = useAnimatedScrollHandler(
    {
      onScroll: (event) => {
        const x = event.contentOffset.x;
        scrollX.value = x;
        const nearest = Math.round(x / pageWidth);
        if (nearest !== nearestOnUi.value) {
          nearestOnUi.value = nearest;
          runOnJS(setNearestIndex)(Math.max(0, Math.min(LAST_INDEX, nearest)));
        }
        // An animated Continue tap settles when it lands, not when it starts,
        // without depending on a momentum-end event for programmatic scrolls.
        if (tapTarget.value >= 0 && Math.abs(x - tapTarget.value * pageWidth) < 1) {
          const target = tapTarget.value;
          tapTarget.value = -1;
          runOnJS(handleSettle)(target);
        }
      },
      onEndDrag: (event) => {
        // Released exactly on a page: no momentum phase, so no momentum end.
        const x = event.contentOffset.x;
        const page = Math.round(x / pageWidth);
        if (Math.abs(x - page * pageWidth) < 1) runOnJS(handleSettle)(page);
      },
      onMomentumEnd: (event) => {
        runOnJS(handleSettle)(Math.round(event.contentOffset.x / pageWidth));
      },
    },
    [pageWidth, handleSettle]
  );

  const goToNext = useStableCallback(() => {
    // Continue from where the pager is headed: a pending tap's target, else the
    // page nearest the current scroll position.
    const next = (pendingTapRef.current ?? nearestIndex) + 1;
    if (next > LAST_INDEX) return;
    if (reduceMotion) {
      listRef.current?.scrollToIndex({ index: next, animated: false });
      settle(next, 'tap');
      return;
    }
    pendingTapRef.current = next;
    tapTarget.value = next;
    listRef.current?.scrollToIndex({ index: next, animated: true });
  });

  const handleCta = useStableCallback(() => {
    // Branch on what the label shows (it follows the scroll), not on the
    // settled page, so a tap during the last deceleration still finishes.
    if ((pendingTapRef.current ?? nearestIndex) === LAST_INDEX) {
      navigation.replace('Motivation');
    } else {
      goToNext();
    }
  });

  const handleLogin = useStableCallback(() => {
    Analytics.skipToLogin('OnboardingSlider');
    navigation.navigate('Auth', { screen: 'Login' });
  });

  const getItemLayout = useCallback(
    (_data: ArrayLike<IntroBeatCopy> | null | undefined, index: number) => ({
      length: pageWidth,
      offset: pageWidth * index,
      index,
    }),
    [pageWidth]
  );

  const renderPage: ListRenderItem<IntroBeatCopy> = ({ item, index }) => (
    <IntroBeatPage
      beat={item}
      index={index}
      pageWidth={pageWidth}
      heroHeight={heroHeight}
      textHeight={TEXT_HEIGHT}
      scrollX={scrollX}
      isActive={index === activeIndex}
      canPlay={canPlay}
      reduceMotion={reduceMotion}
      showVisual={Math.abs(index - activeIndex) <= 1 || Math.abs(index - nearestIndex) <= 1}
    />
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <RNAnimated.View style={[styles.header, getAnimatedStyle(0)]}>
        <Image source={atlasLogo} style={styles.logo} contentFit="contain" />
        <TouchableOpacity
          onPress={handleLogin}
          style={styles.loginButton}
          accessibilityRole="button"
          accessibilityLabel="Log in to your account"
          testID="carousel-login-button"
        >
          <Text variant="label" style={styles.loginText}>
            Login
          </Text>
        </TouchableOpacity>
      </RNAnimated.View>

      <View style={styles.body}>
        {/* Fixed backdrop: navy hero, cream sheet rising over it. Pages scroll above. */}
        <View style={[styles.hero, { height: heroHeight + SHEET_OVERLAP }]} />
        <View style={[styles.sheet, { top: heroHeight }]} />

        <RNAnimated.View style={[styles.pager, getAnimatedStyle(1)]}>
          <Animated.FlatList
            ref={listRef}
            data={INTRO_BEATS}
            renderItem={renderPage}
            keyExtractor={(item) => item.key}
            horizontal
            pagingEnabled
            bounces={false}
            showsHorizontalScrollIndicator={false}
            onScroll={scrollHandler}
            scrollEventThrottle={16}
            getItemLayout={getItemLayout}
            initialNumToRender={INTRO_BEATS.length}
            extraData={{ activeIndex, nearestIndex, canPlay, reduceMotion, heroHeight }}
            testID="intro-pager"
          />
        </RNAnimated.View>

        <View style={[styles.bottom, { paddingBottom: bottomPadding }]}>
          <IntroPageDots count={INTRO_BEATS.length} scrollX={scrollX} pageWidth={pageWidth} />
          <RNAnimated.View style={getButtonStyle(2)}>
            <IntroCta
              scrollX={scrollX}
              pageWidth={pageWidth}
              count={INTRO_BEATS.length}
              isLast={activeIndex === LAST_INDEX}
              showsFinalLabel={nearestIndex === LAST_INDEX}
              reduceMotion={reduceMotion}
              onPress={handleCta}
            />
          </RNAnimated.View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  header: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  logo: {
    width: 128,
    height: 36,
  },
  loginButton: {
    position: 'absolute',
    right: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  loginText: {
    color: colors.midnightNavy,
  },
  body: {
    flex: 1,
  },
  hero: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.midnightNavy,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: SHEET_OVERLAP,
    borderTopRightRadius: SHEET_OVERLAP,
    borderCurve: 'continuous',
    backgroundColor: colors.warmCream,
  },
  pager: {
    flex: 1,
  },
  bottom: {
    alignItems: 'center',
    gap: 20,
    paddingTop: 8,
  },
});
