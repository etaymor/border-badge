/**
 * Funnel instrumentation for the Guess Where creation wizard.
 *
 * The wizard is the longest, least observable step in the feature: up to nine
 * phases, up to ~90 seconds, and five terminal outcomes of which only one is
 * success. Before this, the only thing it emitted was `quiz_created`, so every
 * way a build could fail to produce a challenge looked identical to a user who
 * never started one.
 *
 * Two things this owns that the screen cannot:
 *
 * - The ABANDON path. Leaving mid-build is a swipe-back or an unmount, not a
 *   handler, so measuring it needs refs that survive re-render, a duration
 *   anchor, and dedupe against the terminal events. Live phase/progress are
 *   mirrored into refs by an effect; the unmount closure must never read state
 *   directly, which is captured stale.
 * - The ATTEMPT counter. Retrying after a decline is one visit with several
 *   attempts, not several visitors.
 *
 * Failure and abandonment stay separate events on purpose. A thin library is a
 * gate-tuning problem; a walk-out at 71 seconds is a patience problem.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { QuizEntryPoint } from '@navigation/types';
import { Analytics } from '@services/analytics';
import type { LibraryFreshness } from '@services/photoImport/photoLibrarySyncStatus';
import type { QuizCreationOutcome, QuizCreationProgress } from '@services/quiz/quizCreationTypes';

interface UseQuizCreationAnalyticsArgs {
  entryPoint: QuizEntryPoint;
  phase: string;
  progress: QuizCreationProgress | null;
  permissionStatus: string;
  limitedAccess: boolean;
}

export interface QuizCreationAnalytics {
  /** The wizard settled on its opening phase. Fires once per mount. */
  trackView: (args: {
    initialPhase: string;
    hasDraft: boolean;
    draftUploadedCount?: number | null;
    draftTotalCount?: number | null;
    freshness: LibraryFreshness | null;
  }) => void;
  /** A build kicked off. `retryFrom` is the phase it was launched from. */
  trackStarted: (args: { isResume: boolean; scanExpected: boolean; retryFrom: string }) => void;
  /** The photo permission prompt returned. */
  trackPermissionResult: (status: string) => void;
  /** A terminal non-success outcome. Also disarms the abandon path. */
  trackOutcome: (outcome: QuizCreationOutcome) => void;
  /**
   * Marks the exit that follows as an explicit Cancel rather than a
   * swipe-back. Both land in the same unmount; only the user's intent differs.
   */
  markCancelButton: () => void;
}

/** Phases from which a start is a retry rather than a first attempt. */
const RETRY_PHASES = new Set(['thin-library', 'service-error', 'interrupted', 'resume-draft']);

export function useQuizCreationAnalytics({
  entryPoint,
  phase,
  progress,
  permissionStatus,
  limitedAccess,
}: UseQuizCreationAnalyticsArgs): QuizCreationAnalytics {
  const viewFiredRef = useRef(false);
  const startedRef = useRef(false);
  const terminalFiredRef = useRef(false);
  const attemptIndexRef = useRef(0);
  const startedAtRef = useRef(0);
  const viaCancelButtonRef = useRef(false);

  // Mirrors of live state, so the unmount closure below reads the values as
  // they were at exit rather than as they were when it was created.
  const phaseRef = useRef(phase);
  const progressRef = useRef(progress);
  const limitedAccessRef = useRef(limitedAccess);
  const entryPointRef = useRef(entryPoint);
  const permissionStatusRef = useRef(permissionStatus);

  useEffect(() => {
    phaseRef.current = phase;
    progressRef.current = progress;
    limitedAccessRef.current = limitedAccess;
    entryPointRef.current = entryPoint;
    permissionStatusRef.current = permissionStatus;
  }, [phase, progress, limitedAccess, entryPoint, permissionStatus]);

  const trackView = useCallback<QuizCreationAnalytics['trackView']>((args) => {
    if (viewFiredRef.current) return;
    viewFiredRef.current = true;
    Analytics.viewQuizCreation({
      entryPoint: entryPointRef.current,
      initialPhase: args.initialPhase,
      permissionStatus: permissionStatusRef.current,
      limitedAccess: limitedAccessRef.current,
      hasDraft: args.hasDraft,
      draftUploadedCount: args.draftUploadedCount,
      draftTotalCount: args.draftTotalCount,
      libraryFresh: args.freshness?.fresh ?? null,
      freshnessReason: args.freshness?.reason ?? null,
      cachedPhotoCount: args.freshness?.cachedPhotoCount ?? null,
    });
  }, []);

  const trackStarted = useCallback<QuizCreationAnalytics['trackStarted']>((args) => {
    startedRef.current = true;
    terminalFiredRef.current = false;
    attemptIndexRef.current += 1;
    startedAtRef.current = Date.now();
    Analytics.quizCreationStarted({
      entryPoint: entryPointRef.current,
      attemptIndex: attemptIndexRef.current,
      isResume: args.isResume,
      scanExpected: args.scanExpected,
      limitedAccess: limitedAccessRef.current,
      retryFrom: RETRY_PHASES.has(args.retryFrom) ? args.retryFrom : null,
    });
  }, []);

  const trackPermissionResult = useCallback<QuizCreationAnalytics['trackPermissionResult']>(
    (status) => {
      Analytics.quizPhotoPermissionResult({ status, entryPoint: entryPointRef.current });
    },
    []
  );

  const trackOutcome = useCallback<QuizCreationAnalytics['trackOutcome']>((outcome) => {
    // Every terminal outcome disarms abandonment, success included: the
    // wizard replaces itself with the play screen, and that unmount is not a
    // walk-out. Cancellation is already counted by the abandon path.
    terminalFiredRef.current = true;
    if (outcome.status === 'created' || outcome.status === 'cancelled') return;

    const shared = {
      entryPoint: entryPointRef.current,
      attemptIndex: attemptIndexRef.current,
      durationMs: startedAtRef.current > 0 ? Date.now() - startedAtRef.current : 0,
      limitedAccess: limitedAccessRef.current,
      examined: progressRef.current?.examined ?? null,
      foundCount: progressRef.current?.pickUris?.length ?? null,
    };

    switch (outcome.status) {
      case 'thin-library':
        Analytics.quizCreationFailed({
          ...shared,
          reason: 'thin_library',
          eligibleCount: outcome.eligibleCount,
          hasGeoCandidates: outcome.hasGeoCandidates,
          dominantReason: outcome.dominantReason ?? null,
        });
        break;
      case 'service-error':
        Analytics.quizCreationFailed({ ...shared, reason: 'service_error', stage: outcome.stage });
        break;
      case 'interrupted':
        Analytics.quizCreationFailed({
          ...shared,
          reason: 'interrupted',
          uploadedCount: outcome.uploadedCount,
          totalCount: outcome.totalCount,
        });
        break;
    }
  }, []);

  // Abandonment: a build was running and nothing terminal ever arrived.
  useEffect(() => {
    return () => {
      if (!startedRef.current || terminalFiredRef.current) return;
      Analytics.quizCreationAbandoned({
        entryPoint: entryPointRef.current,
        phase: phaseRef.current,
        attemptIndex: attemptIndexRef.current,
        durationMs: startedAtRef.current > 0 ? Date.now() - startedAtRef.current : 0,
        step: progressRef.current?.step ?? null,
        foundCount: progressRef.current?.pickUris?.length ?? 0,
        examined: progressRef.current?.examined ?? 0,
        uploadedCount: progressRef.current?.current ?? 0,
        viaCancelButton: viaCancelButtonRef.current,
      });
    };
  }, []);

  const markCancelButton = useCallback(() => {
    viaCancelButtonRef.current = true;
  }, []);

  // Stable identity: every callback closes over refs only, so consumers can
  // safely list this in an effect's deps without re-running it.
  return useMemo(
    () => ({ trackView, trackStarted, trackPermissionResult, trackOutcome, markCancelButton }),
    [trackView, trackStarted, trackPermissionResult, trackOutcome, markCancelButton]
  );
}
