/**
 * The creation funnel's dedupe rules, which are the whole point of the hook:
 * exactly one terminal event per attempt, and an abandon event only when a
 * build was genuinely walked out on.
 */

import { renderHook } from '@testing-library/react-native';

import { useQuizCreationAnalytics } from '@screens/quiz/useQuizCreationAnalytics';
import { Analytics } from '@services/analytics';
import type { QuizCreationProgress } from '@services/quiz/quizCreationTypes';

jest.mock('@services/analytics', () => ({
  Analytics: {
    viewQuizCreation: jest.fn(),
    quizCreationStarted: jest.fn(),
    quizPhotoPermissionResult: jest.fn(),
    photoPermissionOsResult: jest.fn(),
    quizCreationFailed: jest.fn(),
    quizCreationAbandoned: jest.fn(),
  },
}));

const BASE = {
  entryPoint: 'passport_card' as const,
  phase: 'intro',
  progress: null as QuizCreationProgress | null,
  permissionStatus: 'granted',
  limitedAccess: false,
};

function setup(overrides: Partial<typeof BASE> = {}) {
  return renderHook((props: typeof BASE) => useQuizCreationAnalytics(props), {
    initialProps: { ...BASE, ...overrides },
  });
}

describe('useQuizCreationAnalytics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not report abandonment when no build was ever started', () => {
    const { unmount } = setup();

    unmount();

    expect(Analytics.quizCreationAbandoned).not.toHaveBeenCalled();
  });

  it('reports abandonment when a running build is walked out on', () => {
    const { result, rerender, unmount } = setup();

    result.current.trackStarted({ isResume: false, scanExpected: true, retryFrom: 'intro' });
    rerender({
      ...BASE,
      phase: 'working',
      progress: {
        step: 'building',
        current: 2,
        total: 8,
        pickUris: ['a', 'b', 'c'],
        examined: 210,
      },
    });
    unmount();

    expect(Analytics.quizCreationAbandoned).toHaveBeenCalledTimes(1);
    expect(Analytics.quizCreationAbandoned).toHaveBeenCalledWith(
      expect.objectContaining({
        entryPoint: 'passport_card',
        phase: 'working',
        attemptIndex: 1,
        step: 'building',
        foundCount: 3,
        examined: 210,
        uploadedCount: 2,
        viaCancelButton: false,
      })
    );
  });

  it('labels an explicit cancel apart from a swipe-back', () => {
    const { result, unmount } = setup();

    result.current.trackStarted({ isResume: false, scanExpected: true, retryFrom: 'intro' });
    result.current.markCancelButton();
    unmount();

    expect(Analytics.quizCreationAbandoned).toHaveBeenCalledWith(
      expect.objectContaining({ viaCancelButton: true })
    );
  });

  it('does not report abandonment after a successful creation', () => {
    // The wizard replaces itself with the play screen; that unmount is not a
    // walk-out.
    const { result, unmount } = setup();

    result.current.trackStarted({ isResume: false, scanExpected: true, retryFrom: 'intro' });
    result.current.trackOutcome({ status: 'created', quizId: 'q-1', photoCount: 8 });
    unmount();

    expect(Analytics.quizCreationAbandoned).not.toHaveBeenCalled();
    // Success is already counted by quiz_created; no failure event either.
    expect(Analytics.quizCreationFailed).not.toHaveBeenCalled();
  });

  it('does not report abandonment after a decline', () => {
    const { result, unmount } = setup();

    result.current.trackStarted({ isResume: false, scanExpected: true, retryFrom: 'intro' });
    result.current.trackOutcome({
      status: 'thin-library',
      eligibleCount: 2,
      hasGeoCandidates: true,
      dominantReason: 'people_present',
    });
    unmount();

    expect(Analytics.quizCreationFailed).toHaveBeenCalledTimes(1);
    expect(Analytics.quizCreationFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'thin_library',
        eligibleCount: 2,
        dominantReason: 'people_present',
      })
    );
    expect(Analytics.quizCreationAbandoned).not.toHaveBeenCalled();
  });

  it('maps the interrupted outcome to its upload counters', () => {
    const { result } = setup();

    result.current.trackStarted({ isResume: true, scanExpected: false, retryFrom: 'resume-draft' });
    result.current.trackOutcome({
      status: 'interrupted',
      quizId: 'q-1',
      uploadedCount: 3,
      totalCount: 8,
    });

    expect(Analytics.quizCreationFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'interrupted', uploadedCount: 3, totalCount: 8 })
    );
  });

  it('counts retries as attempts within one visit, and names what was retried', () => {
    const { result } = setup();

    result.current.trackStarted({ isResume: false, scanExpected: true, retryFrom: 'intro' });
    result.current.trackOutcome({ status: 'service-error', stage: 'scan' });
    result.current.trackStarted({
      isResume: false,
      scanExpected: true,
      retryFrom: 'service-error',
    });

    expect(Analytics.quizCreationStarted).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ attemptIndex: 1, retryFrom: null })
    );
    expect(Analytics.quizCreationStarted).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ attemptIndex: 2, retryFrom: 'service-error' })
    );
  });

  it('re-arms abandonment when a retry follows a terminal outcome', () => {
    const { result, unmount } = setup();

    result.current.trackStarted({ isResume: false, scanExpected: true, retryFrom: 'intro' });
    result.current.trackOutcome({ status: 'service-error', stage: 'scan' });
    result.current.trackStarted({
      isResume: false,
      scanExpected: true,
      retryFrom: 'service-error',
    });
    unmount();

    expect(Analytics.quizCreationAbandoned).toHaveBeenCalledWith(
      expect.objectContaining({ attemptIndex: 2 })
    );
  });

  it('fires the quiz permission result and the shared os-result together', () => {
    const { result } = setup();

    result.current.trackPermissionResult('limited');

    expect(Analytics.quizPhotoPermissionResult).toHaveBeenCalledWith({
      status: 'limited',
      entryPoint: 'passport_card',
    });
    expect(Analytics.photoPermissionOsResult).toHaveBeenCalledWith({
      door: 'quiz',
      status: 'limited',
    });
  });

  it('reports the view once, with the freshness the pre-flight resolved', () => {
    const { result } = setup();

    result.current.trackView({
      initialPhase: 'intro',
      hasDraft: false,
      freshness: {
        fresh: false,
        reason: 'never-synced',
        lastSuccessAt: null,
        cachedPhotoCount: 0,
        permission: 'granted',
      },
    });
    result.current.trackView({ initialPhase: 'intro', hasDraft: false, freshness: null });

    expect(Analytics.viewQuizCreation).toHaveBeenCalledTimes(1);
    expect(Analytics.viewQuizCreation).toHaveBeenCalledWith(
      expect.objectContaining({
        initialPhase: 'intro',
        libraryFresh: false,
        freshnessReason: 'never-synced',
        cachedPhotoCount: 0,
      })
    );
  });
});
