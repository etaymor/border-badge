import { act, fireEvent, render, screen } from '../utils/testUtils';

import { ResendTimer } from '@components/ui/ResendTimer';

// Use fake timers for countdown testing
jest.useFakeTimers();

describe('ResendTimer', () => {
  const defaultProps = {
    onResend: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('countdown timer', () => {
    it('counts down from cooldownSeconds to 0', () => {
      render(<ResendTimer {...defaultProps} cooldownSeconds={60} />);

      expect(screen.getByText('Resend in 1:00')).toBeTruthy();

      act(() => {
        jest.advanceTimersByTime(30000); // 30 seconds
      });

      expect(screen.getByText('Resend in 0:30')).toBeTruthy();

      act(() => {
        jest.advanceTimersByTime(30000); // another 30 seconds
      });

      // After 60 seconds, resend button should appear
      expect(screen.getByText('Resend Code')).toBeTruthy();
    });

    it('formats time correctly with leading zeros', () => {
      render(<ResendTimer {...defaultProps} cooldownSeconds={65} />);

      expect(screen.getByText('Resend in 1:05')).toBeTruthy();

      act(() => {
        jest.advanceTimersByTime(60000); // 60 seconds
      });

      expect(screen.getByText('Resend in 0:05')).toBeTruthy();
    });

    it('respects custom cooldownSeconds prop', () => {
      render(<ResendTimer {...defaultProps} cooldownSeconds={30} />);

      expect(screen.getByText('Resend in 0:30')).toBeTruthy();

      act(() => {
        jest.advanceTimersByTime(30000);
      });

      expect(screen.getByText('Resend Code')).toBeTruthy();
    });
  });

  describe('resend functionality', () => {
    it('enables resend button when timer reaches 0', () => {
      render(<ResendTimer {...defaultProps} cooldownSeconds={5} />);

      // Button not shown initially
      expect(screen.queryByText('Resend Code')).toBeNull();

      act(() => {
        jest.advanceTimersByTime(5000);
      });

      // Button shown after timer ends
      expect(screen.getByText('Resend Code')).toBeTruthy();
    });

    it('calls onResend callback when resend button pressed', () => {
      const onResend = jest.fn();
      render(<ResendTimer {...defaultProps} onResend={onResend} cooldownSeconds={5} />);

      act(() => {
        jest.advanceTimersByTime(5000);
      });

      fireEvent.press(screen.getByText('Resend Code'));

      expect(onResend).toHaveBeenCalledTimes(1);
    });

    it('blocks resend while timer is active (button hidden)', () => {
      render(<ResendTimer {...defaultProps} cooldownSeconds={60} />);

      expect(screen.queryByText('Resend Code')).toBeNull();
      expect(screen.getByText('Resend in 1:00')).toBeTruthy();
    });

    it('blocks resend while isResending is true', () => {
      const onResend = jest.fn();
      render(<ResendTimer {...defaultProps} onResend={onResend} cooldownSeconds={5} isResending />);

      act(() => {
        jest.advanceTimersByTime(5000);
      });

      // Button should be disabled when isResending is true
      // The component shows ActivityIndicator instead of text
      expect(screen.queryByText('Resend Code')).toBeNull();
    });

    it('resets timer after resend is triggered', () => {
      const onResend = jest.fn();
      render(<ResendTimer {...defaultProps} onResend={onResend} cooldownSeconds={5} />);

      act(() => {
        jest.advanceTimersByTime(5000);
      });

      fireEvent.press(screen.getByText('Resend Code'));

      // Timer should reset to show countdown again
      expect(screen.getByText('Resend in 0:05')).toBeTruthy();
    });
  });

  describe('persistent timer with startTime', () => {
    it('calculates remaining time from startTime timestamp', () => {
      // startTime was 30 seconds ago
      const startTime = Date.now() - 30000;

      render(<ResendTimer {...defaultProps} cooldownSeconds={60} startTime={startTime} />);

      // Should show ~30 seconds remaining
      expect(screen.getByText('Resend in 0:30')).toBeTruthy();
    });

    it('shows resend button immediately if startTime exceeds cooldown', () => {
      // startTime was 2 minutes ago, cooldown is 60s
      const startTime = Date.now() - 120000;

      render(<ResendTimer {...defaultProps} cooldownSeconds={60} startTime={startTime} />);

      expect(screen.getByText('Resend Code')).toBeTruthy();
    });
  });

  describe('cleanup', () => {
    it('cleans up interval on unmount (no memory leak)', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      const { unmount } = render(<ResendTimer {...defaultProps} cooldownSeconds={60} />);

      unmount();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });
});
