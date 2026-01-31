/**
 * Tests for useReviewRequest Hook
 *
 * Tests eligibility checks, trigger locking, handler flows, and native review integration
 */
import { renderHook, act } from '@testing-library/react-native';
import * as StoreReview from 'expo-store-review';

import { useReviewRequest, type ReviewTrigger } from '@hooks/useReviewRequest';
import { useReviewStore } from '@stores/reviewStore';
import { Analytics } from '@services/analytics';

// Mock expo-store-review
jest.mock('expo-store-review', () => ({
  hasAction: jest.fn(),
  requestReview: jest.fn(),
}));

// Mock analytics
jest.mock('@services/analytics', () => ({
  Analytics: {
    reviewSatisfactionShown: jest.fn(),
    reviewSatisfactionPositive: jest.fn(),
    reviewSatisfactionNegative: jest.fn(),
    reviewSatisfactionDismissed: jest.fn(),
    reviewNativeRequested: jest.fn(),
    reviewNativeUnavailable: jest.fn(),
    reviewNativeError: jest.fn(),
  },
}));

describe('useReviewRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset store to initial state
    useReviewStore.setState({
      hasCompletedReview: false,
      lastPromptTimestamp: null,
      hasTriggeredPostOnboarding: false,
      hasTriggeredFirstSocialSave: false,
      hasTriggeredFirstPhotoImport: false,
    });

    // Mock StoreReview defaults
    (StoreReview.hasAction as jest.Mock).mockResolvedValue(true);
    (StoreReview.requestReview as jest.Mock).mockResolvedValue(undefined);
  });

  describe('checkEligibility', () => {
    it('returns true for post_onboarding trigger when not triggered', () => {
      const { result } = renderHook(() => useReviewRequest());

      let isEligible = false;
      act(() => {
        isEligible = result.current.checkEligibility('post_onboarding');
      });

      expect(isEligible).toBe(true);
    });

    it('returns false for post_onboarding when already triggered', () => {
      useReviewStore.setState({ hasTriggeredPostOnboarding: true });

      const { result } = renderHook(() => useReviewRequest());

      let isEligible = false;
      act(() => {
        isEligible = result.current.checkEligibility('post_onboarding');
      });

      expect(isEligible).toBe(false);
    });

    it('returns true for first_social_save when not triggered', () => {
      const { result } = renderHook(() => useReviewRequest());

      let isEligible = false;
      act(() => {
        isEligible = result.current.checkEligibility('first_social_save');
      });

      expect(isEligible).toBe(true);
    });

    it('returns false for first_social_save when already triggered', () => {
      useReviewStore.setState({ hasTriggeredFirstSocialSave: true });

      const { result } = renderHook(() => useReviewRequest());

      let isEligible = false;
      act(() => {
        isEligible = result.current.checkEligibility('first_social_save');
      });

      expect(isEligible).toBe(false);
    });

    it('returns true for first_photo_import when not triggered', () => {
      const { result } = renderHook(() => useReviewRequest());

      let isEligible = false;
      act(() => {
        isEligible = result.current.checkEligibility('first_photo_import');
      });

      expect(isEligible).toBe(true);
    });

    it('returns false for first_photo_import when already triggered', () => {
      useReviewStore.setState({ hasTriggeredFirstPhotoImport: true });

      const { result } = renderHook(() => useReviewRequest());

      let isEligible = false;
      act(() => {
        isEligible = result.current.checkEligibility('first_photo_import');
      });

      expect(isEligible).toBe(false);
    });

    it('returns true for country_visited (no first-time restriction)', () => {
      const { result } = renderHook(() => useReviewRequest());

      let isEligible = false;
      act(() => {
        isEligible = result.current.checkEligibility('country_visited');
      });

      expect(isEligible).toBe(true);
    });

    it('returns false when review already completed', () => {
      useReviewStore.setState({ hasCompletedReview: true });

      const { result } = renderHook(() => useReviewRequest());

      const triggers: ReviewTrigger[] = [
        'post_onboarding',
        'first_social_save',
        'first_photo_import',
        'country_visited',
      ];

      triggers.forEach((trigger) => {
        let isEligible = false;
        act(() => {
          isEligible = result.current.checkEligibility(trigger);
        });
        expect(isEligible).toBe(false);
      });
    });

    it('returns false during 7-day cooldown', () => {
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;
      useReviewStore.setState({ lastPromptTimestamp: oneHourAgo });

      const { result } = renderHook(() => useReviewRequest());

      let isEligible = false;
      act(() => {
        isEligible = result.current.checkEligibility('country_visited');
      });

      expect(isEligible).toBe(false);
    });
  });

  describe('startReviewFlow', () => {
    it('marks post_onboarding trigger and records analytics', () => {
      const { result } = renderHook(() => useReviewRequest());

      let flowStarted = false;
      act(() => {
        flowStarted = result.current.startReviewFlow('post_onboarding');
      });

      expect(flowStarted).toBe(true);
      expect(useReviewStore.getState().hasTriggeredPostOnboarding).toBe(true);
      expect(Analytics.reviewSatisfactionShown).toHaveBeenCalledWith('post_onboarding');
    });

    it('marks first_social_save trigger and records analytics', () => {
      const { result } = renderHook(() => useReviewRequest());

      let flowStarted = false;
      act(() => {
        flowStarted = result.current.startReviewFlow('first_social_save');
      });

      expect(flowStarted).toBe(true);
      expect(useReviewStore.getState().hasTriggeredFirstSocialSave).toBe(true);
      expect(Analytics.reviewSatisfactionShown).toHaveBeenCalledWith('first_social_save');
    });

    it('marks first_photo_import trigger and records analytics', () => {
      const { result } = renderHook(() => useReviewRequest());

      let flowStarted = false;
      act(() => {
        flowStarted = result.current.startReviewFlow('first_photo_import');
      });

      expect(flowStarted).toBe(true);
      expect(useReviewStore.getState().hasTriggeredFirstPhotoImport).toBe(true);
      expect(Analytics.reviewSatisfactionShown).toHaveBeenCalledWith('first_photo_import');
    });

    it('does not mark country_visited trigger', () => {
      const { result } = renderHook(() => useReviewRequest());

      let flowStarted = false;
      act(() => {
        flowStarted = result.current.startReviewFlow('country_visited');
      });

      expect(flowStarted).toBe(true);
      expect(useReviewStore.getState().hasTriggeredPostOnboarding).toBe(false);
      expect(useReviewStore.getState().hasTriggeredFirstSocialSave).toBe(false);
      expect(useReviewStore.getState().hasTriggeredFirstPhotoImport).toBe(false);
      expect(Analytics.reviewSatisfactionShown).toHaveBeenCalledWith('country_visited');
    });

    it('prevents double-triggering of same trigger', () => {
      const { result } = renderHook(() => useReviewRequest());

      let firstAttempt = false;
      let secondAttempt = false;

      act(() => {
        firstAttempt = result.current.startReviewFlow('post_onboarding');
      });

      act(() => {
        secondAttempt = result.current.startReviewFlow('post_onboarding');
      });

      expect(firstAttempt).toBe(true);
      expect(secondAttempt).toBe(false);
      expect(useReviewStore.getState().hasTriggeredPostOnboarding).toBe(true);
    });

    it('allows different trigger after lock reset', () => {
      const { result } = renderHook(() => useReviewRequest());

      let firstTrigger = false;
      let secondTrigger = false;

      act(() => {
        firstTrigger = result.current.startReviewFlow('post_onboarding');
      });

      // Simulate reset by calling handleNegativeResponse
      act(() => {
        result.current.handleNegativeResponse('post_onboarding');
      });

      act(() => {
        secondTrigger = result.current.startReviewFlow('country_visited');
      });

      expect(firstTrigger).toBe(true);
      expect(secondTrigger).toBe(true);
    });
  });

  describe('handlePositiveResponse', () => {
    it('marks review completed and requests native review', async () => {
      (StoreReview.hasAction as jest.Mock).mockResolvedValue(true);

      const { result } = renderHook(() => useReviewRequest());

      await act(async () => {
        await result.current.handlePositiveResponse('post_onboarding');
      });

      expect(Analytics.reviewSatisfactionPositive).toHaveBeenCalledWith('post_onboarding');
      expect(useReviewStore.getState().hasCompletedReview).toBe(true);
      expect(StoreReview.requestReview).toHaveBeenCalled();
    });

    it('resets trigger lock after positive response', async () => {
      (StoreReview.hasAction as jest.Mock).mockResolvedValue(true);

      const { result } = renderHook(() => useReviewRequest());

      // Lock the trigger
      act(() => {
        result.current.startReviewFlow('post_onboarding');
      });

      // Positive response should reset lock and mark completed
      await act(async () => {
        await result.current.handlePositiveResponse('post_onboarding');
      });

      expect(useReviewStore.getState().hasCompletedReview).toBe(true);
    });
  });

  describe('handleNegativeResponse', () => {
    it('records negative response and starts cooldown', () => {
      const { result } = renderHook(() => useReviewRequest());

      act(() => {
        result.current.handleNegativeResponse('post_onboarding');
      });

      expect(Analytics.reviewSatisfactionNegative).toHaveBeenCalledWith('post_onboarding');
      expect(useReviewStore.getState().lastPromptTimestamp).not.toBeNull();
    });

    it('resets trigger lock after negative response', () => {
      const { result } = renderHook(() => useReviewRequest());

      // Lock the trigger
      act(() => {
        result.current.startReviewFlow('post_onboarding');
      });

      // Negative response should reset lock
      act(() => {
        result.current.handleNegativeResponse('post_onboarding');
      });

      expect(useReviewStore.getState().lastPromptTimestamp).not.toBeNull();
    });
  });

  describe('handleDismiss', () => {
    it('records dismissal and starts cooldown', () => {
      const { result } = renderHook(() => useReviewRequest());

      act(() => {
        result.current.handleDismiss('country_visited');
      });

      expect(Analytics.reviewSatisfactionDismissed).toHaveBeenCalledWith('country_visited');
      expect(useReviewStore.getState().lastPromptTimestamp).not.toBeNull();
    });

    it('resets trigger lock after dismiss', () => {
      const { result } = renderHook(() => useReviewRequest());

      // Lock the trigger
      act(() => {
        result.current.startReviewFlow('country_visited');
      });

      // Dismiss should reset lock
      act(() => {
        result.current.handleDismiss('country_visited');
      });

      expect(useReviewStore.getState().lastPromptTimestamp).not.toBeNull();
    });
  });

  describe('integration scenarios', () => {
    it('complete positive review flow', async () => {
      (StoreReview.hasAction as jest.Mock).mockResolvedValue(true);

      const { result } = renderHook(() => useReviewRequest());

      // Check eligibility
      let canShow = false;
      act(() => {
        canShow = result.current.checkEligibility('post_onboarding');
      });
      expect(canShow).toBe(true);

      // Start flow
      let flowStarted = false;
      act(() => {
        flowStarted = result.current.startReviewFlow('post_onboarding');
      });
      expect(flowStarted).toBe(true);

      // Handle positive response
      await act(async () => {
        await result.current.handlePositiveResponse('post_onboarding');
      });

      expect(useReviewStore.getState().hasCompletedReview).toBe(true);
      expect(Analytics.reviewSatisfactionPositive).toHaveBeenCalled();
      expect(StoreReview.requestReview).toHaveBeenCalled();
    });

    it('complete negative review flow', async () => {
      const { result } = renderHook(() => useReviewRequest());

      // Check eligibility
      let canShow = false;
      act(() => {
        canShow = result.current.checkEligibility('first_social_save');
      });
      expect(canShow).toBe(true);

      // Start flow
      let flowStarted = false;
      act(() => {
        flowStarted = result.current.startReviewFlow('first_social_save');
      });
      expect(flowStarted).toBe(true);

      // Handle negative response
      act(() => {
        result.current.handleNegativeResponse('first_social_save');
      });

      expect(useReviewStore.getState().lastPromptTimestamp).not.toBeNull();
      expect(Analytics.reviewSatisfactionNegative).toHaveBeenCalled();
      // Should NOT mark as completed
      expect(useReviewStore.getState().hasCompletedReview).toBe(false);
    });

    it('complete dismiss flow', async () => {
      const { result } = renderHook(() => useReviewRequest());

      // Start flow
      let flowStarted = false;
      act(() => {
        flowStarted = result.current.startReviewFlow('first_photo_import');
      });
      expect(flowStarted).toBe(true);

      // Handle dismiss
      act(() => {
        result.current.handleDismiss('first_photo_import');
      });

      expect(useReviewStore.getState().lastPromptTimestamp).not.toBeNull();
      expect(Analytics.reviewSatisfactionDismissed).toHaveBeenCalled();
      // Should NOT mark as completed
      expect(useReviewStore.getState().hasCompletedReview).toBe(false);
    });
  });
});
