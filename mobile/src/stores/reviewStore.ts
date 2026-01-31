/**
 * Review Request Store
 *
 * Manages state for the smart app review request system.
 * Uses Zustand with AsyncStorage persistence.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface ReviewState {
  // Core state
  hasCompletedReview: boolean;
  lastPromptTimestamp: number | null;

  // First-time tracking
  hasTriggeredPostOnboarding: boolean;
  hasTriggeredFirstSocialSave: boolean;
  hasTriggeredFirstPhotoImport: boolean;
}

interface ReviewActions {
  markReviewCompleted: () => void;
  recordPromptShown: () => void;
  markPostOnboardingTriggered: () => void;
  markFirstSocialSaveTriggered: () => void;
  markFirstPhotoImportTriggered: () => void;
}

const initialState: ReviewState = {
  hasCompletedReview: false,
  lastPromptTimestamp: null,
  hasTriggeredPostOnboarding: false,
  hasTriggeredFirstSocialSave: false,
  hasTriggeredFirstPhotoImport: false,
};

export const useReviewStore = create<ReviewState & ReviewActions>()(
  persist(
    (set) => ({
      ...initialState,

      markReviewCompleted: () =>
        set({
          hasCompletedReview: true,
          lastPromptTimestamp: Date.now(),
        }),

      recordPromptShown: () =>
        set({
          lastPromptTimestamp: Date.now(),
        }),

      markPostOnboardingTriggered: () => set({ hasTriggeredPostOnboarding: true }),
      markFirstSocialSaveTriggered: () => set({ hasTriggeredFirstSocialSave: true }),
      markFirstPhotoImportTriggered: () => set({ hasTriggeredFirstPhotoImport: true }),
    }),
    {
      name: 'review-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

// Selectors - use these to prevent unnecessary re-renders
export const selectHasCompletedReview = (state: ReviewState & ReviewActions) =>
  state.hasCompletedReview;

export const selectLastPromptTimestamp = (state: ReviewState & ReviewActions) =>
  state.lastPromptTimestamp;

export const selectHasTriggeredPostOnboarding = (state: ReviewState & ReviewActions) =>
  state.hasTriggeredPostOnboarding;

export const selectHasTriggeredFirstSocialSave = (state: ReviewState & ReviewActions) =>
  state.hasTriggeredFirstSocialSave;

export const selectHasTriggeredFirstPhotoImport = (state: ReviewState & ReviewActions) =>
  state.hasTriggeredFirstPhotoImport;

/**
 * Pure eligibility check (no side effects)
 * Returns true if a review prompt can be shown based on:
 * - User has not completed a review
 * - 7-day cooldown has passed since last prompt
 */
export const selectCanShowPrompt = (state: ReviewState & ReviewActions): boolean => {
  // Never show if already completed
  if (state.hasCompletedReview) return false;

  // Check 7-day cooldown
  if (state.lastPromptTimestamp) {
    const elapsed = Date.now() - state.lastPromptTimestamp;
    if (elapsed < COOLDOWN_MS) return false;
  }

  return true;
};
