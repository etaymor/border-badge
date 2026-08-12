/**
 * QuizCreationScreen - one tap from the entry point to a built quiz.
 *
 * Owns every state of the creation flow:
 * - permission request / denied (Settings link) / limited-access awareness
 * - staged progress (scanning -> checking -> building), never a frozen spinner
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
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { usePhotoPermissionStatus } from '@hooks/usePhotoPermissions';
import { useCreateQuiz } from '@hooks/useQuizzes';
import { useStableCallback } from '@hooks/useStableCallback';
import type {
  QuizCreationOutcome,
  QuizCreationProgress,
  QuizCreationStep,
} from '@services/quiz/quizCreation';
import type { RootStackScreenProps } from '@navigation/types';

type Props = RootStackScreenProps<'QuizCreation'>;

type ScreenPhase =
  | 'checking-permission'
  | 'permission-request'
  | 'permission-denied'
  | 'working'
  | 'thin-library'
  | 'service-error'
  | 'interrupted';

const STEP_ORDER: QuizCreationStep[] = ['scanning', 'checking', 'building'];

const STEP_LABELS: Record<QuizCreationStep, string> = {
  scanning: 'Scanning your library',
  checking: 'Checking photos',
  building: 'Building your quiz',
};

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

  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);

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

  const startCreation = useStableCallback(() => {
    setPhase('working');
    setOutcome(null);
    setProgress({ step: 'scanning' });
    const controller = new AbortController();
    abortRef.current = controller;
    createQuiz.mutate(
      { onProgress: setProgress, signal: controller.signal },
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

  // Route the initial permission state once it is known.
  useEffect(() => {
    if (permissionLoading || startedRef.current) return;
    if (permissionStatus === 'granted' || permissionStatus === 'limited') {
      startedRef.current = true;
      startCreation();
    } else if (permissionStatus === 'denied') {
      setPhase('permission-denied');
    } else {
      setPhase('permission-request');
    }
  }, [permissionLoading, permissionStatus, startCreation]);

  // Abandoning the screen mid-flight keeps the persisted draft resumable (KTD7).
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleRequestPermission = useStableCallback(async () => {
    const granted = await requestPermission();
    if (granted === 'granted' || granted === 'limited') {
      startedRef.current = true;
      startCreation();
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

  return (
    <Screen>
      <View style={styles.container}>
        {phase === 'checking-permission' && (
          <View style={styles.centered} testID="quiz-permission-loading">
            <ActivityIndicator size="large" color={colors.sunsetGold} />
          </View>
        )}

        {phase === 'permission-request' && (
          <View style={styles.centered} testID="quiz-permission-request">
            <Text style={styles.title}>Travel Photo Quiz</Text>
            <Text style={styles.body}>
              We build a quiz from your own travel photos. Allow photo access so we can find
              geotagged shots from your trips. We check your photos on your device to pick the
              eligible ones, then upload copies of just those photos to build your quiz.
            </Text>
            <Button title="Allow Photo Access" onPress={handleRequestPermission} />
            <Button title="Not Now" variant="ghost" onPress={handleBack} />
          </View>
        )}

        {phase === 'permission-denied' && (
          <View style={styles.centered} testID="quiz-permission-denied">
            <Text style={styles.title}>Photo Access Needed</Text>
            <Text style={styles.body}>
              The quiz is built from your own travel photos, so it needs photo library access.
              Enable it in Settings, then come back to build your quiz.
            </Text>
            <Button title="Open Settings" onPress={handleOpenSettings} />
            <Button title="Back" variant="ghost" onPress={handleBack} />
          </View>
        )}

        {phase === 'working' && (
          <View style={styles.centered} testID="quiz-progress">
            <Text style={styles.title}>Building Your Quiz</Text>
            <View style={styles.steps}>
              {STEP_ORDER.map((step) => {
                const activeIndex = STEP_ORDER.indexOf(progress?.step ?? 'scanning');
                const stepIndex = STEP_ORDER.indexOf(step);
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
              This usually takes under a minute. Your photos stay private until you share the quiz.
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
                a quiz. Allow access to more of your library - especially geotagged outdoor shots
                from your trips - and try again.
              </Text>
              <Button title="Allow More Photos" onPress={handleOpenSettings} />
              <Button title="Try Again" variant="secondary" onPress={startCreation} />
              <Button title="Back" variant="ghost" onPress={handleBack} />
            </View>
          ) : (
            <View style={styles.centered} testID="quiz-thin-library">
              <Text style={styles.title}>Not Enough Quiz Photos Yet</Text>
              <Text style={styles.body}>
                A quiz needs at least 5 photos that are geotagged, outdoors, and show scenery or
                landmarks without people.
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
