/**
 * U6 — one active video decoder at a time (R7, R13).
 *
 * WelcomeCarouselScreen: on blur it releases the native decoder via
 * player.replace(null); on focus it restores the source and calls play().
 * This mirrors ContinentIntroScreen so a blurred screen never holds a decoder.
 *
 * OnboardingSliderScreen: guard test — the 3-player design plays exactly the
 * active slide's player and pauses the other two, so only one player decodes.
 * Blur pauses all players; focus resumes only the active one.
 */

import { render } from '../../utils/testUtils';
import { createMockNavigation } from '../../utils/mockFactories';

import { WelcomeCarouselScreen } from '@screens/onboarding/WelcomeCarouselScreen';
import { OnboardingSliderScreen } from '@screens/onboarding/OnboardingSliderScreen';

import type { OnboardingStackScreenProps } from '@navigation/types';

const { useVideoPlayer } = jest.requireMock('expo-video');

/**
 * Build a navigation mock that captures the focus/blur callbacks registered
 * via navigation.addListener so tests can invoke them directly.
 */
function createFocusCapturingNavigation() {
  const listeners: Record<string, (() => void)[]> = { focus: [], blur: [] };
  const navigation = createMockNavigation();
  navigation.addListener = jest.fn((event: 'focus' | 'blur', cb: () => void) => {
    (listeners[event] ??= []).push(cb);
    return jest.fn();
  }) as unknown as typeof navigation.addListener;
  return {
    navigation,
    emitFocus: () => listeners.focus.forEach((cb) => cb()),
    emitBlur: () => listeners.blur.forEach((cb) => cb()),
  };
}

describe('U6 video decoder lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('WelcomeCarouselScreen', () => {
    it('releases the decoder with replace(null) on blur', () => {
      const { navigation, emitBlur } = createFocusCapturingNavigation();

      render(
        <WelcomeCarouselScreen
          navigation={
            navigation as unknown as OnboardingStackScreenProps<'WelcomeCarousel'>['navigation']
          }
          route={{} as never}
        />
      );

      const player = useVideoPlayer.mock.results[0].value;
      player.replace.mockClear();

      emitBlur();

      expect(player.replace).toHaveBeenCalledTimes(1);
      expect(player.replace).toHaveBeenCalledWith(null);
    });

    it('restores the source and plays on focus', () => {
      const { navigation, emitFocus } = createFocusCapturingNavigation();

      render(
        <WelcomeCarouselScreen
          navigation={
            navigation as unknown as OnboardingStackScreenProps<'WelcomeCarousel'>['navigation']
          }
          route={{} as never}
        />
      );

      const player = useVideoPlayer.mock.results[0].value;
      player.replace.mockClear();
      player.play.mockClear();

      emitFocus();

      // Source restored to a non-null value, then playback resumed.
      expect(player.replace).toHaveBeenCalledTimes(1);
      expect(player.replace).not.toHaveBeenCalledWith(null);
      expect(player.play).toHaveBeenCalled();
    });

    it('keeps loop + muted + mixWithOthers when configuring the focused player', () => {
      const { navigation } = createFocusCapturingNavigation();

      render(
        <WelcomeCarouselScreen
          navigation={
            navigation as unknown as OnboardingStackScreenProps<'WelcomeCarousel'>['navigation']
          }
          route={{} as never}
        />
      );

      const callback = useVideoPlayer.mock.calls[0][1];
      const mockPlayer = {
        loop: false,
        muted: false,
        audioMixingMode: 'auto',
        play: jest.fn(),
      };
      callback(mockPlayer);

      expect(mockPlayer.loop).toBe(true);
      expect(mockPlayer.muted).toBe(true);
      expect(mockPlayer.audioMixingMode).toBe('mixWithOthers');
      expect(mockPlayer.play).toHaveBeenCalled();
    });
  });

  describe('OnboardingSliderScreen (one active decoder guard)', () => {
    it('plays only the active slide player and pauses the other two on mount', () => {
      const navigation =
        createMockNavigation() as unknown as OnboardingStackScreenProps<'OnboardingSlider'>['navigation'];

      render(<OnboardingSliderScreen navigation={navigation} route={{} as never} />);

      expect(useVideoPlayer).toHaveBeenCalledTimes(3);

      const player0 = useVideoPlayer.mock.results[0].value;
      const player1 = useVideoPlayer.mock.results[1].value;
      const player2 = useVideoPlayer.mock.results[2].value;

      // Active slide (index 0) is playing; only one decoder active.
      expect(player0.play).toHaveBeenCalled();
      expect(player1.pause).toHaveBeenCalled();
      expect(player2.pause).toHaveBeenCalled();
      expect(player1.play).not.toHaveBeenCalled();
      expect(player2.play).not.toHaveBeenCalled();
    });

    it('pauses every player on blur and resumes only the active one on focus', () => {
      const { navigation, emitFocus, emitBlur } = createFocusCapturingNavigation();

      render(
        <OnboardingSliderScreen
          navigation={
            navigation as unknown as OnboardingStackScreenProps<'OnboardingSlider'>['navigation']
          }
          route={{} as never}
        />
      );

      const player0 = useVideoPlayer.mock.results[0].value;
      const player1 = useVideoPlayer.mock.results[1].value;
      const player2 = useVideoPlayer.mock.results[2].value;

      player0.play.mockClear();
      player0.pause.mockClear();
      player1.pause.mockClear();
      player2.pause.mockClear();

      emitBlur();
      expect(player0.pause).toHaveBeenCalled();
      expect(player1.pause).toHaveBeenCalled();
      expect(player2.pause).toHaveBeenCalled();

      player0.play.mockClear();
      player1.play.mockClear();
      player2.play.mockClear();

      emitFocus();
      // Only the active slide resumes — still one active decoder.
      expect(player0.play).toHaveBeenCalled();
      expect(player1.play).not.toHaveBeenCalled();
      expect(player2.play).not.toHaveBeenCalled();
    });
  });
});
