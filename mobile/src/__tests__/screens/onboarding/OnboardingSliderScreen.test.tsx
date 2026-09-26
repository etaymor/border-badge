/**
 * OnboardingSliderScreen — the animated four-beat intro.
 *
 * Beat visuals are replaced by stubs that record their props, so these tests
 * pin the screen's contract: which beat may animate (and when), the mount
 * window, analytics, haptics, navigation, and that nothing (video decoders,
 * timers) outlives the screen.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { AccessibilityInfo, FlatList } from 'react-native';
import * as Haptics from 'expo-haptics';

import { __resetSplashGateForTests, markSplashDone } from '@components/splash/splashGate';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { OnboardingSliderScreen } from '@screens/onboarding/OnboardingSliderScreen';
import { Analytics } from '@services/analytics';

import { createMockNavigation } from '../../utils/mockFactories';

type BeatProps = { isActive: boolean; canPlay: boolean; reduceMotion: boolean };
const mockBeatProps: Record<string, BeatProps> = {};

function mockBeat(key: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories may only use require
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: BeatProps) => {
      mockBeatProps[key] = props;
      return <View testID={`stub-beat-${key}`} />;
    },
  };
}

jest.mock('@components/onboarding/introBeats/PhotoTripsBeat', () => mockBeat('trips'));
jest.mock('@components/onboarding/introBeats/SocialSaveBeat', () => mockBeat('share'));
jest.mock('@components/onboarding/introBeats/PassportFillBeat', () => mockBeat('passport'));
jest.mock('@components/onboarding/introBeats/GuessWhereBeat', () => mockBeat('guess_where'));

let mockIsFocused = true;
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => mockIsFocused,
}));

let mockReduceMotion = false;
jest.mock('@hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReduceMotion,
}));

jest.mock('@services/analytics', () => ({
  Analytics: {
    viewOnboardingSlider: jest.fn(),
    viewOnboardingSlide: jest.fn(),
    skipToLogin: jest.fn(),
  },
}));

function renderScreen() {
  const navigation = createMockNavigation();
  render(
    <OnboardingSliderScreen
      navigation={
        navigation as unknown as OnboardingStackScreenProps<'OnboardingSlider'>['navigation']
      }
      route={{} as never}
    />
  );
  return navigation;
}

/** The outer (Animated) FlatList element, which still holds the scroll handler object. */
function pager(): ReactTestInstance {
  return screen.UNSAFE_getByProps({ testID: 'intro-pager' });
}

function pageWidth(): number {
  return (pager().props.getItemLayout(null, 1) as { length: number }).length;
}

/** A scroll frame at `page` page-widths (fractions allowed), as the UI thread reports it. */
function scrollTo(page: number) {
  const x = page * pageWidth();
  act(() => {
    pager().props.onScroll.onScroll({ contentOffset: { x, y: 0 } });
  });
}

function settleOn(index: number) {
  const x = index * pageWidth();
  act(() => {
    pager().props.onScroll.onScroll({ contentOffset: { x, y: 0 } });
    pager().props.onScroll.onMomentumEnd({ contentOffset: { x, y: 0 } });
  });
}

function slideViews(): { index: number; beat: string; via: string }[] {
  return (Analytics.viewOnboardingSlide as jest.Mock).mock.calls.map(([props]) => props);
}

function mountedBeats() {
  return Object.keys(mockBeatProps).filter((key) =>
    screen.queryByTestId(`stub-beat-${key}`, { includeHiddenElements: true })
  );
}

describe('OnboardingSliderScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(mockBeatProps)) delete mockBeatProps[key];
    mockIsFocused = true;
    mockReduceMotion = false;
    __resetSplashGateForTests();
    markSplashDone();
  });

  it('renders four pages and only the first beat is active', () => {
    renderScreen();
    for (let i = 1; i <= 4; i++) {
      expect(screen.getByTestId(`carousel-slide-${i}`)).toBeTruthy();
    }
    expect(mockBeatProps.trips.isActive).toBe(true);
    expect(mockBeatProps.trips.canPlay).toBe(true);
    expect(mockBeatProps.share.isActive).toBe(false);
  });

  it('mounts visuals only for the settled page and its neighbours', () => {
    renderScreen();
    expect(mountedBeats().sort()).toEqual(['share', 'trips']);
    settleOn(2);
    expect(mountedBeats().sort()).toEqual(['guess_where', 'passport', 'share']);
  });

  it('holds every beat while the splash is still up', () => {
    __resetSplashGateForTests();
    renderScreen();
    expect(mockBeatProps.trips.canPlay).toBe(false);
    expect(Analytics.viewOnboardingSlide).not.toHaveBeenCalled();

    act(() => markSplashDone());
    expect(mockBeatProps.trips.canPlay).toBe(true);
    expect(Analytics.viewOnboardingSlide).toHaveBeenCalledWith({
      index: 1,
      beat: 'trips',
      via: 'initial',
    });
  });

  it('pauses every beat when the screen is not focused (e.g. Login on top)', () => {
    mockIsFocused = false;
    renderScreen();
    expect(mockBeatProps.trips.canPlay).toBe(false);
    expect(mockBeatProps.share.canPlay).toBe(false);
  });

  it('tracks the slider view and the first slide once on mount', () => {
    renderScreen();
    expect(Analytics.viewOnboardingSlider).toHaveBeenCalledTimes(1);
    expect(Analytics.viewOnboardingSlide).toHaveBeenCalledTimes(1);
    expect(Analytics.viewOnboardingSlide).toHaveBeenCalledWith({
      index: 1,
      beat: 'trips',
      via: 'initial',
    });
  });

  it('Continue advances one page and tracks via tap once the scroll lands', () => {
    renderScreen();
    fireEvent.press(screen.getByTestId('start-journey-button'));
    scrollTo(1);

    expect(mockBeatProps.share.isActive).toBe(true);
    expect(Analytics.viewOnboardingSlide).toHaveBeenLastCalledWith({
      index: 2,
      beat: 'share',
      via: 'tap',
    });
  });

  it('Continue keeps the outgoing beat on its final frame while it slides away', () => {
    renderScreen();
    fireEvent.press(screen.getByTestId('start-journey-button'));
    scrollTo(0.3);
    scrollTo(0.7);

    // Mid-slide: the outgoing beat must not reset to its empty pose, and the
    // incoming beat must not start its entrance off screen.
    expect(mockBeatProps.trips.isActive).toBe(true);
    expect(mockBeatProps.share.isActive).toBe(false);

    scrollTo(1);
    expect(mockBeatProps.trips.isActive).toBe(false);
    expect(mockBeatProps.share.isActive).toBe(true);
  });

  it('a tap that lands, then its momentum end, reports and buzzes nothing twice', () => {
    renderScreen();
    fireEvent.press(screen.getByTestId('start-journey-button'));
    settleOn(1);
    expect(slideViews().filter((v) => v.beat === 'share')).toEqual([
      { index: 2, beat: 'share', via: 'tap' },
    ]);
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });

  it('two quick Continue taps advance two pages', () => {
    const scrollToIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex');
    renderScreen();
    fireEvent.press(screen.getByTestId('start-journey-button'));
    fireEvent.press(screen.getByTestId('start-journey-button'));
    expect(scrollToIndex.mock.calls.map(([params]) => params.index)).toEqual([1, 2]);
    settleOn(2);
    expect(mockBeatProps.passport.isActive).toBe(true);
    expect(slideViews().map((v) => v.beat)).toEqual(['trips', 'share', 'passport']);
    scrollToIndex.mockRestore();
  });

  it('under Reduce Motion, Continue jumps and activates the next beat at once', () => {
    mockReduceMotion = true;
    renderScreen();
    fireEvent.press(screen.getByTestId('start-journey-button'));
    expect(mockBeatProps.share.isActive).toBe(true);
    expect(Analytics.viewOnboardingSlide).toHaveBeenLastCalledWith({
      index: 2,
      beat: 'share',
      via: 'tap',
    });
  });

  it('a double flick (one momentum end) mounts the page being dragged in and reports the skipped beat', () => {
    renderScreen();
    scrollTo(0.8);
    // Second flick interrupts the first deceleration: page 3 slides into view
    // before anything has settled.
    scrollTo(1.6);
    expect(mountedBeats()).toContain('passport');

    settleOn(2);
    expect(mockBeatProps.passport.isActive).toBe(true);
    expect(slideViews().map((v) => [v.beat, v.via])).toEqual([
      ['trips', 'initial'],
      ['share', 'swipe'],
      ['passport', 'swipe'],
    ]);
  });

  it('a drag released exactly on a page boundary still settles', () => {
    renderScreen();
    scrollTo(1);
    act(() => {
      pager().props.onScroll.onEndDrag({ contentOffset: { x: pageWidth(), y: 0 } });
    });
    expect(mockBeatProps.share.isActive).toBe(true);
  });

  it('a CTA tap while the last page is still decelerating goes to Motivation', () => {
    const navigation = renderScreen();
    settleOn(2);
    scrollTo(2.7);
    const cta = screen.getByTestId('start-journey-button');
    expect(cta.props.accessibilityLabel).toBe('Start my journey');
    fireEvent.press(cta);
    expect(navigation.replace).toHaveBeenCalledWith('Motivation');
  });

  it('a swipe settle activates the beat, fires a selection haptic, and tracks via swipe', () => {
    renderScreen();
    settleOn(2);
    expect(mockBeatProps.passport.isActive).toBe(true);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Analytics.viewOnboardingSlide).toHaveBeenLastCalledWith({
      index: 3,
      beat: 'passport',
      via: 'swipe',
    });
  });

  it('does not re-track a beat that was already seen', () => {
    renderScreen();
    settleOn(1);
    settleOn(0);
    settleOn(1);
    const shareViews = (Analytics.viewOnboardingSlide as jest.Mock).mock.calls.filter(
      ([props]) => props.beat === 'share'
    );
    expect(shareViews).toHaveLength(1);
  });

  it('settling on the same page does nothing', () => {
    renderScreen();
    settleOn(0);
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });

  it('on the last page the CTA says Start my journey and replaces to Motivation', () => {
    const navigation = renderScreen();
    settleOn(3);
    const cta = screen.getByTestId('start-journey-button');
    expect(cta.props.accessibilityLabel).toBe('Start my journey');
    fireEvent.press(cta);
    expect(navigation.replace).toHaveBeenCalledWith('Motivation');
  });

  it('Login still skips to the auth flow', () => {
    const navigation = renderScreen();
    fireEvent.press(screen.getByTestId('carousel-login-button'));
    expect(Analytics.skipToLogin).toHaveBeenCalledWith('OnboardingSlider');
    expect(navigation.navigate).toHaveBeenCalledWith('Auth', { screen: 'Login' });
  });

  it('announces the step on change, not on mount', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    renderScreen();
    expect(announce).not.toHaveBeenCalled();
    settleOn(1);
    expect(announce).toHaveBeenCalledWith('Step 2 of 4. Seen it? Saved it.');
    announce.mockRestore();
  });

  it('creates no video players', () => {
    const { useVideoPlayer } = jest.requireMock('expo-video');
    renderScreen();
    expect(useVideoPlayer).not.toHaveBeenCalled();
  });

  it('schedules no JS timers or intervals from intro code (motion is all UI-thread)', () => {
    // React Native internals (Animated's jest mocks, VirtualizedList batching)
    // schedule their own timers under jest, so a raw getTimerCount() would
    // measure the framework. What matters is that nothing in the intro does:
    // no JS timer may be scheduled directly by intro code.
    const introFrames =
      /src\/(components\/onboarding\/introBeats|screens\/onboarding\/OnboardingSlider)/;
    const offenders: string[] = [];
    const originals = { setTimeout: global.setTimeout, setInterval: global.setInterval };
    for (const name of ['setTimeout', 'setInterval'] as const) {
      jest.spyOn(global, name).mockImplementation(((...args: Parameters<typeof setTimeout>) => {
        // The direct caller: first frame past this spy and jest-mock's wrappers.
        const caller = (new Error().stack ?? '')
          .split('\n')
          .slice(1)
          .find((frame) => !frame.includes('jest-mock') && !frame.includes(__filename));
        if (caller && introFrames.test(caller)) offenders.push(`${name}: ${caller}`);
        return (originals[name] as typeof setTimeout)(...args);
      }) as never);
    }
    try {
      renderScreen();
      settleOn(1);
      fireEvent.press(screen.getByTestId('start-journey-button'));
      settleOn(3);
      screen.unmount();
    } finally {
      jest.restoreAllMocks();
    }
    expect(offenders).toEqual([]);
  });
});
