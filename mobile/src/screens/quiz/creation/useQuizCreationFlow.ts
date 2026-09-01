/**
 * useQuizCreationFlow - Everything the creation wizard KNOWS, separated from
 * everything it DRAWS.
 *
 * The screen was a single 939-line file holding a nine-state machine, a
 * pre-flight effect, six handlers, the derived build arithmetic, ~250 lines of
 * JSX and a stylesheet. That is over the repo's 500-line standard, but the
 * reason to split it is not the number: the phase machine and the slot grid
 * change for completely different reasons, and they were sharing a scroll
 * position.
 *
 * The hook owns the machine. It does NOT own the build — the `quiz-build` job
 * does, and that is why leaving the screen no longer destroys one. Progress is
 * read from `libraryJobStore`; the terminal outcome arrives through
 * `useQuizBuildJob`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';

import { SCAN_COPY } from '@constants/scanCopy';
import { usePhotoPermissionStatus } from '@hooks/usePhotoPermissions';
import { useQuizBuildJob } from '@hooks/useQuizBuildJob';
import { useStableCallback } from '@hooks/useStableCallback';
import { Analytics } from '@services/analytics';
import {
  getLibraryFreshness,
  type LibraryFreshness,
} from '@services/photoImport/photoLibrarySyncStatus';
import { QUIZ_MAX_PHOTOS } from '@services/quiz/candidateSelection';
import { loadDraftState } from '@services/quiz/quizCreation';
import type {
  QuizCreationOutcome,
  QuizCreationProgress,
  QuizCreationStep,
} from '@services/quiz/quizCreation';
import { selectQuizDetail, selectQuizProgress, useLibraryJobStore } from '@stores/libraryJobStore';
import type { QuizEntryPoint, RootStackScreenProps } from '@navigation/types';

import { useQuizCreationAnalytics } from '../useQuizCreationAnalytics';
import { formatSyncedAgo } from './quizCreationCopy';

export type ScreenPhase =
  | 'checking-permission'
  | 'intro'
  | 'resume-draft'
  | 'permission-request'
  | 'permission-denied'
  | 'working'
  | 'thin-library'
  | 'service-error'
  | 'interrupted';

/**
 * Share of the one progress meter that belongs to the photo hunt; the upload
 * fills the rest. The split is what lets a single bar span two steps whose
 * counts mean different things without ever moving backwards.
 */
const HUNT_BAR_SHARE = 0.7;

/** The live build, reduced to exactly the numbers the sheet renders. */
export interface BuildView {
  step: QuizCreationStep;
  pickUris: string[];
  lastPickUri: string | null;
  uploading: boolean;
  uploadedCount: number;
  barFraction: number;
  foundCount: number;
  foundTotal: number;
  showCounter: boolean;
  slotTotal: number;
  examined: number | undefined;
}

export interface QuizCreationFlow {
  phase: ScreenPhase;
  outcome: QuizCreationOutcome | null;
  limitedAccess: boolean;
  /** The one line the intro shows about how fresh the shared library is. */
  freshnessLine: string;
  isFirstScan: boolean;
  scaleLine: string;
  durationLine: string;
  draftHeroUri: string | null;
  draftUploadCounts: { uploaded: number; total: number } | null;
  build: BuildView;
  startCreation: () => void;
  handleRequestPermission: () => void;
  handlePreheatChoice: (choice: 'full-access' | 'select-photos' | 'dont-allow') => void;
  /** Stop the build, behind a confirm. */
  handleCancel: () => void;
  handleBack: () => void;
  handleClose: () => void;
  handleOpenSettings: () => void;
}

interface Options {
  entryPoint: QuizEntryPoint;
  navigation: RootStackScreenProps<'QuizCreation'>['navigation'];
}

export function useQuizCreationFlow({ entryPoint, navigation }: Options): QuizCreationFlow {
  const {
    status: permissionStatus,
    isLoading: permissionLoading,
    requestPermission,
  } = usePhotoPermissionStatus();
  const buildJob = useQuizBuildJob({ onOutcome: (result) => handleOutcome(result) });

  const [phase, setPhase] = useState<ScreenPhase>('checking-permission');
  // Progress is READ FROM THE JOB STORE, not held here. That is what lets the
  // screen unmount and remount without losing the build: it is a view onto a
  // running job, not its owner.
  const jobProgress = useLibraryJobStore(selectQuizProgress);
  const jobDetail = useLibraryJobStore(selectQuizDetail);
  const progress: QuizCreationProgress | null = useMemo(() => {
    if (!jobProgress) return null;
    return {
      step: jobDetail.step,
      current: jobProgress.current,
      total: jobProgress.total,
      pickUris: jobDetail.pickUris,
      examined: jobDetail.examined,
    };
  }, [jobProgress, jobDetail]);
  const [outcome, setOutcome] = useState<QuizCreationOutcome | null>(null);
  const [freshness, setFreshness] = useState<LibraryFreshness | null>(null);
  const [draftHeroUri, setDraftHeroUri] = useState<string | null>(null);
  // The resumable draft's photos, so Resume can paint the grid immediately.
  const [draftPickUris, setDraftPickUris] = useState<string[]>([]);
  const [draftUploadCounts, setDraftUploadCounts] = useState<{
    uploaded: number;
    total: number;
  } | null>(null);

  const preflightRef = useRef(false);

  const analytics = useQuizCreationAnalytics({
    entryPoint,
    phase,
    progress,
    permissionStatus,
    limitedAccess: permissionStatus === 'limited',
  });

  const limitedAccess = permissionStatus === 'limited';

  const handleOutcome = useStableCallback((result: QuizCreationOutcome) => {
    setOutcome(result);
    analytics.trackOutcome(result);
    switch (result.status) {
      case 'created':
        // REPLACE, not navigate: the wizard is done. Left on the stack, backing
        // out of play landed the player on this screen's finished loading
        // state instead of where they started. Replacing also makes plain
        // goBack() correct from every entry point (My Challenges keeps its
        // place in the stack; the wizard does not).
        navigation.replace('QuizPlay', { quizId: result.quizId });
        break;
      case 'thin-library':
        setPhase('thin-library');
        break;
      case 'service-error':
        setPhase('service-error');
        break;
      case 'interrupted':
        setPhase('interrupted');
        break;
      case 'cancelled':
        // The user backed out; the draft (if any) stays resumable.
        break;
    }
  });

  const startCreation = useStableCallback(() => {
    // Capture the launching phase before it changes: it is what separates a
    // first attempt from a retry after a decline.
    const retryFrom = phase;
    setPhase('working');
    setOutcome(null);
    const scanExpected = !freshness?.fresh;
    analytics.trackStarted({
      isResume: draftPickUris.length > 0,
      scanExpected,
      retryFrom,
    });
    // Resuming a draft already has its photos: seed the grid with them rather
    // than blanking it until the first upload tick arrives. A fresh start (or
    // a retry after a decline) has nothing to show, and must not show the
    // previous attempt's finds.
    // The seed travels with the job (rather than being painted into local
    // state) so the grid survives a remount alongside the build itself.
    buildJob.start({
      entryPoint,
      seedPickUris: draftPickUris.length > 0 ? draftPickUris : [],
      seedStep: draftPickUris.length > 0 ? 'building' : scanExpected ? 'scanning' : 'checking',
    });
  });

  // Pre-flight once the permission state is known: a picks-bearing draft
  // goes to the resume confirm, everything else to the freshness-aware
  // intro. Permission prompting stays behind the intro CTA.
  useEffect(() => {
    if (permissionLoading || preflightRef.current) return;

    // REATTACH FIRST. A build may already be running (or queued behind a trip
    // scan) because the user started it, left, and came back. Rendering the
    // working phase against the live store slice shows the grid as it stands
    // rather than restarting from an empty one - and skipping the draft
    // pre-flight avoids racing the run that is currently writing that draft.
    const liveBuild = useLibraryJobStore.getState().jobs['quiz-build'];
    if (liveBuild.phase === 'running' || liveBuild.phase === 'waiting') {
      preflightRef.current = true;
      setPhase('working');
      analytics.trackView({
        initialPhase: 'working',
        hasDraft: liveBuild.detail.pickUris.length > 0,
        freshness: null,
      });
      return;
    }

    preflightRef.current = true;

    if (permissionStatus === 'denied') {
      setPhase('permission-denied');
      analytics.trackView({ initialPhase: 'permission-denied', hasDraft: false, freshness: null });
      return;
    }

    let cancelled = false;
    (async () => {
      const [draft, currentFreshness] = await Promise.all([
        loadDraftState().catch(() => null),
        permissionStatus === 'granted' || permissionStatus === 'limited'
          ? getLibraryFreshness().catch(() => null)
          : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setFreshness(currentFreshness);
      if (draft && draft.picks.length > 0) {
        const uploaded = draft.picks.filter((pick) => pick.uploaded).length;
        setDraftUploadCounts({ uploaded, total: draft.picks.length });
        setDraftHeroUri(draft.picks[0]?.uri ?? null);
        setDraftPickUris(draft.picks.map((pick) => pick.uri));
        setPhase('resume-draft');
        analytics.trackView({
          initialPhase: 'resume-draft',
          hasDraft: true,
          draftUploadedCount: uploaded,
          draftTotalCount: draft.picks.length,
          freshness: currentFreshness,
        });
      } else if (permissionStatus === 'granted' || permissionStatus === 'limited') {
        setPhase('intro');
        analytics.trackView({
          initialPhase: 'intro',
          hasDraft: false,
          freshness: currentFreshness,
        });
      } else {
        setPhase('permission-request');
        Analytics.photoPermissionSoftAskShown({ door: 'quiz' });
        analytics.trackView({
          initialPhase: 'permission-request',
          hasDraft: false,
          freshness: currentFreshness,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [permissionLoading, permissionStatus, analytics]);

  // NOTE: there is deliberately no unmount abort here. The build is owned by
  // the `quiz-build` job, so leaving the screen leaves it running; the user
  // can keep using the app and come back to a fuller grid. Stopping is an
  // explicit, confirmed action (handleCancel).

  const handleRequestPermission = useStableCallback(async () => {
    const granted = await requestPermission();
    analytics.trackPermissionResult(granted);
    if (granted === 'granted' || granted === 'limited') {
      const currentFreshness = await getLibraryFreshness().catch(() => null);
      setFreshness(currentFreshness);
      setPhase('intro');
    } else {
      setPhase('permission-denied');
    }
  });

  const handlePreheatChoice = useStableCallback(
    async (choice: 'full-access' | 'select-photos' | 'dont-allow') => {
      if (choice === 'full-access') {
        await handleRequestPermission();
        return;
      }
      setPhase('permission-denied');
    }
  );

  // Stop the build outright. The persisted draft stays resumable (KTD7), so
  // the classification already paid for is not thrown away.
  const handleStopBuilding = useStableCallback(() => {
    analytics.markCancelButton();
    buildJob.cancel();
    navigation.goBack();
  });

  // Mid-build the destructive option has to be confirmed: now that leaving the
  // screen keeps the build running, an unconfirmed Stop would be the only way
  // to lose work by accident. Mirrors confirmCancelScan on the trips side.
  const handleCancel = useStableCallback(() => {
    Alert.alert(
      'Stop building?',
      'Your challenge is still being built. You can leave this screen and it will keep going.',
      [
        { text: 'Keep Building', style: 'cancel' },
        { text: 'Stop', style: 'destructive', onPress: handleStopBuilding },
      ]
    );
  });

  const handleBack = useStableCallback(() => {
    navigation.goBack();
  });

  // One close button for every phase. Mid-build it now simply LEAVES: the job
  // owns the run, so closing the wizard no longer destroys it. Progress shows
  // in the persistent bar and the screen reattaches on return. Stopping is the
  // explicit, confirmed action instead of the incidental one.
  const handleClose = useStableCallback(() => {
    handleBack();
  });

  const handleOpenSettings = useStableCallback(() => {
    Linking.openSettings();
  });

  const syncedAgo = formatSyncedAgo(freshness?.lastSuccessAt ?? null);
  /**
   * A first scan is the run this screen has to explain hardest, so it gets
   * three short lines - what will happen, how big the library is, roughly how
   * long. Everything else gets one.
   */
  const isFirstScan = !freshness?.fresh && freshness?.reason === 'never-synced';
  const freshnessLine = freshness?.fresh
    ? freshness.reason === 'writer-active'
      ? SCAN_COPY.quiz.freshnessSyncing
      : SCAN_COPY.quiz.freshnessReady(syncedAgo, freshness.cachedPhotoCount)
    : isFirstScan
      ? SCAN_COPY.quiz.freshnessNeverSynced
      : SCAN_COPY.quiz.freshnessStale;
  const scaleLine = SCAN_COPY.shared.scaleLine(freshness?.cachedPhotoCount, isFirstScan);
  const durationLine = SCAN_COPY.shared.durationLine(freshness?.cachedPhotoCount);

  const build = useMemo<BuildView>(() => {
    // Live build state (service contract: pickUris = the locked game in slot
    // order, APPEND-ONLY across the whole run; hero = the most recent find;
    // absent on scanning emissions).
    const step: QuizCreationStep = progress?.step ?? 'checking';
    const pickUris = progress?.pickUris ?? [];
    const uploading = step === 'building';
    const withinStep =
      progress?.total && progress.total > 0 && progress.current !== undefined
        ? Math.min(1, Math.max(0, progress.current / progress.total))
        : 0;
    // The counter always reads FOUND photos. During the upload the hunt is over
    // and every slot is filled, so it reads n of n - complete, and still.
    const foundTotal = uploading ? pickUris.length : (progress?.total ?? QUIZ_MAX_PHOTOS);
    return {
      step,
      pickUris,
      lastPickUri: pickUris.length > 0 ? pickUris[pickUris.length - 1] : null,
      uploading,
      uploadedCount: uploading ? (progress?.current ?? 0) : 0,
      // ONE meter across both steps. The hunt owns the first HUNT_BAR_SHARE,
      // the upload the rest, so the handover - where the count restarts at zero
      // against a different total - cannot make the bar jump backwards.
      barFraction: uploading
        ? HUNT_BAR_SHARE + (1 - HUNT_BAR_SHARE) * withinStep
        : HUNT_BAR_SHARE * withinStep,
      foundCount: uploading ? pickUris.length : (progress?.current ?? 0),
      foundTotal,
      showCounter: foundTotal > 0,
      // Hunting shows the game-size grid; once the hunt is over the real game
      // size is known, so the still-empty placeholders (never a found photo) go.
      slotTotal: uploading ? pickUris.length : QUIZ_MAX_PHOTOS,
      examined: progress?.examined,
    };
  }, [progress]);

  return {
    phase,
    outcome,
    limitedAccess,
    freshnessLine,
    isFirstScan,
    scaleLine,
    durationLine,
    draftHeroUri,
    draftUploadCounts,
    build,
    startCreation,
    handleRequestPermission,
    handlePreheatChoice,
    handleCancel,
    handleBack,
    handleClose,
    handleOpenSettings,
  };
}
