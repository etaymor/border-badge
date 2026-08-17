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
 */

import { fireEvent, render, screen, waitFor } from '../utils/testUtils';
import { createMockNavigation } from '../utils/mockFactories';

import { QuizCreationScreen } from '@screens/quiz/QuizCreationScreen';
import type { QuizCreationOutcome } from '@services/quiz/quizCreation';
import type { RootStackScreenProps } from '@navigation/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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
const mockMutate = jest.fn(
  (
    _options: unknown,
    callbacks?: { onSuccess?: (outcome: QuizCreationOutcome) => void; onError?: () => void }
  ) => {
    callbacks?.onSuccess?.(mockOutcome);
  }
);
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
