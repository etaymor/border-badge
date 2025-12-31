import { renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { useReducedMotion } from './useReducedMotion';

// Mock AccessibilityInfo methods
const mockRemove = jest.fn();

jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled');
jest.spyOn(AccessibilityInfo, 'addEventListener');

describe('useReducedMotion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRemove.mockClear();

    // Default: reduce motion is disabled
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(false);
    (AccessibilityInfo.addEventListener as jest.Mock).mockReturnValue({ remove: mockRemove });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initial value', () => {
    it('should return false when reduce motion is disabled', async () => {
      (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(false);

      const { result } = renderHook(() => useReducedMotion());

      // Initially false (default state)
      expect(result.current).toBe(false);

      // Wait for promise to resolve
      await waitFor(() => {
        expect(result.current).toBe(false);
      });

      expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
    });

    it('should return true when reduce motion is enabled', async () => {
      (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);

      const { result } = renderHook(() => useReducedMotion());

      // Wait for promise to resolve
      await waitFor(() => {
        expect(result.current).toBe(true);
      });

      expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
    });

    it('should handle API errors gracefully and default to false', async () => {
      (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockRejectedValue(
        new Error('API error')
      );

      const { result } = renderHook(() => useReducedMotion());

      // Wait for promise to reject and handle error
      await waitFor(() => {
        expect(result.current).toBe(false);
      });

      expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
    });
  });

  describe('event listener', () => {
    it('should register event listener on mount', async () => {
      renderHook(() => useReducedMotion());

      await waitFor(() => {
        expect(AccessibilityInfo.addEventListener).toHaveBeenCalledWith(
          'reduceMotionChanged',
          expect.any(Function)
        );
      });
    });

    it('should update when reduce motion setting changes', async () => {
      let changeCallback: ((enabled: boolean) => void) | null = null;

      (AccessibilityInfo.addEventListener as jest.Mock).mockImplementation(
        (_event: string, callback: (enabled: boolean) => void) => {
          changeCallback = callback;
          return { remove: mockRemove };
        }
      );

      const { result } = renderHook(() => useReducedMotion());

      // Initially false
      await waitFor(() => {
        expect(result.current).toBe(false);
      });

      // Simulate reduce motion being enabled
      changeCallback!(true);

      await waitFor(() => {
        expect(result.current).toBe(true);
      });

      // Simulate reduce motion being disabled again
      changeCallback!(false);

      await waitFor(() => {
        expect(result.current).toBe(false);
      });
    });

    it('should remove event listener on unmount', async () => {
      const { unmount } = renderHook(() => useReducedMotion());

      await waitFor(() => {
        expect(AccessibilityInfo.addEventListener).toHaveBeenCalled();
      });

      unmount();

      expect(mockRemove).toHaveBeenCalledTimes(1);
    });
  });

  describe('accessibility compliance', () => {
    it('should support WCAG 2.1 Level AA motion requirements', async () => {
      // Test that the hook correctly detects reduce motion preference
      (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);

      const { result } = renderHook(() => useReducedMotion());

      await waitFor(() => {
        expect(result.current).toBe(true);
      });

      // This value should be used to disable animations
      expect(result.current).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle multiple rapid changes', async () => {
      let changeCallback: ((enabled: boolean) => void) | null = null;

      (AccessibilityInfo.addEventListener as jest.Mock).mockImplementation(
        (_event: string, callback: (enabled: boolean) => void) => {
          changeCallback = callback;
          return { remove: mockRemove };
        }
      );

      const { result } = renderHook(() => useReducedMotion());

      await waitFor(() => {
        expect(result.current).toBe(false);
      });

      // Rapidly toggle the setting
      changeCallback!(true);
      changeCallback!(false);
      changeCallback!(true);

      await waitFor(() => {
        expect(result.current).toBe(true);
      });
    });

    it('should maintain state across re-renders', async () => {
      (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);

      const { result, rerender } = renderHook(() => useReducedMotion());

      await waitFor(() => {
        expect(result.current).toBe(true);
      });

      // Force re-render
      rerender({});

      // State should be maintained
      expect(result.current).toBe(true);
    });
  });
});
