/**
 * Tests that OnboardingSliderScreen video player initialization and source
 * swapping work correctly:
 * - play() is called once during player initialization
 * - replace() is NOT called when activeIndex stays the same
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

  it('calls play() once during initialization and does not replace() on same index', () => {
    const navigation =
      mockNavigation as unknown as OnboardingStackScreenProps<'OnboardingSlider'>['navigation'];

    render(<OnboardingSliderScreen navigation={navigation} route={{} as never} />);

    const player = useVideoPlayer.mock.results[0].value;

    // play() should be called exactly once — from the useVideoPlayer initializer
    // callback, NOT from the slide-change effect (activeIndex=0 === prevIndexRef=0).
    expect(player.play).toHaveBeenCalledTimes(1);

    // replace() should NOT be called — the player was already initialized with
    // SLIDES[0].video, so no source swap is needed on the initial render.
    expect(player.replace).not.toHaveBeenCalled();
  });
});
