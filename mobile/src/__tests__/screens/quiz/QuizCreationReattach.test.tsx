/**
 * Tests for the durable-job behavior of QuizCreationScreen.
 *
 * The screen used to OWN the build: it fired a mutation and its unmount effect
 * aborted the controller, so navigating away destroyed up to 90 seconds of
 * hunting and up to 300 classified images. It is now a VIEW onto the
 * `quiz-build` job. These tests pin the two properties that difference buys:
 *
 *   1. leaving the screen does not stop the build
 *   2. coming back attaches to the run in progress, with the slots already
 *      found, instead of restarting from an empty grid
 */

import { render, screen, waitFor } from '../../utils/testUtils';
import { createMockNavigation } from '../../utils/mockFactories';

import { QuizCreationScreen } from '@screens/quiz/QuizCreationScreen';
import { patchJobSlice, resetLibraryJobStore } from '@stores/libraryJobStore';
import type { QuizCreationOutcome } from '@services/quiz/quizCreation';
import type { RootStackScreenProps } from '@navigation/types';

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

jest.mock('@hooks/usePhotoPermissions', () => ({
  usePhotoPermissionStatus: () => ({
    status: 'granted',
    isLoading: false,
    refresh: jest.fn(),
    requestPermission: jest.fn(),
  }),
}));

const mockStart = jest.fn();
const mockCancel = jest.fn();
jest.mock('@hooks/useQuizBuildJob', () => ({
  useQuizBuildJob: (_opts: { onOutcome: (o: QuizCreationOutcome) => void }) => ({
    phase: 'idle',
    percentage: null,
    detail: { step: 'scanning', pickUris: [], examined: 0 },
    isActive: false,
    isWaiting: false,
    start: mockStart,
    cancel: mockCancel,
  }),
}));

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
  key: 'k',
  name: 'QuizCreation',
  params: {},
} as RootStackScreenProps<'QuizCreation'>['route'];

/** Put the job store into the state a build in progress would leave it in. */
function seedRunningBuild(pickUris: string[], examined = 4500) {
  patchJobSlice('quiz-build', {
    phase: 'running',
    progress: {
      current: pickUris.length,
      total: 10,
      percentage: Math.round((pickUris.length / 10) * 100),
      phase: 'checking',
    },
    detail: { step: 'checking', pickUris, examined },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetLibraryJobStore();
  mockLoadDraftState.mockResolvedValue(null);
  mockGetLibraryFreshness.mockResolvedValue({
    fresh: true,
    reason: 'fresh',
    lastSuccessAt: Date.now(),
    cachedPhotoCount: 812,
    permission: 'granted',
  });
});

describe('reattaching to a build already in progress', () => {
  it('mounts straight into the working phase instead of the intro', async () => {
    seedRunningBuild(['file://a.jpg', 'file://b.jpg']);

    render(<QuizCreationScreen navigation={mockNavigation} route={mockRoute} />);

    await waitFor(() => expect(screen.getByTestId('quiz-progress')).toBeTruthy());
    // The intro CTA must NOT appear: offering "Build My Challenge" while one is
    // already running is how a user ends up starting a second run.
    expect(screen.queryByTestId('quiz-build-start')).toBeNull();
  });

  it('paints the slots already found rather than restarting from an empty grid', async () => {
    seedRunningBuild(['file://a.jpg', 'file://b.jpg', 'file://c.jpg']);

    render(<QuizCreationScreen navigation={mockNavigation} route={mockRoute} />);

    await waitFor(() => expect(screen.getByTestId('quiz-progress')).toBeTruthy());

    // A user who left at 3 finds and came back sees those exact 3 photos in
    // their original slots, with the rest still empty.
    expect(screen.getByTestId('quiz-slot-photo-0').props.source.uri).toBe('file://a.jpg');
    expect(screen.getByTestId('quiz-slot-photo-2').props.source.uri).toBe('file://c.jpg');
    expect(screen.queryByTestId('quiz-slot-photo-3')).toBeNull();
    expect(screen.getByTestId('quiz-slot-empty-3')).toBeTruthy();
    expect(screen.getByText('3 of 10')).toBeTruthy();
  });

  it('does not start a second build when attaching to a running one', async () => {
    seedRunningBuild(['file://a.jpg']);

    render(<QuizCreationScreen navigation={mockNavigation} route={mockRoute} />);

    await waitFor(() => expect(screen.getByTestId('quiz-progress')).toBeTruthy());
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('shows the working phase while queued behind a trip scan', async () => {
    patchJobSlice('quiz-build', {
      phase: 'waiting',
      progress: null,
      detail: { step: 'scanning', pickUris: [], examined: 0 },
    });

    render(<QuizCreationScreen navigation={mockNavigation} route={mockRoute} />);

    // Queued is still "we are working on it" from the user's side; the wizard
    // must not fall back to the intro and invite a duplicate start.
    await waitFor(() => expect(screen.getByTestId('quiz-progress')).toBeTruthy());
    expect(screen.queryByTestId('quiz-build-start')).toBeNull();
  });
});

describe('leaving the screen', () => {
  it('does NOT cancel the build on unmount', async () => {
    seedRunningBuild(['file://a.jpg']);

    const view = render(<QuizCreationScreen navigation={mockNavigation} route={mockRoute} />);
    await waitFor(() => expect(screen.getByTestId('quiz-progress')).toBeTruthy());

    view.unmount();

    // This is the whole point of the ownership move: an unmount used to abort
    // the AbortController and throw away every classified image.
    expect(mockCancel).not.toHaveBeenCalled();
  });
});
