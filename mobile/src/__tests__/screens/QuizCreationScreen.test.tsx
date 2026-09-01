/**
 * Tests for QuizCreationScreen state rendering (the Q5 wizard).
 *
 * Covers the U4 screen-state requirements plus the wizard behaviors:
 * - permission denied renders the explanatory state with a Settings link
 * - the intro step is freshness-aware: a fresh cache promises no scan and
 *   the initial step list skips it; a stale cache announces the check
 * - a picks-bearing draft pre-flights straight to the resume confirm and
 *   shows the first saved pick as the hero
 * - limited photo access renders the "allow more photos" branch on a thin
 *   decline, distinct from the genuinely-thin-library guidance
 * - classifier/service failure renders a Retry branch, DISTINCT from the
 *   thin-library decline
 * - interrupted upload renders resume/abandon, with the last found photo
 *   (not the poster) as the hero when picks were found
 * - success navigates toward owner play (QuizPlay seam)
 * - the working phase renders the live build: hero of the latest find, the
 *   serif found-counter, the slot grid (photos + neutral placeholders), the
 *   privacy line, and the upload stage keeps every thumbnail visible
 */

import { act, fireEvent, render, screen, waitFor } from '../utils/testUtils';
import { createMockNavigation } from '../utils/mockFactories';

import { Image as ExpoImage } from 'expo-image';
import { SCAN_COPY } from '@constants/scanCopy';
import { QuizCreationScreen } from '@screens/quiz/QuizCreationScreen';
import type { QuizCreationOutcome, QuizCreationProgress } from '@services/quiz/quizCreation';
import { patchJobSlice, resetLibraryJobStore } from '@stores/libraryJobStore';
import type { RootStackScreenProps } from '@navigation/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// expo-image rendered as a plain RN Image so testIDs land on a host component
// and `props.source.uri` stays assertable (same approach as QuizPlay tests).
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
jest.mock('expo-image', () => {
  const React = require('react');
  const { Image: RNImage } = require('react-native');
  const MockImage = (props: Record<string, unknown>) => React.createElement(RNImage, props);
  MockImage.prefetch = jest.fn(() => Promise.resolve(true));
  MockImage.clearMemoryCache = jest.fn(() => Promise.resolve(true));
  return { Image: MockImage };
});
/* eslint-enable @typescript-eslint/no-require-imports */

const mockPermission = {
  status: 'granted' as 'undetermined' | 'granted' | 'limited' | 'denied',
  isLoading: false,
  refresh: jest.fn(),
  requestPermission: jest.fn(),
};
jest.mock('@hooks/usePhotoPermissions', () => ({
  usePhotoPermissionStatus: () => mockPermission,
}));

let mockOutcome: QuizCreationOutcome = { status: 'created', quizId: 'quiz-1', photoCount: 6 };
// When true the mutation never resolves, holding the screen in the working
// phase so the live-progress UI can be driven via `emitProgress`.
let mockHoldWorking = false;
// Progress updates the mock mutation replays before resolving with
// `mockOutcome`, so outcome states (e.g. interrupted) render with pickUris
// already in hand - mirroring the real service, which always emits progress
// before an interrupted outcome.
let mockProgressBeforeOutcome: QuizCreationProgress[] = [];
let capturedOnOutcome: ((outcome: QuizCreationOutcome) => void) | undefined;

/**
 * Push a progress update the way the real job does: into the library job
 * store. The screen is a VIEW onto that store now, so driving the store here
 * exercises the same path production uses rather than a callback the screen
 * happens to hold.
 */
function writeProgress(update: QuizCreationProgress) {
  patchJobSlice('quiz-build', {
    progress: {
      current: update.current ?? 0,
      total: update.total ?? 0,
      percentage: update.total ? Math.round(((update.current ?? 0) / update.total) * 100) : 0,
      phase: update.step,
    },
    detail: {
      step: update.step,
      pickUris: update.pickUris ?? [],
      examined: update.examined ?? 0,
    },
  });
}

const mockStart = jest.fn(() => {
  for (const update of mockProgressBeforeOutcome) {
    writeProgress(update);
  }
  if (mockHoldWorking) return;
  capturedOnOutcome?.(mockOutcome);
});
const mockCancel = jest.fn();

function emitProgress(update: QuizCreationProgress) {
  act(() => {
    writeProgress(update);
  });
}

jest.mock('@hooks/useQuizBuildJob', () => ({
  useQuizBuildJob: ({ onOutcome }: { onOutcome: (outcome: QuizCreationOutcome) => void }) => {
    capturedOnOutcome = onOutcome;
    return {
      phase: 'idle',
      percentage: null,
      detail: { step: 'scanning', pickUris: [], examined: 0 },
      isActive: false,
      isWaiting: false,
      start: mockStart,
      cancel: mockCancel,
    };
  },
}));

// The screen pre-flights the resumable draft; the creation orchestration
// itself is behind useCreateQuiz and never runs here.
const mockLoadDraftState = jest.fn();
jest.mock('@services/quiz/quizCreation', () => ({
  loadDraftState: (...args: []) => mockLoadDraftState(...args),
}));

const mockGetLibraryFreshness = jest.fn();
jest.mock('@services/photoImport/photoLibrarySyncStatus', () => ({
  getLibraryFreshness: (...args: []) => mockGetLibraryFreshness(...args),
}));

const mockNavigation =
  createMockNavigation() as unknown as RootStackScreenProps<'QuizCreation'>['navigation'];
const mockRoute = {
  key: 'test',
  name: 'QuizCreation',
} as RootStackScreenProps<'QuizCreation'>['route'];

function freshFreshness() {
  return {
    fresh: true,
    reason: 'synced-recently',
    lastSuccessAt: Date.now() - 5 * 60_000,
    cachedPhotoCount: 812,
    permission: 'granted',
  };
}

function neverSyncedFreshness() {
  return {
    fresh: false,
    reason: 'never-synced',
    lastSuccessAt: null,
    cachedPhotoCount: 0,
    permission: 'granted',
  };
}

function staleFreshness() {
  return {
    fresh: false,
    reason: 'stale',
    lastSuccessAt: Date.now() - 3 * 60 * 60_000,
    cachedPhotoCount: 812,
    permission: 'granted',
  };
}

async function renderScreen() {
  return render(<QuizCreationScreen navigation={mockNavigation} route={mockRoute} />);
}

/** Wait for the intro step and tap Build. */
async function startFromIntro() {
  await waitFor(() => expect(screen.getByTestId('quiz-build-start')).toBeTruthy());
  fireEvent.press(screen.getByTestId('quiz-build-start'));
}

describe('QuizCreationScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPermission.status = 'granted';
    mockPermission.isLoading = false;
    mockOutcome = { status: 'created', quizId: 'quiz-1', photoCount: 6 };
    mockHoldWorking = false;
    mockProgressBeforeOutcome = [];
    capturedOnOutcome = undefined;
    resetLibraryJobStore();
    mockLoadDraftState.mockResolvedValue(null);
    mockGetLibraryFreshness.mockResolvedValue(freshFreshness());
  });

  it('renders the explanatory denied state with a Settings link when permission is denied', async () => {
    mockPermission.status = 'denied';

    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-permission-denied')).toBeTruthy());
    expect(screen.getByText('Open Settings')).toBeTruthy();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('renders the permission request state when undetermined', async () => {
    mockPermission.status = 'undetermined';

    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-permission-request')).toBeTruthy());
    expect(screen.getByText('Allow Full Access')).toBeTruthy();
    // One scan feeds trips as well, and this is the moment the user decides
    // whether to grant at all - so the second payoff is named here.
    expect(screen.getByText(/Guess Where challenges/i)).toBeTruthy();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('confirms on the intro step before creating; no auto-start (Q5)', async () => {
    await renderScreen();

    // The wizard never fires the creation without the user's confirm.
    await waitFor(() => expect(screen.getByTestId('quiz-intro-step')).toBeTruthy());
    expect(mockStart).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('quiz-build-start'));
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
    // REPLACE, not navigate: the wizard has done its job, and leaving it on the
    // stack meant backing out of play landed on the creation loading screen.
    expect(mockNavigation.replace).toHaveBeenCalledWith('QuizPlay', { quizId: 'quiz-1' });
    expect(mockNavigation.navigate).not.toHaveBeenCalledWith('QuizPlay', { quizId: 'quiz-1' });
  });

  it('announces a ready library on the intro when the cache is fresh (Q5)', async () => {
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-freshness-line')).toBeTruthy());
    expect(screen.getByText(/library is ready/)).toBeTruthy();
    expect(screen.getByText(/812 photos/)).toBeTruthy();
  });

  it('announces the upcoming photo check when the cache is stale (Q5)', async () => {
    mockGetLibraryFreshness.mockResolvedValue(staleFreshness());

    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-freshness-line')).toBeTruthy());
    expect(screen.getByText(/check your library for new photos/)).toBeTruthy();
  });

  it('names the trips payoff on the very first scan (Q5)', async () => {
    mockGetLibraryFreshness.mockResolvedValue(neverSyncedFreshness());

    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-freshness-line')).toBeTruthy());
    // Only the first-ever scan gets the pitch; a stale library already has
    // trips, so it keeps the plain incremental-check line above.
    expect(screen.getByText(/builds your trips/i)).toBeTruthy();
  });

  it('pre-flights a picks-bearing draft straight to the resume confirm (Q5)', async () => {
    // Full DraftPick objects (per quizCreationTypes) so the hero branch that
    // reads picks[0].uri actually has a uri to render.
    const draftPick = (assetId: string, uploaded: boolean) => ({
      assetId,
      uri: `file:///photos/draft-${assetId}.jpg`,
      countryCode: 'JP',
      storagePath: uploaded ? `quiz-1/${assetId}.jpg` : null,
      uploaded,
    });
    mockLoadDraftState.mockResolvedValue({
      quizId: 'quiz-1',
      createdAt: 1,
      picks: [draftPick('a', true), draftPick('b', false), draftPick('c', false)],
    });

    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-resume-draft')).toBeTruthy());
    expect(screen.getByText(/1 of 3 photos already made it up/)).toBeTruthy();
    expect(mockStart).not.toHaveBeenCalled();

    // The hero is the FIRST saved pick's photo, not the intro poster.
    expect(screen.getByTestId('quiz-draft-hero')).toBeTruthy();
    const draftHeroImage = screen
      .UNSAFE_getAllByType(ExpoImage)
      .find(
        (node) => node.props.source?.uri === 'file:///photos/draft-a.jpg' && !node.props.testID
      );
    expect(draftHeroImage).toBeTruthy();

    fireEvent.press(screen.getByTestId('quiz-resume-start'));
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
  });

  it('renders thin-library guidance naming what is needed (AE2)', async () => {
    mockOutcome = { status: 'thin-library', eligibleCount: 3, hasGeoCandidates: true };

    await renderScreen();
    await startFromIntro();

    await waitFor(() => expect(screen.getByTestId('quiz-thin-library')).toBeTruthy());
    expect(screen.getByText(/geotagged, outdoors/)).toBeTruthy();
    expect(screen.getByText('Try Again')).toBeTruthy();
  });

  it('renders the distinct limited-access recovery branch', async () => {
    mockPermission.status = 'limited';
    mockOutcome = { status: 'thin-library', eligibleCount: 2, hasGeoCandidates: true };

    await renderScreen();
    await startFromIntro();

    await waitFor(() => expect(screen.getByTestId('quiz-thin-limited')).toBeTruthy());
    expect(screen.getByText('Open Settings')).toBeTruthy();
    expect(screen.getByText('Continue With Selected Photos')).toBeTruthy();
    expect(screen.queryByTestId('quiz-thin-library')).toBeNull();
  });

  it('renders a retry branch on service failure, distinct from the thin-library decline', async () => {
    mockOutcome = { status: 'service-error', stage: 'classify' };

    await renderScreen();
    await startFromIntro();

    await waitFor(() => expect(screen.getByTestId('quiz-service-error')).toBeTruthy());
    expect(screen.getByText('Retry')).toBeTruthy();
    expect(screen.queryByTestId('quiz-thin-library')).toBeNull();
    expect(screen.queryByTestId('quiz-thin-limited')).toBeNull();

    // Retry restarts the creation flow.
    fireEvent.press(screen.getByText('Retry'));
    expect(mockStart).toHaveBeenCalledTimes(2);
  });

  describe('working phase (live build)', () => {
    const picks = [
      'file:///photos/pick-0.jpg',
      'file:///photos/pick-1.jpg',
      'file:///photos/pick-2.jpg',
    ];

    async function startHeld() {
      mockHoldWorking = true;
      await renderScreen();
      await startFromIntro();
      await waitFor(() => expect(screen.getByTestId('quiz-progress')).toBeTruthy());
    }

    it('renders the counter, found thumbnails, placeholders, and privacy line while hunting', async () => {
      await startHeld();
      emitProgress({ step: 'checking', current: 3, total: 10, pickUris: picks });

      expect(screen.getByText('Building Your Challenge')).toBeTruthy();
      expect(
        screen.getByText(SCAN_COPY.quiz.workingStatus('checking', { isFirstScan: false }))
      ).toBeTruthy();
      expect(screen.getByTestId('quiz-found-counter')).toBeTruthy();
      expect(screen.getByText('3 of 10')).toBeTruthy();

      // Found slots carry the crisp thumbnails, in found order.
      expect(screen.getByTestId('quiz-slot-photo-0').props.source.uri).toBe(picks[0]);
      expect(screen.getByTestId('quiz-slot-photo-2').props.source.uri).toBe(picks[2]);
      // The remaining slots are neutral placeholders, never faded photos.
      expect(screen.getByTestId('quiz-slot-empty-3')).toBeTruthy();
      expect(screen.getByTestId('quiz-slot-empty-9')).toBeTruthy();
      expect(screen.queryByTestId('quiz-slot-empty-2')).toBeNull();
      expect(screen.queryByTestId('quiz-slot-photo-3')).toBeNull();

      // A returning build explains NOTHING: the library is already scanned,
      // so the wall of scan copy and the leave/stop pair are noise on a run
      // that is over in seconds.
      expect(screen.queryByTestId('quiz-privacy-line')).toBeNull();
      expect(screen.queryByTestId('quiz-trips-line')).toBeNull();
      expect(screen.queryByTestId('quiz-persistence-line')).toBeNull();
      expect(screen.queryByTestId('quiz-leave-running')).toBeNull();
      expect(screen.queryByTestId('quiz-cancel')).toBeNull();
      // The counter it IS about is untouched.
      expect(screen.getByTestId('quiz-progress-track')).toBeTruthy();
    });

    it('explains itself only on the very first scan', async () => {
      // never-synced: the one run with a long scan to explain and a reason to
      // teach that leaving the screen does not kill it.
      mockGetLibraryFreshness.mockResolvedValue(neverSyncedFreshness());
      await startHeld();
      emitProgress({ step: 'checking', current: 3, total: 10, pickUris: picks });

      expect(screen.getByText(SCAN_COPY.quiz.workingPrivacy[0])).toBeTruthy();
      expect(screen.getByText(SCAN_COPY.quiz.workingPrivacy[1])).toBeTruthy();
      expect(screen.getByText(SCAN_COPY.shared.persistenceParagraph)).toBeTruthy();
      expect(screen.getByTestId('quiz-leave-running')).toBeTruthy();
      expect(screen.getByTestId('quiz-cancel')).toBeTruthy();
    });

    it('drops even the first-scan copy once the upload starts', async () => {
      mockGetLibraryFreshness.mockResolvedValue(neverSyncedFreshness());
      await startHeld();
      emitProgress({ step: 'building', current: 2, total: 3, pickUris: picks });

      // The upload is finished work being sent: "nothing is uploaded yet" is
      // no longer true, and Stop reads as a way to throw away a challenge
      // that is seconds from existing.
      expect(screen.queryByTestId('quiz-privacy-line')).toBeNull();
      expect(screen.queryByTestId('quiz-persistence-line')).toBeNull();
      expect(screen.queryByTestId('quiz-leave-running')).toBeNull();
      expect(screen.queryByTestId('quiz-cancel')).toBeNull();
    });

    it('shows the most recent find as the hero photo', async () => {
      await startHeld();
      emitProgress({ step: 'checking', current: 3, total: 10, pickUris: picks });

      expect(screen.getByTestId('quiz-working-hero')).toBeTruthy();
      expect(screen.queryByTestId('quiz-hero-empty')).toBeNull();
      // The hero image (no slot testID) renders the LAST found pick.
      const heroImage = screen
        .UNSAFE_getAllByType(ExpoImage)
        .find((node) => node.props.source?.uri === picks[2] && !node.props.testID);
      expect(heroImage).toBeTruthy();
    });

    it('renders a neutral navy field before any photo is found - no fake imagery', async () => {
      await startHeld();
      emitProgress({ step: 'checking', current: 0, total: 10, pickUris: [] });

      expect(screen.getByTestId('quiz-hero-empty')).toBeTruthy();
      expect(screen.queryByTestId('quiz-working-hero')).toBeNull();
      expect(screen.queryByTestId('quiz-slot-photo-0')).toBeNull();
      expect(screen.getByText('0 of 10')).toBeTruthy();
    });

    it('keeps thumbnails through the upload stage and names the upload', async () => {
      await startHeld();
      emitProgress({ step: 'checking', current: 3, total: 10, pickUris: picks });
      emitProgress({ step: 'building', current: 1, total: 3, pickUris: picks });

      expect(
        screen.getByText(SCAN_COPY.quiz.workingStatus('building', { isFirstScan: false }))
      ).toBeTruthy();
      // The counter reads FOUND photos, so it does not restart at the
      // handover: the hunt is over and every slot is filled.
      expect(screen.getByText('3 of 3')).toBeTruthy();
      expect(screen.getByTestId('quiz-slot-photo-0').props.source.uri).toBe(picks[0]);
      expect(screen.getByTestId('quiz-slot-photo-2').props.source.uri).toBe(picks[2]);
      // The final pick list is the whole grid now - no pending placeholders.
      expect(screen.queryByTestId('quiz-slot-empty-3')).toBeNull();
    });

    it('never takes back a photo it has already shown (the handover reset)', async () => {
      // The reported bug: the grid filled almost completely, then swapped in
      // a different, smaller set and restarted the counter. The service now
      // guarantees an append-only list; this is the screen's half of it.
      await startHeld();
      emitProgress({ step: 'checking', current: 2, total: 10, pickUris: picks.slice(0, 2) });
      expect(screen.getByTestId('quiz-slot-photo-0').props.source.uri).toBe(picks[0]);
      expect(screen.getByTestId('quiz-slot-photo-1').props.source.uri).toBe(picks[1]);
      expect(screen.getByText('2 of 10')).toBeTruthy();

      emitProgress({ step: 'checking', current: 3, total: 10, pickUris: picks });
      emitProgress({ step: 'building', current: 0, total: 3, pickUris: picks });

      // Same photos, same slots, across the handover - and the counter has
      // not gone backwards.
      expect(screen.getByTestId('quiz-slot-photo-0').props.source.uri).toBe(picks[0]);
      expect(screen.getByTestId('quiz-slot-photo-1').props.source.uri).toBe(picks[1]);
      expect(screen.getByTestId('quiz-slot-photo-2').props.source.uri).toBe(picks[2]);
      expect(screen.getByText('3 of 3')).toBeTruthy();
      expect(screen.queryByText('0 of 3')).toBeNull();
    });

    it('keeps the way out live during the build', async () => {
      // The title bar's close IS the cancel: mid-build it aborts the run
      // (the draft stays resumable) instead of leaving it classifying behind
      // a screen the user has left.
      await startHeld();
      emitProgress({ step: 'checking', current: 2, total: 10, pickUris: picks.slice(0, 2) });

      fireEvent.press(screen.getByTestId('quiz-creation-top-bar-close'));
      expect(mockNavigation.goBack).toHaveBeenCalled();
    });
  });

  it('renders resume/abandon on an interrupted upload', async () => {
    mockOutcome = { status: 'interrupted', quizId: 'quiz-1', uploadedCount: 2, totalCount: 6 };

    await renderScreen();
    await startFromIntro();

    await waitFor(() => expect(screen.getByTestId('quiz-interrupted')).toBeTruthy());
    expect(screen.getByText(/2 of 6 photos/)).toBeTruthy();
    expect(screen.getByText('Resume')).toBeTruthy();

    // Abandon leaves via goBack (the resumable draft stays persisted).
    fireEvent.press(screen.getByText('Finish Later'));
    expect(mockNavigation.goBack).toHaveBeenCalled();
  });

  it('shows the last found photo (not the poster) as the interrupted hero', async () => {
    const picks = [
      'file:///photos/pick-0.jpg',
      'file:///photos/pick-1.jpg',
      'file:///photos/pick-2.jpg',
    ];
    // The service emits progress carrying the pick uris before the upload is
    // cut short, so the interrupted screen has real photos in hand.
    mockProgressBeforeOutcome = [{ step: 'building', current: 1, total: 3, pickUris: picks }];
    mockOutcome = { status: 'interrupted', quizId: 'quiz-1', uploadedCount: 1, totalCount: 3 };

    await renderScreen();
    await startFromIntro();

    await waitFor(() => expect(screen.getByTestId('quiz-interrupted')).toBeTruthy());
    // The hero renders the LAST found pick, so the poster/neutral fallbacks
    // never appear once real photos are known.
    const heroImage = screen
      .UNSAFE_getAllByType(ExpoImage)
      .find((node) => node.props.source?.uri === picks[2] && !node.props.testID);
    expect(heroImage).toBeTruthy();
    expect(screen.queryByTestId('quiz-hero-empty')).toBeNull();
  });
});
