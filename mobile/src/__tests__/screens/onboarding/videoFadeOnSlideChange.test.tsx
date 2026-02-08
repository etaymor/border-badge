/**
 * Tests that OnboardingSliderScreen uses separate players per slide
 * to avoid the stale-frame flash that occurred with single-player
 * replace() source swapping.
 *
 * Bug (fixed): The original single-player approach called replace()
 * on slide change, which showed a flash of the previous video's last
 * frame before the new video loaded. An opacity fade was added to hide
 * the flash, but the statusChange → readyToPlay event didn't fire
 * reliably, leaving the video invisible.
 *
 * Fix: Use one pre-loaded player per slide. No replace(), no fade,
 * no stale frames. Each slide has its own VideoView with its own player.
 */

import { render } from '../../utils/testUtils';
import { createMockNavigation } from '../../utils/mockFactories';

import { OnboardingSliderScreen } from '@screens/onboarding/OnboardingSliderScreen';

import type { OnboardingStackScreenProps } from '@navigation/types';

const { useVideoPlayer } = jest.requireMock('expo-video');

const mockNavigation = createMockNavigation();

describe('OnboardingSliderScreen per-slide player architecture', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not use replace() or statusChange listeners for video transitions', () => {
    const navigation =
      mockNavigation as unknown as OnboardingStackScreenProps<'OnboardingSlider'>['navigation'];

    render(<OnboardingSliderScreen navigation={navigation} route={{} as never} />);

    // Three players, one per slide
    expect(useVideoPlayer).toHaveBeenCalledTimes(3);

    // None of the players should have replace() called
    for (let i = 0; i < 3; i++) {
      const player = useVideoPlayer.mock.results[i].value;
      expect(player.replace).not.toHaveBeenCalled();
    }

    // No statusChange listeners registered (no opacity fade mechanism)
    for (let i = 0; i < 3; i++) {
      const player = useVideoPlayer.mock.results[i].value;
      const statusChangeListeners = player.addListener.mock.calls.filter(
        ([event]: [string]) => event === 'statusChange'
      );
      expect(statusChangeListeners).toHaveLength(0);
    }
  });
});
