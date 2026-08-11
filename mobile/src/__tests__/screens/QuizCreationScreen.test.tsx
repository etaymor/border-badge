/**
 * Tests for QuizCreationScreen state rendering.
 *
 * Covers the U4 screen-state requirements:
 * - permission denied renders the explanatory state with a Settings link
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

const mockNavigation =
  createMockNavigation() as unknown as RootStackScreenProps<'QuizCreation'>['navigation'];
const mockRoute = {
  key: 'test',
  name: 'QuizCreation',
} as RootStackScreenProps<'QuizCreation'>['route'];

function renderScreen() {
  return render(<QuizCreationScreen navigation={mockNavigation} route={mockRoute} />);
}

describe('QuizCreationScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPermission.status = 'granted';
    mockPermission.isLoading = false;
    mockOutcome = { status: 'created', quizId: 'quiz-1', photoCount: 6 };
  });

  it('renders the explanatory denied state with a Settings link when permission is denied', () => {
    mockPermission.status = 'denied';

    renderScreen();

    expect(screen.getByTestId('quiz-permission-denied')).toBeTruthy();
    expect(screen.getByText('Open Settings')).toBeTruthy();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('renders the permission request state when undetermined', () => {
    mockPermission.status = 'undetermined';

    renderScreen();

    expect(screen.getByTestId('quiz-permission-request')).toBeTruthy();
    expect(screen.getByText('Allow Photo Access')).toBeTruthy();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('starts creation automatically when permission is granted and navigates to QuizPlay on success', async () => {
    renderScreen();

    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('QuizPlay', { quizId: 'quiz-1' });
  });

  it('renders thin-library guidance naming what is needed (AE2)', async () => {
    mockOutcome = { status: 'thin-library', eligibleCount: 3, hasGeoCandidates: true };

    renderScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-thin-library')).toBeTruthy());
    expect(screen.getByText(/geotagged, outdoors/)).toBeTruthy();
    expect(screen.getByText('Try Again')).toBeTruthy();
  });

  it('renders the distinct "allow more photos" branch for limited access', async () => {
    mockPermission.status = 'limited';
    mockOutcome = { status: 'thin-library', eligibleCount: 2, hasGeoCandidates: true };

    renderScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-thin-limited')).toBeTruthy());
    expect(screen.getByText('Allow More Photos')).toBeTruthy();
    expect(screen.queryByTestId('quiz-thin-library')).toBeNull();
  });

  it('renders a retry branch on service failure, distinct from the thin-library decline', async () => {
    mockOutcome = { status: 'service-error', stage: 'classify' };

    renderScreen();

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

    renderScreen();

    await waitFor(() => expect(screen.getByTestId('quiz-interrupted')).toBeTruthy());
    expect(screen.getByText(/2 of 6 photos/)).toBeTruthy();
    expect(screen.getByText('Resume')).toBeTruthy();

    // Abandon leaves via goBack (the resumable draft stays persisted).
    fireEvent.press(screen.getByText('Finish Later'));
    expect(mockNavigation.goBack).toHaveBeenCalled();
  });
});
