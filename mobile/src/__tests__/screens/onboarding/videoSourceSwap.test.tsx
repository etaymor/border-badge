/**
 * Tests that OnboardingSliderScreen only calls player.replace() + play()
 * when the active slide actually changes, and does NOT issue a redundant
 * play() when the index stays the same.
 */

import { render } from '../../utils/testUtils';
import { createMockNavigation } from '../../utils/mockFactories';

import { OnboardingSliderScreen } from '@screens/onboarding/OnboardingSliderScreen';

import type { OnboardingStackScreenProps } from '@navigation/types';

const { useVideoPlayer } = jest.requireMock('expo-video');

const mockNavigation = createMockNavigation();

describe('OnboardingSliderScreen video source swapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not call play() redundantly when activeIndex has not changed', () => {
    const navigation =
      mockNavigation as unknown as OnboardingStackScreenProps<'OnboardingSlider'>['navigation'];

    render(<OnboardingSliderScreen navigation={navigation} route={{} as never} />);

    // Get the player returned by the mock
    const player = useVideoPlayer.mock.results[0].value;

    // On initial render, activeIndex=0 and prevIndexRef=0, so the slide hasn't
    // "changed". The player was already initialized with SLIDES[0].video by
    // useVideoPlayer, so no replace() or play() should be needed.
    expect(player.replace).not.toHaveBeenCalled();
    expect(player.play).not.toHaveBeenCalled();
  });
});
