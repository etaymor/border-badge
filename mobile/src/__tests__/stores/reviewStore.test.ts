/**
 * Tests for Review Store
 *
 * Tests state transitions, selectors, and cooldown logic
 */
import { useReviewStore, selectCanShowPrompt } from '@stores/reviewStore';

describe('reviewStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useReviewStore.setState({
      hasCompletedReview: false,
      lastPromptTimestamp: null,
      hasTriggeredPostOnboarding: false,
      hasTriggeredFirstSocialSave: false,
      hasTriggeredFirstPhotoImport: false,
    });
  });

  describe('initial state', () => {
    it('starts with correct initial state', () => {
      const state = useReviewStore.getState();

      expect(state.hasCompletedReview).toBe(false);
      expect(state.lastPromptTimestamp).toBeNull();
      expect(state.hasTriggeredPostOnboarding).toBe(false);
      expect(state.hasTriggeredFirstSocialSave).toBe(false);
      expect(state.hasTriggeredFirstPhotoImport).toBe(false);
    });
  });

  describe('state transitions', () => {
    it('markReviewCompleted sets both completion flag and timestamp', () => {
      const beforeTime = Date.now();
      useReviewStore.getState().markReviewCompleted();
      const afterTime = Date.now();

      const state = useReviewStore.getState();
      expect(state.hasCompletedReview).toBe(true);
      expect(state.lastPromptTimestamp).toBeDefined();
      expect(state.lastPromptTimestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(state.lastPromptTimestamp).toBeLessThanOrEqual(afterTime);
    });

    it('recordPromptShown updates lastPromptTimestamp', () => {
      const beforeTime = Date.now();
      useReviewStore.getState().recordPromptShown();
      const afterTime = Date.now();

      const state = useReviewStore.getState();
      expect(state.lastPromptTimestamp).toBeDefined();
      expect(state.lastPromptTimestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(state.lastPromptTimestamp).toBeLessThanOrEqual(afterTime);
    });

    it('markPostOnboardingTriggered sets the flag', () => {
      useReviewStore.getState().markPostOnboardingTriggered();

      expect(useReviewStore.getState().hasTriggeredPostOnboarding).toBe(true);
    });

    it('markFirstSocialSaveTriggered sets the flag', () => {
      useReviewStore.getState().markFirstSocialSaveTriggered();

      expect(useReviewStore.getState().hasTriggeredFirstSocialSave).toBe(true);
    });

    it('markFirstPhotoImportTriggered sets the flag', () => {
      useReviewStore.getState().markFirstPhotoImportTriggered();

      expect(useReviewStore.getState().hasTriggeredFirstPhotoImport).toBe(true);
    });
  });

  describe('selectors', () => {
    describe('selectCanShowPrompt', () => {
      it('returns false if review already completed', () => {
        useReviewStore.setState({ hasCompletedReview: true });

        const state = useReviewStore.getState();
        expect(selectCanShowPrompt(state)).toBe(false);
      });

      it('returns true if review not completed and no prior prompt', () => {
        const state = useReviewStore.getState();
        expect(selectCanShowPrompt(state)).toBe(true);
      });

      it('returns false within 7-day cooldown', () => {
        const now = Date.now();
        // Set lastPromptTimestamp to 1 hour ago
        const oneHourAgo = now - 60 * 60 * 1000;
        useReviewStore.setState({ lastPromptTimestamp: oneHourAgo });

        const state = useReviewStore.getState();
        expect(selectCanShowPrompt(state)).toBe(false);
      });

      it('returns false when cooldown period has not fully elapsed', () => {
        const now = Date.now();
        const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
        // Set timestamp to 7 days - 1 second ago (still in cooldown)
        const beforeCooldownEnds = now - COOLDOWN_MS + 1000;
        useReviewStore.setState({ lastPromptTimestamp: beforeCooldownEnds });

        const state = useReviewStore.getState();
        expect(selectCanShowPrompt(state)).toBe(false);
      });

      it('returns true after 7-day cooldown passes', () => {
        const now = Date.now();
        const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
        // Set timestamp to 7 days + 1 second ago (cooldown completed)
        const afterCooldownEnds = now - COOLDOWN_MS - 1000;
        useReviewStore.setState({ lastPromptTimestamp: afterCooldownEnds });

        const state = useReviewStore.getState();
        expect(selectCanShowPrompt(state)).toBe(true);
      });

      it('returns false if review completed even if cooldown expired', () => {
        const now = Date.now();
        const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
        const afterCooldownEnds = now - COOLDOWN_MS - 1000;
        useReviewStore.setState({
          hasCompletedReview: true,
          lastPromptTimestamp: afterCooldownEnds,
        });

        const state = useReviewStore.getState();
        expect(selectCanShowPrompt(state)).toBe(false);
      });
    });
  });

  describe('complex scenarios', () => {
    it('handles multiple trigger flags independently', () => {
      useReviewStore.getState().markPostOnboardingTriggered();
      expect(useReviewStore.getState().hasTriggeredPostOnboarding).toBe(true);
      expect(useReviewStore.getState().hasTriggeredFirstSocialSave).toBe(false);
      expect(useReviewStore.getState().hasTriggeredFirstPhotoImport).toBe(false);

      useReviewStore.getState().markFirstSocialSaveTriggered();
      expect(useReviewStore.getState().hasTriggeredPostOnboarding).toBe(true);
      expect(useReviewStore.getState().hasTriggeredFirstSocialSave).toBe(true);
      expect(useReviewStore.getState().hasTriggeredFirstPhotoImport).toBe(false);
    });

    it('can record prompt shown and then mark review completed', () => {
      // Record a prompt
      useReviewStore.getState().recordPromptShown();
      const afterPrompt = useReviewStore.getState().lastPromptTimestamp;
      expect(afterPrompt).not.toBeNull();

      // Then mark as completed later
      useReviewStore.getState().markReviewCompleted();
      const state = useReviewStore.getState();

      expect(state.hasCompletedReview).toBe(true);
      // Timestamp should be updated to more recent time
      expect(state.lastPromptTimestamp).toBeGreaterThanOrEqual(afterPrompt!);
    });

    it('completion state blocks any future prompts', () => {
      useReviewStore.getState().markReviewCompleted();
      const state = useReviewStore.getState();

      // Even with no prior restrictions, completion prevents future prompts
      expect(selectCanShowPrompt(state)).toBe(false);
    });
  });
});
