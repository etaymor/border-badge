/**
 * QuizCreationScreen - the Guess Where creation wizard (Q5).
 *
 * A stepper instead of a single blocking screen: an intro step confirms what
 * is about to happen (pre-flighted against the shared library freshness, so
 * a warm cache promises no scan), then the build runs with only the steps
 * that actually exist. The photo-scan step is SKIPPED entirely when the
 * cache is fresh (P1: ensureFreshLibrary emits no scanning progress then) -
 * repeat creations no longer feel as heavy as the first.
 *
 * The service keeps sole ownership of sequencing: one createQuiz.mutate call
 * drives refresh + classify + build exactly as before, and the rendered step
 * list follows ACTUAL progress events - the pre-flight only chooses the
 * initial list, so a fresh->stale race between pre-flight and mutate cannot
 * desync the UI.
 *
 * Owns every state of the creation flow:
 * - intro (freshness-aware confirm) and resume-draft confirm (pre-flighted
 *   via loadDraftState instead of discovered after an interruption)
 * - permission request / denied (Settings link) / limited-access awareness
 * - staged progress, never a frozen spinner
 * - thin-library decline with guidance (AE2), with a distinct "allow more
 *   photos" branch when access is limited
 * - retryable service failure, DISTINCT from the thin-library decline
 * - interrupted upload with resume/abandon (abandon keeps the resumable
 *   draft - KTD7)
 *
 * On success navigates to QuizPlay for the owner play-through.
 */

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';

import { Button } from '@components/ui/Button';
import { Screen } from '@components/ui/Screen';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { usePhotoPermissionStatus } from '@hooks/usePhotoPermissions';
import { useCreateQuiz } from '@hooks/useQuizzes';
import { useStableCallback } from '@hooks/useStableCallback';
import {
  getLibraryFreshness,
  type LibraryFreshness,
} from '@services/photoImport/photoLibrarySyncStatus';
import { loadDraftState } from '@services/quiz/quizCreation';
import type {
  QuizCreationOutcome,
  QuizCreationProgress,
  QuizCreationStep,
} from '@services/quiz/quizCreation';
import type { RootStackScreenProps } from '@navigation/types';

type Props = RootStackScreenProps<'QuizCreation'>;

type ScreenPhase =
  | 'checking-permission'
  | 'intro'
  | 'resume-draft'
  | 'permission-request'
  | 'permission-denied'
  | 'working'
  | 'thin-library'
  | 'service-error'
  | 'interrupted';

const STEP_LABELS: Record<QuizCreationStep, string> = {
  scanning: 'Checking for new photos',
  checking: 'Reading the scenery',
  building: 'Dealing your challenge',
};

function formatSyncedAgo(lastSuccessAt: number | null): string | null {
  if (!lastSuccessAt) return null;
  const minutes = Math.max(1, Math.round((Date.now() - lastSuccessAt) / 60_000));
  if (minutes < 60) return `synced ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `synced ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
}

export function QuizCreationScreen({ navigation }: Props) {
  const {
    status: permissionStatus,
    isLoading: permissionLoading,
    requestPermission,
  } = usePhotoPermissionStatus();
  const createQuiz = useCreateQuiz();

  const [phase, setPhase] = useState<ScreenPhase>('checking-permission');
  const [progress, setProgress] = useState<QuizCreationProgress | null>(null);
  const [outcome, setOutcome] = useState<QuizCreationOutcome | null>(null);
  const [freshness, setFreshness] = useState<LibraryFreshness | null>(null);
  const [draftUploadCounts, setDraftUploadCounts] = useState<{
    uploaded: number;
    total: number;
  } | null>(null);
  // Steps the wizard shows: the pre-flight picks the initial list, and a
  // real 'scanning' progress event re-adds the step if the pre-flight was
  // optimistic (fresh->stale race).
  const [visibleSteps, setVisibleSteps] = useState<QuizCreationStep[]>([
    'scanning',
    'checking',
    'building',
  ]);

  const abortRef = useRef<AbortController | null>(null);
  const preflightRef = useRef(false);

  const limitedAccess = permissionStatus === 'limited';

  const handleOutcome = useStableCallback((result: QuizCreationOutcome) => {
    setOutcome(result);
    switch (result.status) {
      case 'created':
        navigation.navigate('QuizPlay', { quizId: result.quizId });
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

  const handleProgress = useStableCallback((update: QuizCreationProgress) => {
    setProgress(update);
    // The service is the truth: if a scan actually runs, the step exists.
    if (update.step === 'scanning') {
      setVisibleSteps((steps) => (steps.includes('scanning') ? steps : ['scanning', ...steps]));
    }
  });

  const startCreation = useStableCallback(() => {
    setPhase('working');
    setOutcome(null);
    const scanExpected = !freshness?.fresh;
    setVisibleSteps(scanExpected ? ['scanning', 'checking', 'building'] : ['checking', 'building']);
    setProgress({ step: scanExpected ? 'scanning' : 'checking' });
    const controller = new AbortController();
    abortRef.current = controller;
    createQuiz.mutate(
      { onProgress: handleProgress, signal: controller.signal },
      {
        onSuccess: handleOutcome,
        onError: () => {
          // Unexpected failure: surface the retryable branch, never the decline.
          setOutcome({ status: 'service-error', stage: 'classify' });
          setPhase('service-error');
        },
      }
    );
  });

  // Pre-flight once the permission state is known: a picks-bearing draft
  // goes to the resume confirm, everything else to the freshness-aware
  // intro. Permission prompting stays behind the intro CTA.
  useEffect(() => {
    if (permissionLoading || preflightRef.current) return;
    preflightRef.current = true;

    if (permissionStatus === 'denied') {
      setPhase('permission-denied');
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
        setDraftUploadCounts({
          uploaded: draft.picks.filter((pick) => pick.uploaded).length,
          total: draft.picks.length,
        });
        setPhase('resume-draft');
      } else if (permissionStatus === 'granted' || permissionStatus === 'limited') {
        setPhase('intro');
      } else {
        setPhase('permission-request');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [permissionLoading, permissionStatus]);

  // Abandoning the screen mid-flight keeps the persisted draft resumable (KTD7).
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleRequestPermission = useStableCallback(async () => {
    const granted = await requestPermission();
    if (granted === 'granted' || granted === 'limited') {
      const currentFreshness = await getLibraryFreshness().catch(() => null);
      setFreshness(currentFreshness);
      setPhase('intro');
    } else {
      setPhase('permission-denied');
    }
  });

  const handleCancel = useStableCallback(() => {
    abortRef.current?.abort();
    navigation.goBack();
  });

  const handleBack = useStableCallback(() => {
    navigation.goBack();
  });

  const handleOpenSettings = useStableCallback(() => {
    Linking.openSettings();
  });

  const syncedAgo = formatSyncedAgo(freshness?.lastSuccessAt ?? null);
  const freshnessLine = freshness?.fresh
    ? freshness.reason === 'writer-active'
      ? 'Your library is syncing right now - we will use the freshest photos.'
      : `Your photo library is ready${syncedAgo ? ` - ${syncedAgo}` : ''}${
          freshness.cachedPhotoCount > 0
            ? ` - ${freshness.cachedPhotoCount.toLocaleString()} photos`
            : ''
        }.`
    : 'We will check your library for new photos first.';

  return (
    <Screen>
      <View style={styles.container}>
        {phase === 'checking-permission' && (
          <View style={styles.centered} testID="quiz-permission-loading">
            <ActivityIndicator size="large" color={colors.sunsetGold} />
          </View>
        )}

        {phase === 'intro' && (
          <View style={styles.centered} testID="quiz-intro-step">
            <Text style={styles.eyebrow}>Guess Where</Text>
            <Text style={styles.title}>New Challenge</Text>
            <Text style={styles.body}>
              We pick 5-10 geotagged photos from your trips, you play them once to set the score to
              beat, then the challenge is ready to share.
            </Text>
            <Text style={styles.freshnessLine} testID="quiz-freshness-line">
              {freshnessLine}
            </Text>
            <Button title="Build My Challenge" onPress={startCreation} testID="quiz-build-start" />
            <Button title="Not Now" variant="ghost" onPress={handleBack} />
          </View>
        )}

        {phase === 'resume-draft' && (
          <View style={styles.centered} testID="quiz-resume-draft">
            <Text style={styles.eyebrow}>Guess Where</Text>
            <Text style={styles.title}>An Unfinished Challenge</Text>
            <Text style={styles.body}>
              {draftUploadCounts
                ? `${draftUploadCounts.uploaded} of ${draftUploadCounts.total} photos already made it up. `
                : ''}
              Resuming only uploads the rest - your picks are saved.
            </Text>
            <Button title="Resume" onPress={startCreation} testID="quiz-resume-start" />
            <Button title="Finish Later" variant="ghost" onPress={handleBack} />
          </View>
        )}

        {phase === 'permission-request' && (
          <View style={styles.centered} testID="quiz-permission-request">
            <Text style={styles.title}>Your Photos, Their Guesses</Text>
            <Text style={styles.body}>
              A challenge is built from your own travel photos. Allow photo access so we can find
              geotagged shots from your trips. We check your photos on your device to pick the
              eligible ones, then upload copies of just those photos to build your challenge.
            </Text>
            <Button title="Allow Photo Access" onPress={handleRequestPermission} />
            <Button title="Not Now" variant="ghost" onPress={handleBack} />
          </View>
        )}

        {phase === 'permission-denied' && (
          <View style={styles.centered} testID="quiz-permission-denied">
            <Text style={styles.title}>Photo Access Needed</Text>
            <Text style={styles.body}>
              The challenge is built from your own travel photos, so it needs photo library access.
              Enable it in Settings, then come back to build your challenge.
            </Text>
            <Button title="Open Settings" onPress={handleOpenSettings} />
            <Button title="Back" variant="ghost" onPress={handleBack} />
          </View>
        )}

        {phase === 'working' && (
          <View style={styles.centered} testID="quiz-progress">
            <Text style={styles.title}>Building Your Challenge</Text>
            <View style={styles.steps}>
              {visibleSteps.map((step) => {
                const activeIndex = visibleSteps.indexOf(progress?.step ?? visibleSteps[0]);
                const stepIndex = visibleSteps.indexOf(step);
                const state =
                  stepIndex < activeIndex
                    ? 'done'
                    : stepIndex === activeIndex
                      ? 'active'
                      : 'pending';
                return (
                  <View key={step} style={styles.stepRow}>
                    <View style={styles.stepMarker}>
                      {state === 'active' ? (
                        <ActivityIndicator size="small" color={colors.sunsetGold} />
                      ) : (
                        <Text style={styles.stepMarkDone}>{state === 'done' ? 'Done' : ''}</Text>
                      )}
                    </View>
                    <Text style={state === 'pending' ? styles.stepLabelPending : styles.stepLabel}>
                      {STEP_LABELS[step]}
                      {state === 'active' &&
                      progress?.current !== undefined &&
                      progress?.total !== undefined &&
                      progress.total > 0
                        ? `  ${progress.current} / ${progress.total}`
                        : ''}
                    </Text>
                  </View>
                );
              })}
            </View>
            <Text style={styles.hint}>
              This usually takes under a minute. Your photos stay private until you share the
              challenge.
            </Text>
            <Button title="Cancel" variant="ghost" onPress={handleCancel} />
          </View>
        )}

        {phase === 'thin-library' &&
          (limitedAccess ? (
            <View style={styles.centered} testID="quiz-thin-limited">
              <Text style={styles.title}>Limited Photo Access</Text>
              <Text style={styles.body}>
                Border Badge can only see the photos you selected, and that was not enough to build
                a challenge. Allow access to more of your library - especially geotagged outdoor
                shots from your trips - and try again.
              </Text>
              <Button title="Allow More Photos" onPress={handleOpenSettings} />
              <Button title="Try Again" variant="secondary" onPress={startCreation} />
              <Button title="Back" variant="ghost" onPress={handleBack} />
            </View>
          ) : (
            <View style={styles.centered} testID="quiz-thin-library">
              <Text style={styles.title}>Not Enough Photos Yet</Text>
              <Text style={styles.body}>
                A challenge needs at least 5 photos that are geotagged, outdoors, and show scenery
                or landmarks without people.
                {outcome?.status === 'thin-library' && outcome.hasGeoCandidates
                  ? ' We found travel photos, but too few passed those checks.'
                  : ' We could not find geotagged travel photos in your library.'}
                {'\n\n'}
                Take a few outdoor shots on your next trip with location enabled, then try again.
              </Text>
              <Button title="Try Again" variant="secondary" onPress={startCreation} />
              <Button title="Back" variant="ghost" onPress={handleBack} />
            </View>
          ))}

        {phase === 'service-error' && (
          <View style={styles.centered} testID="quiz-service-error">
            <Text style={styles.title}>Something Went Wrong</Text>
            <Text style={styles.body}>
              We could not check your photos right now. This is a temporary problem on our side or
              with your connection - your library is fine. Please try again.
            </Text>
            <Button title="Retry" onPress={startCreation} />
            <Button title="Back" variant="ghost" onPress={handleBack} />
          </View>
        )}

        {phase === 'interrupted' && (
          <View style={styles.centered} testID="quiz-interrupted">
            <Text style={styles.title}>Upload Interrupted</Text>
            <Text style={styles.body}>
              {outcome?.status === 'interrupted'
                ? `${outcome.uploadedCount} of ${outcome.totalCount} photos made it before the connection dropped. `
                : ''}
              Your progress is saved - resuming will only upload the remaining photos.
            </Text>
            <Button title="Resume" onPress={startCreation} />
            <Button title="Finish Later" variant="ghost" onPress={handleBack} />
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    gap: 16,
  },
  eyebrow: {
    fontFamily: fonts.body.bold,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.mossGreen,
    textAlign: 'center',
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.body.regular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  freshnessLine: {
    fontFamily: fonts.body.semiBold,
    fontSize: 13,
    lineHeight: 19,
    color: withAlpha(colors.midnightNavy, 0.6),
    textAlign: 'center',
  },
  steps: {
    gap: 16,
    paddingVertical: 8,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepMarker: {
    width: 44,
    alignItems: 'flex-start',
  },
  stepMarkDone: {
    fontFamily: fonts.body.semiBold,
    fontSize: 13,
    color: colors.mossGreen,
  },
  stepLabel: {
    fontFamily: fonts.body.semiBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  stepLabelPending: {
    fontFamily: fonts.body.regular,
    fontSize: 16,
    color: colors.textTertiary,
  },
  hint: {
    fontFamily: fonts.body.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textTertiary,
    textAlign: 'center',
  },
});
