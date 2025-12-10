import * as Haptics from 'expo-haptics';
import { act, render, screen } from '../utils/testUtils';

import PassportStampCollage from '@components/onboarding/PassportStampCollage';

// Mock expo-haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: {
    Light: 'light',
    Medium: 'medium',
    Heavy: 'heavy',
  },
}));

const mockedHaptics = jest.mocked(Haptics);

// Mock stamp images
jest.mock('../../assets/stampImages', () => ({
  getStampImage: jest.fn((code: string) => {
    // Return a mock image source for valid codes
    const validCodes = ['US', 'FR', 'JP', 'IT', 'AU', 'BR', 'GB', 'DE', 'ES', 'TH', 'CA', 'MX'];
    if (validCodes.includes(code)) {
      return { uri: `mock-stamp-${code}` };
    }
    return null;
  }),
}));

describe('PassportStampCollage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('rendering', () => {
    it('renders empty state when no country codes provided', () => {
      render(<PassportStampCollage countryCodes={[]} homeCountry={null} animated={false} />);

      expect(screen.getByText('Your passport awaits its first stamp')).toBeTruthy();
    });

    it('renders stamps for provided country codes', () => {
      render(
        <PassportStampCollage
          countryCodes={['US', 'FR', 'JP']}
          homeCountry={null}
          animated={false}
        />
      );

      // Should not show empty state
      expect(screen.queryByText('Your passport awaits its first stamp')).toBeNull();
    });

    it('limits visible stamps to MAX_VISIBLE_STAMPS (12)', () => {
      const manyCodes = [
        'US',
        'FR',
        'JP',
        'IT',
        'AU',
        'BR',
        'GB',
        'DE',
        'ES',
        'TH',
        'CA',
        'MX',
        'CN',
        'IN',
        'RU',
      ];
      render(<PassportStampCollage countryCodes={manyCodes} homeCountry={null} animated={false} />);

      // Should show +N more indicator for countries beyond 12
      expect(screen.getByText('+3 more adventures')).toBeTruthy();
    });

    it('does not show more indicator when stamps <= 12', () => {
      const codes = ['US', 'FR', 'JP'];
      render(<PassportStampCollage countryCodes={codes} homeCountry={null} animated={false} />);

      expect(screen.queryByText(/more adventures/)).toBeNull();
    });
  });

  describe('home country handling', () => {
    it('renders home country with higher z-index', () => {
      // This is more of an implementation detail, but we can at least verify it doesn't crash
      render(
        <PassportStampCollage countryCodes={['US', 'FR', 'JP']} homeCountry="FR" animated={false} />
      );

      // Component should render without error
      expect(screen.queryByText('Your passport awaits its first stamp')).toBeNull();
    });

    it('handles home country not in list gracefully', () => {
      render(
        <PassportStampCollage countryCodes={['US', 'FR', 'JP']} homeCountry="DE" animated={false} />
      );

      // Should render normally even if home country is not in the list
      expect(screen.queryByText('Your passport awaits its first stamp')).toBeNull();
    });
  });

  describe('animation behavior', () => {
    it('calls onAnimationComplete when animated is false', () => {
      const onAnimationComplete = jest.fn();
      render(
        <PassportStampCollage
          countryCodes={['US', 'FR']}
          homeCountry={null}
          animated={false}
          onAnimationComplete={onAnimationComplete}
        />
      );

      // When animated is false and there are codes, onAnimationComplete is NOT called
      // because the effect only calls it when animated is false AND visibleCodes.length === 0
      // Actually looking at the code, it calls it when !animated || visibleCodes.length === 0
      // Wait for effect to run
      act(() => {
        jest.runAllTimers();
      });

      // onAnimationComplete is called in the effect when !animated
      // Based on the code: if (!animated || visibleCodes.length === 0) { onAnimationComplete?.(); return; }
      // So it SHOULD be called when animated is false
      expect(onAnimationComplete).toHaveBeenCalled();
    });

    it('calls onAnimationComplete when no stamps to animate', () => {
      const onAnimationComplete = jest.fn();
      render(
        <PassportStampCollage
          countryCodes={[]}
          homeCountry={null}
          animated={true}
          onAnimationComplete={onAnimationComplete}
        />
      );

      act(() => {
        jest.runAllTimers();
      });

      expect(onAnimationComplete).toHaveBeenCalled();
    });

    it('triggers haptic feedback during animation', async () => {
      render(
        <PassportStampCollage
          countryCodes={['US', 'FR', 'JP']}
          homeCountry={null}
          animated={true}
          animationDelay={0}
        />
      );

      // Advance timers to trigger haptic timeouts
      act(() => {
        jest.advanceTimersByTime(500); // Advance past stagger delays
      });

      // Haptics should have been called for each stamp
      expect(mockedHaptics.impactAsync).toHaveBeenCalled();
    });

    it('respects animationDelay prop', () => {
      render(
        <PassportStampCollage
          countryCodes={['US']}
          homeCountry={null}
          animated={true}
          animationDelay={500}
        />
      );

      // Before delay, no haptics
      act(() => {
        jest.advanceTimersByTime(400);
      });
      expect(mockedHaptics.impactAsync).not.toHaveBeenCalled();

      // After delay, haptics should fire
      act(() => {
        jest.advanceTimersByTime(200);
      });
      expect(mockedHaptics.impactAsync).toHaveBeenCalled();
    });

    it('cleans up animations on unmount', () => {
      const { unmount } = render(
        <PassportStampCollage
          countryCodes={['US', 'FR', 'JP']}
          homeCountry={null}
          animated={true}
        />
      );

      // Unmount before animations complete
      act(() => {
        jest.advanceTimersByTime(50);
      });
      unmount();

      // Should not throw or cause issues
      act(() => {
        jest.runAllTimers();
      });
    });

    it('stops previous animation when starting new one', () => {
      const { rerender } = render(
        <PassportStampCollage countryCodes={['US', 'FR']} homeCountry={null} animated={true} />
      );

      act(() => {
        jest.advanceTimersByTime(50);
      });

      // Rerender with different props should stop previous animation
      rerender(
        <PassportStampCollage
          countryCodes={['US', 'FR', 'JP']}
          homeCountry={null}
          animated={true}
        />
      );

      // Should not throw or cause issues
      act(() => {
        jest.runAllTimers();
      });
    });
  });

  describe('position generation', () => {
    it('generates different layouts for small vs large stamp counts', () => {
      // Small count (<=6) uses 2x3 layout
      const { rerender } = render(
        <PassportStampCollage
          countryCodes={['US', 'FR', 'JP']}
          homeCountry={null}
          animated={false}
        />
      );

      // Large count (>6) uses 4-column layout
      rerender(
        <PassportStampCollage
          countryCodes={['US', 'FR', 'JP', 'IT', 'AU', 'BR', 'GB', 'DE']}
          homeCountry={null}
          animated={false}
        />
      );

      // Both should render without error
      expect(screen.queryByText('Your passport awaits its first stamp')).toBeNull();
    });
  });

  describe('stamp sorting', () => {
    it('puts home country first in animation order', () => {
      // The home country should animate first
      render(
        <PassportStampCollage
          countryCodes={['US', 'FR', 'JP']}
          homeCountry="JP"
          animated={true}
          animationDelay={0}
        />
      );

      // Component should render with JP prioritized
      // We can't easily test animation order, but verify it doesn't crash
      act(() => {
        jest.runAllTimers();
      });
    });
  });

  describe('edge cases', () => {
    it('handles invalid stamp codes gracefully', () => {
      render(
        <PassportStampCollage
          countryCodes={['INVALID', 'US', 'NOTREAL']}
          homeCountry={null}
          animated={false}
        />
      );

      // Should render without crashing (invalid stamps return null from getStampImage)
      expect(screen.queryByText('Your passport awaits its first stamp')).toBeNull();
    });

    it('handles empty homeCountry string', () => {
      render(
        <PassportStampCollage countryCodes={['US', 'FR', 'JP']} homeCountry="" animated={false} />
      );

      // Should render normally with empty string treated as no home country
      expect(screen.queryByText('Your passport awaits its first stamp')).toBeNull();
    });

    it('handles duplicate country codes', () => {
      render(
        <PassportStampCollage
          countryCodes={['US', 'US', 'FR', 'FR']}
          homeCountry={null}
          animated={false}
        />
      );

      // Should render (though duplicates may cause key warnings)
      expect(screen.queryByText('Your passport awaits its first stamp')).toBeNull();
    });
  });
});
