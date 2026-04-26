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
import { resetPhotoScanStore, usePhotoScanStore } from '../../../stores/photoScanStore';

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
const stubNavigation = { navigate: mockNavigate } as unknown as BottomTabBarProps['navigation'];
const renderBanner = () =>
  render(<PersistentScanBanner focusedLeaf={mockFocusedLeaf} navigation={stubNavigation} />);

beforeEach(() => {
  jest.clearAllMocks();
  resetPhotoScanStore();
  mockFocusedLeaf = 'Passport';
});

describe('PersistentScanBanner visibility', () => {
  it('renders nothing when phase is idle', () => {
    const tree = renderBanner();
    expect(tree.toJSON()).toBeNull();
  });

  it('renders nothing when focused leaf is in HIDDEN_TAB_BAR_SCREENS even while scanning', () => {
    usePhotoScanStore.setState({ phase: 'scanning' });
    mockFocusedLeaf = 'PhotoImport';
    const tree = renderBanner();
    expect(tree.toJSON()).toBeNull();
  });

  it.each(['ShareCapture', 'EntryForm', 'TripForm'])('hides on hidden screen %s', (screen) => {
    usePhotoScanStore.setState({ phase: 'scanning' });
    mockFocusedLeaf = screen;
    const tree = renderBanner();
    expect(tree.toJSON()).toBeNull();
  });
});

describe('PersistentScanBanner state matrix', () => {
  it('uses "starting" accessibility label at 0% progress', () => {
    usePhotoScanStore.setState({
      phase: 'scanning',
      progress: { phase: 'counting', current: 0, total: 0, percentage: 0 },
    });
    const { getByLabelText } = renderBanner();
    expect(getByLabelText('Photo scan starting, tap for details')).toBeTruthy();
  });

  it('shows percentage in accessibility label when progress > 0', () => {
    usePhotoScanStore.setState({
      phase: 'scanning',
      progress: { phase: 'scanning', current: 50, total: 100, percentage: 50 },
    });
    const { getByLabelText } = renderBanner();
    expect(getByLabelText('Photo scan in progress, 50%, tap for details')).toBeTruthy();
  });

  it('navigates to PhotoImport when tapped during scanning', () => {
    usePhotoScanStore.setState({
      phase: 'scanning',
      progress: { phase: 'scanning', current: 50, total: 100, percentage: 50 },
    });
    const { getByLabelText } = renderBanner();
    fireEvent.press(getByLabelText('Photo scan in progress, 50%, tap for details'));
    expect(mockNavigate).toHaveBeenCalledWith('Passport', { screen: 'PhotoImport' });
  });

  it('shows completed bar and navigates to PhotoImport on tap', () => {
    usePhotoScanStore.setState({ phase: 'completed', hasResult: true });
    const { getByLabelText } = renderBanner();
    fireEvent.press(getByLabelText('Photo scan complete, tap to continue'));
    expect(mockNavigate).toHaveBeenCalledWith('Passport', { screen: 'PhotoImport' });
  });

  it('shows retry-style bar on recoverable failure and navigates to PhotoImport on tap', () => {
    usePhotoScanStore.setState({
      phase: 'failed',
      scanFailure: { reason: 'stuck', title: 't', message: 'm' },
    });
    const { getByLabelText } = renderBanner();
    fireEvent.press(getByLabelText('Photo scan stopped, tap to retry'));
    expect(mockNavigate).toHaveBeenCalledWith('Passport', { screen: 'PhotoImport' });
  });

  it('shows no-trips bar that routes to PhotoImport for the existing alert', () => {
    usePhotoScanStore.setState({
      phase: 'failed',
      scanFailure: { reason: 'no-trips', title: 't', message: 'm' },
    });
    const { getByLabelText } = renderBanner();
    fireEvent.press(getByLabelText('No travel photos found, tap for details'));
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
    usePhotoScanStore.setState({ phase: 'completed', hasResult: true });
    renderBanner();

    act(() => {
      jest.advanceTimersByTime(30_001);
    });

    expect(usePhotoScanStore.getState().phase).toBe('idle');
    expect(photoImportMock.consumeResult).toHaveBeenCalled();
  });
});
