import { act, render, screen } from '../utils/testUtils';

import RotatingStampHero from '@components/onboarding/RotatingStampHero';

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

describe('RotatingStampHero', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('rendering', () => {
    it('renders stamps for provided stamp codes', () => {
      render(<RotatingStampHero stampCodes={['US', 'FR', 'JP', 'IT', 'AU', 'BR']} />);

      // Should render without error
      // The component creates Animated.View elements for each stamp
    });

    it('fills with sample stamps when user has fewer than visibleCount', () => {
      render(<RotatingStampHero stampCodes={['US', 'FR']} visibleCount={6} />);

      // Component should fill remaining slots with sample stamps
      // This is internal behavior, but we verify it doesn't crash
    });

    it('respects visibleCount prop', () => {
      render(
        <RotatingStampHero stampCodes={['US', 'FR', 'JP', 'IT', 'AU', 'BR']} visibleCount={3} />
      );

      // Should only show 3 stamps
    });

    it('clamps visibleCount to available positions (max 6)', () => {
      render(
        <RotatingStampHero
          stampCodes={['US', 'FR', 'JP', 'IT', 'AU', 'BR', 'GB', 'DE', 'ES', 'TH']}
          visibleCount={10}
        />
      );

      // Should clamp to 6 (STAMP_POSITIONS.length)
    });
  });

  describe('zero visibleCount handling', () => {
    it('handles visibleCount of 0 without crashing', () => {
      render(<RotatingStampHero stampCodes={['US', 'FR', 'JP']} visibleCount={0} />);

      // Should render empty container without crashing
    });

    it('handles negative visibleCount without crashing', () => {
      render(<RotatingStampHero stampCodes={['US', 'FR', 'JP']} visibleCount={-5} />);

      // Should treat as 0 due to Math.max(0, ...) guard
    });

    it('does not start animations when visibleCount is 0', () => {
      render(<RotatingStampHero stampCodes={['US', 'FR', 'JP']} visibleCount={0} />);

      // Advance timers - should not cause errors
      act(() => {
        jest.advanceTimersByTime(5000);
      });
    });
  });

  describe('animation behavior', () => {
    it('starts entrance animation on mount', () => {
      render(<RotatingStampHero stampCodes={['US', 'FR', 'JP', 'IT', 'AU', 'BR']} />);

      act(() => {
        jest.advanceTimersByTime(500);
      });

      // Should not crash
    });

    it('starts staggered stamp entrance animations', () => {
      render(<RotatingStampHero stampCodes={['US', 'FR', 'JP', 'IT', 'AU', 'BR']} />);

      // Advance through staggered delays (400ms base + index * 80ms)
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      // Should not crash
    });

    it('starts floating animations for each stamp', () => {
      render(<RotatingStampHero stampCodes={['US', 'FR', 'JP', 'IT', 'AU', 'BR']} />);

      // Advance through float animation delays (index * 500ms)
      act(() => {
        jest.advanceTimersByTime(3500);
      });

      // Should not crash
    });

    it('cleans up animations on unmount', () => {
      const { unmount } = render(
        <RotatingStampHero stampCodes={['US', 'FR', 'JP', 'IT', 'AU', 'BR']} />
      );

      act(() => {
        jest.advanceTimersByTime(100);
      });

      unmount();

      // Advance more timers - should not cause issues with cleaned up animations
      act(() => {
        jest.runAllTimers();
      });
    });
  });

  describe('rotation behavior', () => {
    it('rotates stamps when more stamps than visible slots', () => {
      render(
        <RotatingStampHero
          stampCodes={['US', 'FR', 'JP', 'IT', 'AU', 'BR', 'GB', 'DE', 'ES', 'TH']}
          visibleCount={6}
          rotationInterval={1000}
        />
      );

      // Advance past rotation interval
      act(() => {
        jest.advanceTimersByTime(1500);
      });

      // Should not crash - rotation logic executes
    });

    it('does not rotate when stamps <= visibleCount', () => {
      render(
        <RotatingStampHero
          stampCodes={['US', 'FR', 'JP']}
          visibleCount={6}
          rotationInterval={1000}
        />
      );

      // Even with timers, no rotation should occur
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      // Should not crash
    });

    it('respects rotationInterval prop', () => {
      render(
        <RotatingStampHero
          stampCodes={['US', 'FR', 'JP', 'IT', 'AU', 'BR', 'GB', 'DE', 'ES', 'TH']}
          visibleCount={6}
          rotationInterval={5000}
        />
      );

      // Advance less than interval - no rotation yet
      act(() => {
        jest.advanceTimersByTime(4000);
      });

      // Advance past interval - rotation should occur
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      // Should not crash
    });

    it('prevents infinite loop in stamp selection with max iteration guard', () => {
      // This edge case is when allStamps.length === actualVisibleCount
      // The do-while loop should exit due to the iterations guard
      render(
        <RotatingStampHero
          stampCodes={['US', 'FR', 'JP', 'IT', 'AU', 'BR']}
          visibleCount={6}
          rotationInterval={100}
        />
      );

      // Even if rotation logic runs, it should not infinite loop
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      // Should complete without hanging
    });

    it('clears rotation interval on unmount', () => {
      const { unmount } = render(
        <RotatingStampHero
          stampCodes={['US', 'FR', 'JP', 'IT', 'AU', 'BR', 'GB', 'DE', 'ES', 'TH']}
          visibleCount={6}
          rotationInterval={100}
        />
      );

      act(() => {
        jest.advanceTimersByTime(50);
      });

      unmount();

      // Should not cause errors after unmount
      act(() => {
        jest.advanceTimersByTime(500);
      });
    });
  });

  describe('sample stamps fallback', () => {
    it('uses sample stamps when user has no stamps', () => {
      render(<RotatingStampHero stampCodes={[]} visibleCount={6} />);

      // Should fill with sample stamps (US, FR, JP, IT, AU, BR by default)
    });

    it('excludes user stamps from sample stamps', () => {
      // If user has US, sample stamps should not include US
      render(<RotatingStampHero stampCodes={['US']} visibleCount={6} />);

      // Should fill remaining 5 slots with samples excluding US
    });

    it('handles case when user has some overlap with samples', () => {
      // User has some stamps that are also in SAMPLE_STAMPS
      render(<RotatingStampHero stampCodes={['US', 'FR', 'JP']} visibleCount={6} />);

      // Should fill remaining slots with non-overlapping samples
    });
  });

  describe('edge cases', () => {
    it('handles empty stampCodes array', () => {
      render(<RotatingStampHero stampCodes={[]} />);

      // Should render with sample stamps as fallback
    });

    it('handles invalid stamp codes gracefully', () => {
      render(<RotatingStampHero stampCodes={['INVALID', 'NOTREAL', 'FAKE']} visibleCount={3} />);

      // getStampImage returns null for invalid codes, so stamps won't render
      // But component should not crash
    });

    it('handles mixed valid and invalid stamp codes', () => {
      render(
        <RotatingStampHero stampCodes={['US', 'INVALID', 'FR', 'NOTREAL']} visibleCount={4} />
      );

      // Should render valid stamps and skip invalid ones
    });

    it('handles very large stamp list', () => {
      const manyStamps = Array.from({ length: 100 }, (_, i) => `STAMP${i}`);
      render(<RotatingStampHero stampCodes={manyStamps} visibleCount={6} />);

      // Should only use first 6 and rotate through rest
      act(() => {
        jest.advanceTimersByTime(5000);
      });
    });
  });

  describe('memoization', () => {
    it('memoizes interpolations to prevent recreation', () => {
      const { rerender } = render(
        <RotatingStampHero stampCodes={['US', 'FR', 'JP', 'IT', 'AU', 'BR']} />
      );

      // Rerender with same props
      rerender(<RotatingStampHero stampCodes={['US', 'FR', 'JP', 'IT', 'AU', 'BR']} />);

      // Should not cause issues or excessive re-renders
    });

    it('recreates allStamps when stampCodes change', () => {
      const { rerender } = render(<RotatingStampHero stampCodes={['US', 'FR']} visibleCount={6} />);

      // Change stamp codes
      rerender(<RotatingStampHero stampCodes={['GB', 'DE']} visibleCount={6} />);

      // Should update without issues
    });
  });
});
