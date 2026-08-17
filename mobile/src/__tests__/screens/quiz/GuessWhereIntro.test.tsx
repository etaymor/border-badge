/**
 * GuessWhereIntroScreen — the video-hero introduction.
 *
 * Covers the restaged intro:
 * - full-bleed looping muted background video built from `introVideo`,
 *   configured like the onboarding video screens (loop + muted + mixWithOthers)
 * - the loop pauses while the demo's answered state is showing and resumes
 *   when the demo collapses; blur releases the decoder, focus restores it
 * - Reduce Motion renders the static poster and never creates a player
 * - fixed copy: headline, support line, primary CTA -> replace('QuizCreation')
 * - the one-tap demo: revealed in place by "See how it works", four shuffled
 *   options containing the correct country, SerifScore small acknowledgment
 *   (1/1 right, 0/1 wrong) naming the answer — the stamp plate is retired
 */

import { within } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import { fireEvent, render, screen } from '../../utils/testUtils';
import { createMockNavigation } from '../../utils/mockFactories';

jest.mock('@hooks/useReducedMotion', () => ({
  useReducedMotion: jest.fn(() => false),
}));

import { useReducedMotion } from '@hooks/useReducedMotion';
import { GuessWhereIntroScreen } from '@screens/quiz/GuessWhereIntroScreen';
import { demoCountry, demoOptions, introVideo } from '@screens/quiz/sampleAssets';
import type { RootStackScreenProps } from '@navigation/types';

const { useVideoPlayer } = jest.requireMock('expo-video');
const mockUseReducedMotion = useReducedMotion as jest.MockedFunction<typeof useReducedMotion>;
const mockImpact = Haptics.impactAsync as jest.Mock;

type Navigation = RootStackScreenProps<'GuessWhereIntro'>['navigation'];

function renderScreen(navigation = createMockNavigation()) {
  const view = render(
    <GuessWhereIntroScreen navigation={navigation as unknown as Navigation} route={{} as never} />
  );
  return { ...view, navigation };
}

/** Capture focus/blur callbacks registered via navigation.addListener. */
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

function revealDemo() {
  fireEvent.press(screen.getByTestId('guess-where-intro-demo-toggle'));
}

describe('GuessWhereIntroScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseReducedMotion.mockReturnValue(false);
  });

  describe('video hero', () => {
    it('creates a looping, muted, audio-mixing player from the intro video', () => {
      renderScreen();

      expect(useVideoPlayer).toHaveBeenCalledTimes(1);
      expect(useVideoPlayer).toHaveBeenCalledWith(introVideo, expect.any(Function));
      expect(screen.getByTestId('guess-where-intro-video')).toBeTruthy();

      const callback = useVideoPlayer.mock.calls[0][1];
      const configured = {
        loop: false,
        muted: false,
        audioMixingMode: 'auto',
        play: jest.fn(),
      };
      callback(configured);

      expect(configured.loop).toBe(true);
      expect(configured.muted).toBe(true);
      expect(configured.audioMixingMode).toBe('mixWithOthers');
      expect(configured.play).toHaveBeenCalled();
    });

    it('pauses the loop while the demo reveal is showing and resumes on collapse', () => {
      renderScreen();

      // The jest mock mints a fresh player object per render, so always
      // inspect the player belonging to the most recent render.
      const latestPlayer = () =>
        useVideoPlayer.mock.results[useVideoPlayer.mock.results.length - 1].value;

      revealDemo();
      expect(latestPlayer().pause).not.toHaveBeenCalled();

      fireEvent.press(screen.getByText(demoCountry));
      expect(latestPlayer().pause).toHaveBeenCalled();

      // Collapse the demo (secondary button toggles it away) — loop resumes.
      fireEvent.press(screen.getByTestId('guess-where-intro-demo-toggle'));
      expect(latestPlayer().pause).not.toHaveBeenCalled();
      expect(latestPlayer().play).toHaveBeenCalled();
      expect(screen.queryByTestId('guess-where-demo')).toBeNull();
    });

    it('releases the decoder with replace(null) on blur and restores on focus', () => {
      const { navigation, emitFocus, emitBlur } = createFocusCapturingNavigation();
      renderScreen(navigation);

      const player = useVideoPlayer.mock.results[0].value;
      player.replace.mockClear();

      emitBlur();
      expect(player.replace).toHaveBeenCalledTimes(1);
      expect(player.replace).toHaveBeenCalledWith(null);

      player.replace.mockClear();
      player.play.mockClear();

      emitFocus();
      expect(player.replace).toHaveBeenCalledTimes(1);
      expect(player.replace).toHaveBeenCalledWith(introVideo);
      expect(player.play).toHaveBeenCalled();
    });

    it('renders the static poster and no video player under Reduce Motion', () => {
      mockUseReducedMotion.mockReturnValue(true);
      renderScreen();

      expect(screen.getByTestId('guess-where-intro-poster')).toBeTruthy();
      expect(screen.queryByTestId('guess-where-intro-video')).toBeNull();
      expect(useVideoPlayer).not.toHaveBeenCalled();
    });
  });

  describe('copy and CTAs', () => {
    it('shows the headline and support line over the hero', () => {
      renderScreen();
      expect(screen.getByText('How well do your friends know your world?')).toBeTruthy();
      expect(
        screen.getByText('Turn your travel photos into a challenge only your friends can solve.')
      ).toBeTruthy();
    });

    it('primary CTA replaces to QuizCreation', () => {
      const { navigation } = renderScreen();
      fireEvent.press(screen.getByText('Create Your Challenge'));
      expect(navigation.replace).toHaveBeenCalledWith('QuizCreation');
    });
  });

  describe('one-tap demo', () => {
    it('is hidden until "See how it works" reveals it in place', () => {
      renderScreen();
      expect(screen.queryByTestId('guess-where-demo')).toBeNull();

      fireEvent.press(screen.getByText('See how it works'));
      expect(screen.getByTestId('guess-where-demo')).toBeTruthy();
    });

    it('deals the four sample options, correct country included', () => {
      renderScreen();
      revealDemo();

      const labels = [0, 1, 2, 3].map(
        (i) =>
          within(screen.getByTestId(`guess-where-demo-option-${i}`)).getByText(/./).props.children
      );
      expect(labels).toHaveLength(4);
      expect([...labels].sort()).toEqual([...demoOptions].sort());
      expect(labels).toContain(demoCountry);
    });

    it('keeps the shuffled order stable across re-renders', () => {
      const navigation = createMockNavigation();
      const view = renderScreen(navigation);
      revealDemo();

      const readLabels = () =>
        [0, 1, 2, 3].map(
          (i) =>
            within(screen.getByTestId(`guess-where-demo-option-${i}`)).getByText(/./).props.children
        );
      const first = readLabels();

      view.rerender(
        <GuessWhereIntroScreen
          navigation={navigation as unknown as Navigation}
          route={{} as never}
        />
      );
      expect(readLabels()).toEqual(first);
    });

    it('acknowledges a correct guess with a small SerifScore of 1 / 1', () => {
      renderScreen();
      revealDemo();

      fireEvent.press(screen.getByText(demoCountry));

      expect(mockImpact).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
      const scoreLockup = within(screen.getByTestId('guess-where-demo-score'));
      expect(scoreLockup.getAllByText('1')).toHaveLength(2);
      expect(screen.getByText(`Right: ${demoCountry}`)).toBeTruthy();
    });

    it('acknowledges a wrong guess with 0 / 1 and names the answer', () => {
      renderScreen();
      revealDemo();

      const wrong = demoOptions.find((option) => option !== demoCountry) as string;
      fireEvent.press(screen.getByText(wrong));

      const scoreLockup = within(screen.getByTestId('guess-where-demo-score'));
      expect(scoreLockup.getByText('0')).toBeTruthy();
      expect(scoreLockup.getByText('1')).toBeTruthy();
      expect(screen.getByText(`It was ${demoCountry}`)).toBeTruthy();
    });

    it('locks the answer after the first tap', () => {
      renderScreen();
      revealDemo();

      fireEvent.press(screen.getByText(demoCountry));
      mockImpact.mockClear();

      // Options are gone; the reveal is showing instead.
      expect(screen.queryByText(demoCountry)).toBeNull();
      expect(screen.getByTestId('guess-where-demo-reveal')).toBeTruthy();
      expect(mockImpact).not.toHaveBeenCalled();
    });
  });
});
