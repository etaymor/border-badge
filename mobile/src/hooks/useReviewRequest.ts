/**
 * useReviewRequest - Hook for managing app review request flow
 *
 * Provides eligibility checks and handlers for the two-step satisfaction gate flow.
 * Uses expo-store-review for native App Store/Play Store review prompts.
 */
import { useCallback, useRef } from 'react';
import * as StoreReview from 'expo-store-review';

import {
  useReviewStore,
  selectCanShowPrompt,
  selectHasTriggeredPostOnboarding,
  selectHasTriggeredFirstSocialSave,
  selectHasTriggeredFirstPhotoImport,
} from '@stores/reviewStore';
import { Analytics } from '@services/analytics';

export type ReviewTrigger =
  | 'post_onboarding'
  | 'country_visited'
  | 'first_social_save'
  | 'first_photo_import';

interface UseReviewRequestReturn {
  /**
   * Check if review prompt should be shown for this trigger.
   * This is a PURE CHECK - no side effects.
   */
  checkEligibility: (trigger: ReviewTrigger) => boolean;

  /**
   * Mark the trigger as used and start the review flow.
   * Call this AFTER checkEligibility returns true.
   * Returns true if the flow should proceed.
   */
  startReviewFlow: (trigger: ReviewTrigger) => boolean;

  /**
   * Request the native store review prompt.
   * Call this AFTER user responds positively to satisfaction modal.
   */
  requestNativeReview: () => Promise<boolean>;

  /**
   * Record that user responded positively.
   * This marks review as "completed" and triggers native prompt.
   */
  handlePositiveResponse: (trigger: ReviewTrigger) => Promise<void>;

  /**
   * Record that user responded negatively.
   * This starts the 7-day cooldown but does NOT mark as completed.
   */
  handleNegativeResponse: (trigger: ReviewTrigger) => void;

  /**
   * Record that user dismissed without responding.
   * This starts the 7-day cooldown but does NOT mark as completed.
   */
  handleDismiss: (trigger: ReviewTrigger) => void;
}

export function useReviewRequest(): UseReviewRequestReturn {
  // Get actions directly from store (stable references)
  const {
    markReviewCompleted,
    recordPromptShown,
    markPostOnboardingTriggered,
    markFirstSocialSaveTriggered,
    markFirstPhotoImportTriggered,
  } = useReviewStore.getState();

  // Prevent multiple triggers in same render cycle
  const triggerLockRef = useRef<string | null>(null);

  // Pure eligibility check - NO SIDE EFFECTS
  // Uses getState() to always read fresh state at call time, avoiding stale closures
  const checkEligibility = useCallback((trigger: ReviewTrigger): boolean => {
    const state = useReviewStore.getState();

    // Check global eligibility first
    if (!selectCanShowPrompt(state)) {
      return false;
    }

    // Check trigger-specific eligibility
    switch (trigger) {
      case 'post_onboarding':
        return !selectHasTriggeredPostOnboarding(state);

      case 'first_social_save':
        return !selectHasTriggeredFirstSocialSave(state);

      case 'first_photo_import':
        return !selectHasTriggeredFirstPhotoImport(state);

      case 'country_visited':
        // No first-time restriction for country visits
        return true;

      default:
        return false;
    }
  }, []); // No dependencies needed - reads fresh state each call

  // Mark trigger as used - call AFTER checkEligibility returns true
  const startReviewFlow = useCallback(
    (trigger: ReviewTrigger): boolean => {
      // Prevent double-triggering
      if (triggerLockRef.current === trigger) {
        return false;
      }
      triggerLockRef.current = trigger;

      // Mark the trigger as used
      switch (trigger) {
        case 'post_onboarding':
          markPostOnboardingTriggered();
          break;
        case 'first_social_save':
          markFirstSocialSaveTriggered();
          break;
        case 'first_photo_import':
          markFirstPhotoImportTriggered();
          break;
        case 'country_visited':
          // No marking needed - can trigger multiple times
          break;
      }

      Analytics.reviewSatisfactionShown(trigger);
      return true;
    },
    [markPostOnboardingTriggered, markFirstSocialSaveTriggered, markFirstPhotoImportTriggered]
  );

  const requestNativeReview = useCallback(async (): Promise<boolean> => {
    try {
      const hasAction = await StoreReview.hasAction();
      if (!hasAction) {
        Analytics.reviewNativeUnavailable();
        return false;
      }

      Analytics.reviewNativeRequested();
      await StoreReview.requestReview();
      return true;
    } catch (error) {
      console.warn('Failed to request native review:', error);
      Analytics.reviewNativeError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, []);

  const handlePositiveResponse = useCallback(
    async (trigger: ReviewTrigger) => {
      Analytics.reviewSatisfactionPositive(trigger);
      markReviewCompleted();

      // Request native review
      await requestNativeReview();

      // Reset lock so the same trigger can fire again in future sessions
      triggerLockRef.current = null;
    },
    [markReviewCompleted, requestNativeReview]
  );

  const handleNegativeResponse = useCallback(
    (trigger: ReviewTrigger) => {
      Analytics.reviewSatisfactionNegative(trigger);
      recordPromptShown(); // Start cooldown

      // Reset lock so the same trigger can fire again in future sessions
      triggerLockRef.current = null;
    },
    [recordPromptShown]
  );

  const handleDismiss = useCallback(
    (trigger: ReviewTrigger) => {
      Analytics.reviewSatisfactionDismissed(trigger);
      recordPromptShown(); // Start cooldown

      // Reset lock so the same trigger can fire again in future sessions
      triggerLockRef.current = null;
    },
    [recordPromptShown]
  );

  return {
    checkEligibility,
    startReviewFlow,
    requestNativeReview,
    handlePositiveResponse,
    handleNegativeResponse,
    handleDismiss,
  };
}
