/**
 * Tests that OnboardingSliderScreen video player initialization works correctly:
 * - Three separate players are created (one per slide)
 * - Only the active player (index 0) calls play() on mount
 * - No replace() calls are needed (each player has its own source)
 */

import { render } from '../../utils/testUtils';
import { createMockNavigation } from '../../utils/mockFactories';

import { OnboardingSliderScreen } from '@screens/onboarding/OnboardingSliderScreen';

import type { OnboardingStackScreenProps } from '@navigation/types';

const { useVideoPlayer } = jest.requireMock('expo-video');

const mockNavigation = createMockNavigation();

describe('OnboardingSliderScreen video player initialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates three separate players and plays only the first on mount', () => {
    const navigation =
      mockNavigation as unknown as OnboardingStackScreenProps<'OnboardingSlider'>['navigation'];

    render(<OnboardingSliderScreen navigation={navigation} route={{} as never} />);

    // Three players created (one per slide)
    expect(useVideoPlayer).toHaveBeenCalledTimes(3);

    const player0 = useVideoPlayer.mock.results[0].value;
    const player1 = useVideoPlayer.mock.results[1].value;
    const player2 = useVideoPlayer.mock.results[2].value;

    // First player should be playing (activeIndex=0)
    expect(player0.play).toHaveBeenCalled();

    // Other players should be paused
    expect(player1.pause).toHaveBeenCalled();
    expect(player2.pause).toHaveBeenCalled();

    // No replace() calls needed — each player has its own source
    expect(player0.replace).not.toHaveBeenCalled();
    expect(player1.replace).not.toHaveBeenCalled();
    expect(player2.replace).not.toHaveBeenCalled();
  });
});
