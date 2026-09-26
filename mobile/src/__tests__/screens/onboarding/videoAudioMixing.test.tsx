/**
 * Tests that all onboarding video players configure audioMixingMode = 'mixWithOthers'
 * so that background music (e.g., Spotify) is not interrupted during onboarding.
 *
 * Bug: iOS pauses background audio when expo-video players initialize because
 * the default audioMixingMode ('auto') can still interrupt other audio sessions.
 * All onboarding videos are muted and decorative, so they should use 'mixWithOthers'.
 * (The intro slider no longer uses video; see OnboardingSliderScreen.test.tsx.)
 */

import { render } from '../../utils/testUtils';
import { createMockNavigation } from '../../utils/mockFactories';

import { ContinentIntroScreen } from '@screens/onboarding/ContinentIntroScreen';

import type { OnboardingStackScreenProps } from '@navigation/types';

// Get reference to the mocked useVideoPlayer
const { useVideoPlayer } = jest.requireMock('expo-video');

const mockNavigation = createMockNavigation();

describe('Onboarding video players do not interrupt background music', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ContinentIntroScreen sets audioMixingMode to mixWithOthers', () => {
    const navigation =
      mockNavigation as unknown as OnboardingStackScreenProps<'ContinentIntro'>['navigation'];
    const route = {
      key: 'test',
      name: 'ContinentIntro' as const,
      params: { region: 'Europe', regionIndex: 3 },
    };

    render(
      <ContinentIntroScreen
        navigation={navigation}
        route={route as OnboardingStackScreenProps<'ContinentIntro'>['route']}
      />
    );

    expect(useVideoPlayer).toHaveBeenCalled();
    const callback = useVideoPlayer.mock.calls[0][1];
    const mockPlayer = { loop: false, muted: false, audioMixingMode: 'auto' };
    callback(mockPlayer);

    expect(mockPlayer.audioMixingMode).toBe('mixWithOthers');
  });
});
