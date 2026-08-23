/**
 * Tests for PersistentScanBanner state matrix and visibility gating.
 *
 * The banner renders a thin progress bar (no text labels). Tests inspect the
 * accessibility label and exercise tap handling on the touch target.
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

import { PersistentScanBanner } from '../../../components/photos/PersistentScanBanner';
import {
  patchJobSlice,
  resetLibraryJobStore,
  useLibraryJobStore,
} from '../../../stores/libraryJobStore';
import {
  publishContinuationLease,
  resetContinuationLeaseStore,
} from '../../../stores/continuationLeaseStore';
import { SCAN_COPY } from '../../../constants/scanCopy';

let mockFocusedLeaf: string | undefined = 'Passport';
const mockNavigate = jest.fn();

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, top: 0, left: 0, right: 0 }),
}));

jest.mock('@services/photoImport', () => ({
  consumeResult: jest.fn(),
}));

const photoImportMock = jest.requireMock('@services/photoImport');
// Banner only calls navigation.navigate; cast a stripped-down stub through
// `unknown as` to satisfy the typed prop without re-implementing the full
// BottomTabBarProps['navigation'] surface.
const stubNavigation = {
  navigate: mockNavigate,
  getParent: () => ({ navigate: mockNavigate }),
} as unknown as BottomTabBarProps['navigation'];
const renderBanner = () =>
  render(<PersistentScanBanner focusedLeaf={mockFocusedLeaf} navigation={stubNavigation} />);

beforeEach(() => {
  jest.clearAllMocks();
  resetLibraryJobStore();
  resetContinuationLeaseStore();
  mockFocusedLeaf = 'Passport';
});

describe('PersistentScanBanner tier-gated leave hint', () => {
  const leased = SCAN_COPY.shared.leaveHintWhileLeased('trip-scan');

  it('shows the hint only while the lease is running on the continued tier', () => {
    patchJobSlice('trip-scan', {
      phase: 'running',
      progress: { phase: 'scanning', current: 1, total: 10, percentage: 10 },
    });
    publishContinuationLease({ phase: 'running', tier: 'continued', kind: 'trip-scan' });
    const { getByLabelText } = renderBanner();
    expect(getByLabelText('Photo scan in progress, 10%').props.accessibilityHint).toContain(leased);
  });

  it.each([
    ['idle', 'none'],
    ['pending', 'continued'],
    ['expired', 'continued'],
    ['running', 'grace'],
  ] as const)("shows today's copy when the lease is %s/%s", (phase, tier) => {
    patchJobSlice('trip-scan', {
      phase: 'running',
      progress: { phase: 'scanning', current: 1, total: 10, percentage: 10 },
    });
    publishContinuationLease({ phase, tier, kind: 'trip-scan' });
    const { getByLabelText } = renderBanner();
    const hint = getByLabelText('Photo scan in progress, 10%').props.accessibilityHint as string;
    expect(hint).toBe(SCAN_COPY.banner.hint('trip-scan', 'running'));
    expect(hint).not.toContain(leased);
  });

  it('never decorates a waiting job, even with a lease running for its peer', () => {
    patchJobSlice('quiz-build', { phase: 'waiting' });
    publishContinuationLease({ phase: 'running', tier: 'continued', kind: 'trip-scan' });
    const { getByLabelText } = renderBanner();
    const hint = getByLabelText('Guess Where challenge queued behind your photo scan').props
      .accessibilityHint as string;
    expect(hint).not.toContain('keeps going');
  });
});

describe('PersistentScanBanner visibility', () => {
  it('renders nothing when phase is idle', () => {
    const tree = renderBanner();
    expect(tree.toJSON()).toBeNull();
  });

  it('renders nothing when focused leaf is in HIDDEN_TAB_BAR_SCREENS even while scanning', () => {
    patchJobSlice('trip-scan', { phase: 'running' });
    mockFocusedLeaf = 'PhotoImport';
    const tree = renderBanner();
    expect(tree.toJSON()).toBeNull();
  });

  it.each(['ShareCapture', 'EntryForm', 'TripForm'])('hides on hidden screen %s', (screen) => {
    patchJobSlice('trip-scan', { phase: 'running' });
    mockFocusedLeaf = screen;
    const tree = renderBanner();
    expect(tree.toJSON()).toBeNull();
  });
});

describe('PersistentScanBanner state matrix', () => {
  it('uses "starting" accessibility label at 0% progress', () => {
    patchJobSlice('trip-scan', {
      phase: 'running',
      progress: { phase: 'counting', current: 0, total: 0, percentage: 0 },
    });
    const { getByLabelText } = renderBanner();
    expect(getByLabelText('Photo scan starting')).toBeTruthy();
  });

  it('shows percentage in accessibility label when progress > 0', () => {
    patchJobSlice('trip-scan', {
      phase: 'running',
      progress: { phase: 'scanning', current: 50, total: 100, percentage: 50 },
    });
    const { getByLabelText } = renderBanner();
    expect(getByLabelText('Photo scan in progress, 50%')).toBeTruthy();
  });

  it('navigates to PhotoImport when tapped during scanning', () => {
    patchJobSlice('trip-scan', {
      phase: 'running',
      progress: { phase: 'scanning', current: 50, total: 100, percentage: 50 },
    });
    const { getByLabelText } = renderBanner();
    fireEvent.press(getByLabelText('Photo scan in progress, 50%'));
    expect(mockNavigate).toHaveBeenCalledWith('Passport', { screen: 'PhotoImport' });
  });

  it('shows completed bar and navigates to PhotoImport on tap', () => {
    patchJobSlice('trip-scan', { phase: 'completed', hasResult: true });
    const { getByLabelText } = renderBanner();
    fireEvent.press(getByLabelText('Photo scan complete'));
    expect(mockNavigate).toHaveBeenCalledWith('Passport', { screen: 'PhotoImport' });
  });

  it('shows retry-style bar on recoverable failure and navigates to PhotoImport on tap', () => {
    patchJobSlice('trip-scan', {
      phase: 'failed',
      failure: { reason: 'stuck', title: 't', message: 'm' },
    });
    const { getByLabelText } = renderBanner();
    fireEvent.press(getByLabelText('Photo scan stopped'));
    expect(mockNavigate).toHaveBeenCalledWith('Passport', { screen: 'PhotoImport' });
  });

  it('shows no-trips bar that routes to PhotoImport for the existing alert', () => {
    patchJobSlice('trip-scan', {
      phase: 'failed',
      failure: { reason: 'no-trips', title: 't', message: 'm' },
    });
    const { getByLabelText } = renderBanner();
    fireEvent.press(getByLabelText('No travel photos found'));
    expect(mockNavigate).toHaveBeenCalledWith('Passport', { screen: 'PhotoImport' });
  });
});

describe('PersistentScanBanner auto-dismiss', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('auto-dismisses 30s after entering completed state', () => {
    patchJobSlice('trip-scan', { phase: 'completed', hasResult: true });
    renderBanner();

    act(() => {
      jest.advanceTimersByTime(30_001);
    });

    expect(useLibraryJobStore.getState().jobs['trip-scan'].phase).toBe('idle');
    expect(photoImportMock.consumeResult).toHaveBeenCalled();
  });
});

describe('PersistentScanBanner quiz-build job', () => {
  it('announces the challenge build, not a photo scan', () => {
    patchJobSlice('quiz-build', {
      phase: 'running',
      progress: { current: 4, total: 10, percentage: 40, phase: 'checking' },
    });

    const { getByLabelText } = renderBanner();
    // "Photo scan complete" would send the user looking for trips; the label
    // has to name the job that is actually running.
    expect(getByLabelText('Building your Guess Where challenge, 40 percent')).toBeTruthy();
  });

  it('rounds the announced percentage to 10% steps to avoid spamming VoiceOver', () => {
    patchJobSlice('quiz-build', {
      phase: 'running',
      progress: { current: 4, total: 10, percentage: 44, phase: 'checking' },
    });

    const { getByLabelText } = renderBanner();
    expect(getByLabelText('Building your Guess Where challenge, 40 percent')).toBeTruthy();
  });

  it('explains a queued build rather than showing a stalled bar', () => {
    patchJobSlice('quiz-build', { phase: 'waiting', progress: null });

    const { getByLabelText } = renderBanner();
    expect(getByLabelText('Guess Where challenge queued behind your photo scan')).toBeTruthy();
  });

  it('routes a finished challenge to QuizPlay via the root navigator', () => {
    patchJobSlice('quiz-build', {
      phase: 'completed',
      hasResult: true,
      resultRoute: { screen: 'QuizPlay', params: { quizId: 'quiz-9' } },
    });

    const { getByLabelText } = renderBanner();
    fireEvent.press(getByLabelText('Your challenge is ready'));
    expect(mockNavigate).toHaveBeenCalledWith('QuizPlay', { quizId: 'quiz-9' });
  });

  it('routes a running build back to the wizard, tagged as a banner return', () => {
    patchJobSlice('quiz-build', {
      phase: 'running',
      progress: { current: 1, total: 10, percentage: 10, phase: 'checking' },
    });

    const { getByLabelText } = renderBanner();
    fireEvent.press(getByLabelText('Building your Guess Where challenge, 10 percent'));
    expect(mockNavigate).toHaveBeenCalledWith('QuizCreation', { entryPoint: 'scan_banner' });
  });

  it('lets a running trip scan keep the bar over a finished challenge', () => {
    patchJobSlice('trip-scan', { phase: 'running', progress: { percentage: 50 } });
    patchJobSlice('quiz-build', { phase: 'completed', hasResult: true });

    const { getByLabelText } = renderBanner();
    // A running job always outranks a terminal one; the finished challenge is
    // not lost, it just waits for the bar.
    expect(getByLabelText('Photo scan in progress, 50%')).toBeTruthy();
  });

  it('NEVER discards a finished challenge when the bar auto-dismisses', () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    patchJobSlice('quiz-build', {
      phase: 'completed',
      hasResult: true,
      resultRoute: { screen: 'QuizPlay', params: { quizId: 'quiz-9' } },
    });

    renderBanner();
    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    // consumeResult is the trip scan's disposal path. Running it for a quiz
    // build would throw away a built challenge after a green flash.
    expect(photoImportMock.consumeResult).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
