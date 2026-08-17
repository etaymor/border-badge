/**
 * Tests for QuizCreationScreen state rendering (the Q5 wizard).
 *
 * Covers the U4 screen-state requirements plus the wizard behaviors:
 * - permission denied renders the explanatory state with a Settings link
 * - the intro step is freshness-aware: a fresh cache promises no scan and
 *   the initial step list skips it; a stale cache announces the check
 * - a picks-bearing draft pre-flights straight to the resume confirm
 * - limited photo access renders the "allow more photos" branch on a thin
 *   decline, distinct from the genuinely-thin-library guidance
 * - classifier/service failure renders a Retry branch, DISTINCT from the
 *   thin-library decline
 * - interrupted upload renders resume/abandon
 * - success navigates toward owner play (QuizPlay seam)
 * - the working phase renders the live build: hero of the latest find, the
 *   serif found-counter, the slot grid (photos + neutral placeholders), the
 *   privacy line, and the upload stage keeps every thumbnail visible
 */

import { act, fireEvent, render, screen, waitFor } from '../utils/testUtils';
import { createMockNavigation } from '../utils/mockFactories';

import { Image as ExpoImage } from 'expo-image';
import { QuizCreationScreen } from '@screens/quiz/QuizCreationScreen';
import type { QuizCreationOutcome, QuizCreationProgress } from '@services/quiz/quizCreation';
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
let capturedOnProgress: ((update: QuizCreationProgress) => void) | undefined;
const mockMutate = jest.fn(
  (
    options: { onProgress?: (update: QuizCreationProgress) => void },
    callbacks?: { onSuccess?: (outcome: QuizCreationOutcome) => void; onError?: () => void }
  ) => {
    capturedOnProgress = options?.onProgress;
    if (mockHoldWorking) return;
    callbacks?.onSuccess?.(mockOutcome);
  }
);

function emitProgress(update: QuizCreationProgress) {
  act(() => {
    capturedOnProgress?.(update);
  });
}
jest.mock('@hooks/useQuizzes', () => ({
  useCreateQuiz: () => ({ mutate: mockMutate, isPending: false }),
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
    capturedOnProgress = undefined;
    mockLoadDraftState.mockResolvedValue(null);
    mockGetLibraryFreshness.mockResolvedValue(freshFreshness());
  });

  it('renders the explanatory denied state with a Settings link when permission is denied', async () => {
    mockPermission.status = 'denied';

    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-permission-denied')).toBeTruthy());
    expect(screen.getByText('Open Settings')).toBeTruthy();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('renders the permission request state when undetermined', async () => {
    mockPermission.status = 'undetermined';

    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-permission-request')).toBeTruthy());
    expect(screen.getByText('Allow Photo Access')).toBeTruthy();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('confirms on the intro step before creating; no auto-start (Q5)', async () => {
    await renderScreen();

    // The wizard never fires the creation without the user's confirm.
    await waitFor(() => expect(screen.getByTestId('quiz-intro-step')).toBeTruthy());
    expect(mockMutate).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('quiz-build-start'));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
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

  it('pre-flights a picks-bearing draft straight to the resume confirm (Q5)', async () => {
    mockLoadDraftState.mockResolvedValue({
      quizId: 'quiz-1',
      createdAt: 1,
      picks: [
        { assetId: 'a', uploaded: true },
        { assetId: 'b', uploaded: false },
        { assetId: 'c', uploaded: false },
      ],
    });

    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-resume-draft')).toBeTruthy());
    expect(screen.getByText(/1 of 3 photos already made it up/)).toBeTruthy();
    expect(mockMutate).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('quiz-resume-start'));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
  });

  it('renders thin-library guidance naming what is needed (AE2)', async () => {
    mockOutcome = { status: 'thin-library', eligibleCount: 3, hasGeoCandidates: true };

    await renderScreen();
    await startFromIntro();

    await waitFor(() => expect(screen.getByTestId('quiz-thin-library')).toBeTruthy());
    expect(screen.getByText(/geotagged, outdoors/)).toBeTruthy();
    expect(screen.getByText('Try Again')).toBeTruthy();
  });

  it('renders the distinct "allow more photos" branch for limited access', async () => {
    mockPermission.status = 'limited';
    mockOutcome = { status: 'thin-library', eligibleCount: 2, hasGeoCandidates: true };

    await renderScreen();
    await startFromIntro();

    await waitFor(() => expect(screen.getByTestId('quiz-thin-limited')).toBeTruthy());
    expect(screen.getByText('Allow More Photos')).toBeTruthy();
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
    expect(mockMutate).toHaveBeenCalledTimes(2);
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
      expect(screen.getByText('Finding your travel photos')).toBeTruthy();
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

      expect(
        screen.getByText('Your photos stay private until you share the challenge.')
      ).toBeTruthy();
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

    it('keeps thumbnails through the upload stage and says Building your challenge', async () => {
      await startHeld();
      emitProgress({ step: 'checking', current: 3, total: 10, pickUris: picks });
      emitProgress({ step: 'building', current: 1, total: 3, pickUris: picks });

      expect(screen.getByText('Building your challenge')).toBeTruthy();
      expect(screen.getByText('1 of 3')).toBeTruthy();
      expect(screen.getByTestId('quiz-slot-photo-0').props.source.uri).toBe(picks[0]);
      expect(screen.getByTestId('quiz-slot-photo-2').props.source.uri).toBe(picks[2]);
      // The final pick list is the whole grid now - no pending placeholders.
      expect(screen.queryByTestId('quiz-slot-empty-3')).toBeNull();
    });

    it('keeps the cancel affordance live during the build', async () => {
      await startHeld();
      emitProgress({ step: 'checking', current: 2, total: 10, pickUris: picks.slice(0, 2) });

      fireEvent.press(screen.getByText('Cancel'));
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
});
