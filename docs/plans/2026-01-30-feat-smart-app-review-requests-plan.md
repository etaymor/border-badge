---
title: "feat: Smart App Review Requests at Key Moments"
type: feat
date: 2026-01-30
---

# Smart App Review Requests at Key Moments

## Overview

Implement an intelligent app review request system that prompts users at emotionally positive moments in their journey. The system uses a two-step "satisfaction gate" flow on **both platforms** to ensure we only show the native review prompt to users who are enjoying the app. Once a user completes a review or indicates satisfaction, they never see the prompt again.

## Problem Statement / Motivation

App Store ratings significantly impact discoverability and user trust. Currently, Atlasi has no mechanism to request reviews from satisfied users. By prompting at the right moments—after positive experiences—we can:

1. **Increase review volume** from happy users
2. **Filter out frustrated users** before they reach the review prompt
3. **Provide a feedback channel** for users having a poor experience
4. **Respect user attention** with smart cooldowns and one-time prompting

## Policy Note

> **Google Play policy context:** Google prohibits asking opinion questions "before or while presenting the rating button or card." Our satisfaction modal appears BEFORE the review flow is initiated, and only users who respond positively proceed to the native review. Users who respond negatively are directed to support instead—they never see the rating card. This is a satisfaction gate, not a review manipulation.

## Proposed Solution

### Two-Step Flow (Both Platforms)

```
[Trigger Event] → [Eligibility Check] → [Satisfaction Modal] → [Native Review Prompt]
                                              ↓
                                        [If Negative]
                                              ↓
                                        [Link to Support]
```

The satisfaction modal asks "How are you enjoying Atlasi?" with options:
- **"I love it!"** → Proceeds to native App Store/Play Store review prompt
- **"Could be better"** → Opens support email (no review prompt shown)
- **"Not now"** → Dismisses, starts 7-day cooldown

### Trigger Points

| # | Trigger | Screen/Location | First-Time Only? |
|---|---------|-----------------|------------------|
| 1 | Post-onboarding | After `ProgressSummaryScreen`, before `NameEntry` | Yes (always first time) |
| 2 | Country marked visited | `CountryDetailScreen` or `PassportScreen` | No (any country) |
| 3 | First social save | `ShareCaptureScreen` OR detected on app foreground (via new entries) | Yes |
| 4 | First photo import completion | `PhotoImportScreen` | Yes |

**Note on Trigger #3:** We removed native Share Extension integration. Instead, when the user returns to the app after using the Share Extension, we detect the new entry in the database and trigger the review flow then. This is simpler and the user is in the app context.

### State Management (Simplified)

```typescript
// mobile/src/stores/reviewStore.ts
interface ReviewState {
  // Core state (only what we need)
  hasCompletedReview: boolean;        // Never show again if true
  lastPromptTimestamp: number | null; // For 7-day cooldown

  // First-time trigger tracking
  hasTriggeredPostOnboarding: boolean;
  hasTriggeredFirstSocialSave: boolean;
  hasTriggeredFirstPhotoImport: boolean;
}
```

**Simplifications from review feedback:**
- Removed `promptCount` - trust platform rate limits (iOS: 3/year, Android: quota-based)
- Removed `lastPromptOutcome` - only needed for analytics, fire event and forget
- Removed `installTimestamp` - was never used
- Removed `getDaysSinceLastPrompt()` - inlined into eligibility check

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Review System                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │ reviewStore  │    │ useReview    │    │ SatisfactionModal│  │
│  │ (Zustand +   │◄───│ Request      │◄───│ (both platforms) │  │
│  │ AsyncStorage)│    │ (hook)       │    │                  │  │
│  └──────────────┘    └──────────────┘    └──────────────────┘  │
│                             │                     │             │
│                             ▼                     ▼             │
│                      ┌──────────────┐    ┌──────────────────┐  │
│                      │ expo-store-  │    │ Support Link     │  │
│                      │ review       │    │ (mailto:)        │  │
│                      └──────────────┘    └──────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation Phases

#### Phase 1: Foundation

**Tasks:**
- [x] Install `expo-store-review` package
- [x] Create `reviewStore.ts` with Zustand + AsyncStorage persistence
- [x] Create `useReviewRequest` hook with eligibility logic
- [x] Add typed analytics events for review funnel tracking

**Files to create:**
- `mobile/src/stores/reviewStore.ts`
- `mobile/src/hooks/useReviewRequest.ts`

**Files to modify:**
- `mobile/src/services/analytics.ts` (add typed review events)

#### Phase 2: UI Components

**Tasks:**
- [x] Create `SatisfactionModal` component
- [x] Implement positive/negative response handling
- [x] Add support link (opens https://atlasi.app/contact instead of email)
- [x] Add haptic feedback on interactions
- [x] Add accessibility labels

**Files to create:**
- `mobile/src/components/review/SatisfactionModal.tsx`

#### Phase 3: Trigger Integration

**Tasks:**
- [x] Integrate post-onboarding trigger (after `ProgressSummaryScreen`)
- [x] Integrate country-visited trigger (in `CountryDetailScreen`)
- [x] Integrate first social save trigger (in `ShareCaptureScreen`)
- [x] Integrate first photo import trigger (in `PhotoImportScreen`)

**Files to modify:**
- `mobile/src/screens/onboarding/ProgressSummaryScreen.tsx`
- `mobile/src/screens/country/CountryDetailScreen.tsx`
- `mobile/src/screens/share/useShareCapture.ts`
- `mobile/src/screens/photos/usePhotoImportWorkflow.ts`
- `mobile/src/navigation/RootNavigator.tsx` (foreground detection for social save)

## Detailed Implementation

### reviewStore.ts

```typescript
// mobile/src/stores/reviewStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  reset: () => void; // For testing
}

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

// Pure eligibility check (no side effects)
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

      markReviewCompleted: () => set({
        hasCompletedReview: true,
        lastPromptTimestamp: Date.now(),
      }),

      recordPromptShown: () => set({
        lastPromptTimestamp: Date.now(),
      }),

      markPostOnboardingTriggered: () => set({ hasTriggeredPostOnboarding: true }),
      markFirstSocialSaveTriggered: () => set({ hasTriggeredFirstSocialSave: true }),
      markFirstPhotoImportTriggered: () => set({ hasTriggeredFirstPhotoImport: true }),

      reset: () => set(initialState),
    }),
    {
      name: 'review-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
```

### useReviewRequest.ts

```typescript
// mobile/src/hooks/useReviewRequest.ts
import { useCallback, useRef } from 'react';
import * as StoreReview from 'expo-store-review';
import {
  useReviewStore,
  selectCanShowPrompt,
  selectHasTriggeredPostOnboarding,
  selectHasTriggeredFirstSocialSave,
  selectHasTriggeredFirstPhotoImport,
} from '@/stores/reviewStore';
import { Analytics } from '@/services/analytics';

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
  handlePositiveResponse: () => Promise<void>;

  /**
   * Record that user responded negatively.
   * This starts the 7-day cooldown but does NOT mark as completed.
   */
  handleNegativeResponse: () => void;

  /**
   * Record that user dismissed without responding.
   * This starts the 7-day cooldown but does NOT mark as completed.
   */
  handleDismiss: () => void;
}

export function useReviewRequest(): UseReviewRequestReturn {
  // Use selectors to prevent unnecessary re-renders
  const canShowPrompt = useReviewStore(selectCanShowPrompt);
  const hasTriggeredPostOnboarding = useReviewStore(selectHasTriggeredPostOnboarding);
  const hasTriggeredFirstSocialSave = useReviewStore(selectHasTriggeredFirstSocialSave);
  const hasTriggeredFirstPhotoImport = useReviewStore(selectHasTriggeredFirstPhotoImport);

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
  const checkEligibility = useCallback((trigger: ReviewTrigger): boolean => {
    // Check global eligibility first
    if (!canShowPrompt) {
      return false;
    }

    // Check trigger-specific eligibility
    switch (trigger) {
      case 'post_onboarding':
        return !hasTriggeredPostOnboarding;

      case 'first_social_save':
        return !hasTriggeredFirstSocialSave;

      case 'first_photo_import':
        return !hasTriggeredFirstPhotoImport;

      case 'country_visited':
        // No first-time restriction for country visits
        return true;

      default:
        return false;
    }
  }, [canShowPrompt, hasTriggeredPostOnboarding, hasTriggeredFirstSocialSave, hasTriggeredFirstPhotoImport]);

  // Mark trigger as used - call AFTER checkEligibility returns true
  const startReviewFlow = useCallback((trigger: ReviewTrigger): boolean => {
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
  }, [markPostOnboardingTriggered, markFirstSocialSaveTriggered, markFirstPhotoImportTriggered]);

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

  const handlePositiveResponse = useCallback(async () => {
    Analytics.reviewSatisfactionPositive();
    markReviewCompleted();

    // Request native review
    await requestNativeReview();
  }, [markReviewCompleted, requestNativeReview]);

  const handleNegativeResponse = useCallback(() => {
    Analytics.reviewSatisfactionNegative();
    recordPromptShown(); // Start cooldown
  }, [recordPromptShown]);

  const handleDismiss = useCallback(() => {
    Analytics.reviewSatisfactionDismissed();
    recordPromptShown(); // Start cooldown
  }, [recordPromptShown]);

  return {
    checkEligibility,
    startReviewFlow,
    requestNativeReview,
    handlePositiveResponse,
    handleNegativeResponse,
    handleDismiss,
  };
}
```

### SatisfactionModal.tsx

```typescript
// mobile/src/components/review/SatisfactionModal.tsx
import React from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  Linking,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors, Typography } from '@/constants';
import { SUPPORT_EMAIL } from '@/config/constants';
import Constants from 'expo-constants';
import { Analytics } from '@/services/analytics';

interface SatisfactionModalProps {
  visible: boolean;
  onPositive: () => void;
  onNegative: () => void;
  onDismiss: () => void;
}

export function SatisfactionModal({
  visible,
  onPositive,
  onNegative,
  onDismiss,
}: SatisfactionModalProps) {
  const handlePositive = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
      // Haptics not available - continue silently
    });
    onPositive();
  };

  const handleNegative = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
      // Haptics not available - continue silently
    });
    onNegative();

    // Open support email with context
    const appVersion = Constants.expoConfig?.version || 'unknown';
    const subject = encodeURIComponent('Atlasi Feedback');
    const body = encodeURIComponent(
      `\n\n---\nApp Version: ${appVersion}\nPlatform: ${Platform.OS}\n`
    );
    const mailtoUrl = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;

    try {
      const canOpen = await Linking.canOpenURL(mailtoUrl);
      if (canOpen) {
        Analytics.reviewSupportLinkTapped();
        await Linking.openURL(mailtoUrl);
      }
    } catch (error) {
      console.warn('Failed to open email client:', error);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      accessibilityViewIsModal
    >
      <Pressable style={styles.overlay} onPress={onDismiss}>
        <Pressable style={styles.dialog} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>How are you enjoying Atlasi?</Text>
          <Text style={styles.subtitle}>
            Your feedback helps us improve the app for everyone.
          </Text>

          <View style={styles.buttonContainer}>
            <Pressable
              style={[styles.button, styles.positiveButton]}
              onPress={handlePositive}
              accessibilityRole="button"
              accessibilityLabel="I love Atlasi"
              accessibilityHint="Tap to proceed to leave a review"
            >
              <Text style={[styles.buttonText, styles.positiveButtonText]}>
                I love it!
              </Text>
            </Pressable>

            <Pressable
              style={[styles.button, styles.negativeButton]}
              onPress={handleNegative}
              accessibilityRole="button"
              accessibilityLabel="Could be better"
              accessibilityHint="Tap to send feedback to the team"
            >
              <Text style={[styles.buttonText, styles.negativeButtonText]}>
                Could be better
              </Text>
            </Pressable>
          </View>

          <Pressable
            style={styles.dismissButton}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Not now"
            accessibilityHint="Dismiss this prompt"
          >
            <Text style={styles.dismissText}>Not now</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    backgroundColor: Colors.background,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  title: {
    ...Typography.h2,
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
  },
  button: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  positiveButton: {
    backgroundColor: Colors.primary,
  },
  negativeButton: {
    backgroundColor: Colors.surfaceSecondary,
  },
  buttonText: {
    ...Typography.button,
  },
  positiveButtonText: {
    color: Colors.textOnPrimary,
  },
  negativeButtonText: {
    color: Colors.text,
  },
  dismissButton: {
    marginTop: 16,
    padding: 8,
  },
  dismissText: {
    ...Typography.caption,
    color: Colors.textTertiary,
  },
});
```

### Trigger Integration Examples

#### Post-Onboarding (ProgressSummaryScreen.tsx)

```typescript
// In ProgressSummaryScreen.tsx
import { useState } from 'react';
import { useReviewRequest } from '@/hooks/useReviewRequest';
import { SatisfactionModal } from '@/components/review/SatisfactionModal';

function ProgressSummaryScreen() {
  const [showReviewModal, setShowReviewModal] = useState(false);
  const {
    checkEligibility,
    startReviewFlow,
    handlePositiveResponse,
    handleNegativeResponse,
    handleDismiss,
  } = useReviewRequest();

  const handleContinue = () => {
    // Check eligibility (pure check, no side effects)
    if (checkEligibility('post_onboarding')) {
      // Mark trigger as used and show modal
      if (startReviewFlow('post_onboarding')) {
        setShowReviewModal(true);
        return; // Don't navigate yet
      }
    }

    // Navigate to next screen
    navigation.navigate('NameEntry');
  };

  const handleReviewPositive = async () => {
    setShowReviewModal(false);
    await handlePositiveResponse();
    navigation.navigate('NameEntry');
  };

  const handleReviewNegative = () => {
    setShowReviewModal(false);
    handleNegativeResponse();
    navigation.navigate('NameEntry');
  };

  const handleReviewDismiss = () => {
    setShowReviewModal(false);
    handleDismiss();
    navigation.navigate('NameEntry');
  };

  return (
    <>
      {/* Existing UI */}
      <SatisfactionModal
        visible={showReviewModal}
        onPositive={handleReviewPositive}
        onNegative={handleReviewNegative}
        onDismiss={handleReviewDismiss}
      />
    </>
  );
}
```

#### Country Visited (CountryDetailScreen.tsx)

```typescript
// In CountryDetailScreen.tsx
const [showReviewModal, setShowReviewModal] = useState(false);
const { checkEligibility, startReviewFlow, handlePositiveResponse, handleNegativeResponse, handleDismiss } = useReviewRequest();

// In ShareCardOverlay onClose handler
const handleShareOverlayClose = () => {
  setShowShareOverlay(false);

  // Check eligibility (pure check)
  if (checkEligibility('country_visited')) {
    if (startReviewFlow('country_visited')) {
      setShowReviewModal(true);
    }
  }
};
```

#### First Social Save Detection (RootNavigator.tsx)

Since the Share Extension creates entries in the database, we detect "first social save" when the app foregrounds and finds new entries that weren't there before:

```typescript
// In RootNavigator.tsx or a dedicated hook
import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useReviewRequest } from '@/hooks/useReviewRequest';
import { useEntries } from '@/hooks/useEntries';

function useFirstSocialSaveDetection() {
  const { checkEligibility, startReviewFlow } = useReviewRequest();
  const { data: entries } = useEntries();
  const lastEntryCountRef = useRef<number | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);

  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active' && lastEntryCountRef.current !== null) {
        const currentCount = entries?.length ?? 0;
        const previousCount = lastEntryCountRef.current;

        // New entries were added while app was backgrounded (likely from Share Extension)
        if (currentCount > previousCount) {
          if (checkEligibility('first_social_save')) {
            if (startReviewFlow('first_social_save')) {
              setShowReviewModal(true);
            }
          }
        }
      }

      // Update ref when going to background
      if (nextState === 'background') {
        lastEntryCountRef.current = entries?.length ?? 0;
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [entries?.length, checkEligibility, startReviewFlow]);

  return { showReviewModal, setShowReviewModal };
}
```

### Analytics Events (Typed)

```typescript
// Add to mobile/src/services/analytics.ts

// Review funnel events - typed methods
reviewSatisfactionShown: (trigger: ReviewTrigger) =>
  track('review_satisfaction_shown', { trigger }),
reviewSatisfactionPositive: () =>
  track('review_satisfaction_positive'),
reviewSatisfactionNegative: () =>
  track('review_satisfaction_negative'),
reviewSatisfactionDismissed: () =>
  track('review_satisfaction_dismissed'),
reviewNativeRequested: () =>
  track('review_native_requested'),
reviewNativeUnavailable: () =>
  track('review_native_unavailable'),
reviewNativeError: (error: string) =>
  track('review_native_error', { error }),
reviewSupportLinkTapped: () =>
  track('review_support_link_tapped'),
```

### Constants

```typescript
// Add to mobile/src/config/constants.ts
export const SUPPORT_EMAIL = 'support@atlasi.com';
```

## Acceptance Criteria

### Functional Requirements

- [ ] After onboarding (ProgressSummaryScreen), eligible users see satisfaction modal
- [ ] After marking a country visited and dismissing ShareCardOverlay, eligible users see satisfaction modal
- [ ] After first successful TikTok/Instagram save (in-app), eligible users see satisfaction modal
- [ ] When app foregrounds with new entries (Share Extension), eligible users see satisfaction modal
- [ ] After first photo import completion (at least one place confirmed), eligible users see satisfaction modal
- [ ] "I love it!" response triggers native App Store/Play Store review prompt
- [ ] "Could be better" response opens email composer with pre-filled support context
- [ ] "Not now" dismisses modal and starts 7-day cooldown
- [ ] Users who respond positively never see the prompt again
- [ ] 7-day cooldown enforced between prompt attempts

### Non-Functional Requirements

- [ ] Review state persists across app restarts (AsyncStorage)
- [ ] Selectors prevent unnecessary re-renders
- [ ] Analytics track complete review funnel with typed events

### Quality Gates

- [ ] All lint checks pass (`npm run lint`)
- [ ] All existing tests pass (`npm test`)
- [ ] Manual testing on iOS simulator and Android emulator
- [ ] Haptics gracefully fail on unsupported devices

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Satisfaction modal → positive response rate | > 60% | Analytics funnel |
| Positive response → native prompt requested | 100% | Analytics |
| App Store rating improvement | +0.3 stars | App Store Connect |
| Support email volume from negative responses | < 10/week | Email tracking |

## Dependencies & Prerequisites

- `expo-store-review` package (compatible with Expo SDK 54)
- Existing `AsyncStorage` setup (already in place)
- Support email address configured (`support@atlasi.com`)

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| iOS silent prompt suppression | Medium | Accept uncertainty - we track what we can |
| User annoyance from prompts | Medium | Strict cooldowns, satisfaction gate filters |
| Haptics crash on unsupported devices | Low | Catch and ignore haptic errors |

## Code Review Feedback Incorporated

Changes made based on reviewer feedback:

| Reviewer | Issue | Resolution |
|----------|-------|------------|
| DHH | State over-engineered (9 fields) | Reduced to 5 fields |
| DHH | `isEligible()` has side effects | Split into `checkEligibility()` (pure) and `startReviewFlow()` (mutates) |
| DHH | Unused `installTimestamp` | Removed |
| DHH | Unused `lastPromptOutcome` | Removed |
| DHH | Unused `promptCount` | Removed - trust platform limits |
| Kieran | Selectors as methods cause re-renders | Converted to exported selector functions |
| Kieran | Destructuring entire store | Use individual selectors, get actions from `getState()` |
| Kieran | Missing return type on `requestNativeReview` | Returns `Promise<boolean>` |
| Kieran | Raw `track()` calls | Use typed `Analytics.reviewXxx()` methods |
| Kieran | Hardcoded support email | Moved to `config/constants.ts` |
| Kieran | Missing accessibility labels | Added to all buttons |
| Kieran | Haptics can crash | Wrapped in `.catch()` |
| Simplicity | Remove Share Extension native integration | Removed - detect via database change instead |
| All | Satisfaction modal on both platforms | Kept as requested - filters unhappy users |

## References & Research

### Internal References

- Modal pattern: [mobile/src/components/ui/ConfirmDialog.tsx](mobile/src/components/ui/ConfirmDialog.tsx)
- State persistence: [mobile/src/stores/settingsStore.ts](mobile/src/stores/settingsStore.ts)
- Cooldown pattern: [mobile/src/stores/settingsStore.ts:55-68](mobile/src/stores/settingsStore.ts#L55-L68)
- Analytics service: [mobile/src/services/analytics.ts](mobile/src/services/analytics.ts)
- Share capture flow: [mobile/src/screens/share/useShareCapture.ts](mobile/src/screens/share/useShareCapture.ts)
- Photo import flow: [mobile/src/screens/photos/usePhotoImportWorkflow.ts](mobile/src/screens/photos/usePhotoImportWorkflow.ts)
- Country visited flow: [mobile/src/screens/country/CountryDetailScreen.tsx:139-178](mobile/src/screens/country/CountryDetailScreen.tsx#L139-L178)

### External References

- [expo-store-review documentation](https://docs.expo.dev/versions/latest/sdk/storereview/)
- [Apple SKStoreReviewController](https://developer.apple.com/documentation/storekit/skstorereviewcontroller)
- [Google Play In-App Review API](https://developer.android.com/guide/playcore/in-app-review)

### Best Practices Research

- iOS allows max 3 prompts per 365 days per user per app
- System controls whether prompt actually appears (no feedback to app)
- TestFlight builds never show review prompt
- Android has time-bound quota (~monthly), no hard limit disclosed
- Industry data shows 5-10x improvement with satisfaction gate
