/**
 * Tests for PersistentScanBanner state matrix and visibility gating.
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

import { PersistentScanBanner } from '../../../components/photos/PersistentScanBanner';
import { resetPhotoScanStore, usePhotoScanStore } from '../../../stores/photoScanStore';

let mockFocusedLeaf: string | undefined = 'Passport';
const mockNavigate = jest.fn();

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, top: 0, left: 0, right: 0 }),
}));

jest.mock('@services/photoImport', () => ({
  cancelScan: jest.fn(),
  consumeResult: jest.fn(),
  startScan: jest.fn().mockResolvedValue({ status: 'started' }),
}));

jest.mock('@stores/onboardingStore', () => ({
  useOnboardingStore: jest.fn(() => 'US'),
  selectHomeCountry: jest.fn(),
}));

const photoImportMock = jest.requireMock('@services/photoImport');
const renderBanner = () =>
  render(
    <PersistentScanBanner focusedLeaf={mockFocusedLeaf} navigation={{ navigate: mockNavigate }} />
  );

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
  it('shows "Starting scan…" with no number at 0% progress', () => {
    usePhotoScanStore.setState({
      phase: 'scanning',
      progress: { phase: 'counting', current: 0, total: 0, percentage: 0 },
    });
    const { getByText } = renderBanner();
    expect(getByText('Starting scan…')).toBeTruthy();
  });

  it('shows percentage when progress > 0', () => {
    usePhotoScanStore.setState({
      phase: 'scanning',
      progress: { phase: 'scanning', current: 50, total: 100, percentage: 50 },
    });
    const { getByText } = renderBanner();
    expect(getByText('Scanning photos · 50%')).toBeTruthy();
  });

  it('shows completed message and navigates to PhotoImport on tap', () => {
    usePhotoScanStore.setState({ phase: 'completed', hasResult: true });
    const { getByText } = renderBanner();
    const node = getByText('Scan complete — tap to continue');
    fireEvent.press(node);
    expect(mockNavigate).toHaveBeenCalledWith('Passport', { screen: 'PhotoImport' });
  });

  it('shows retry banner on recoverable failure and calls startScan on tap', () => {
    usePhotoScanStore.setState({
      phase: 'failed',
      scanFailure: { reason: 'stuck', title: 't', message: 'm' },
    });
    const { getByText } = renderBanner();
    const node = getByText('Scan stopped — tap to retry');
    fireEvent.press(node);
    expect(photoImportMock.startScan).toHaveBeenCalled();
  });

  it('shows no-trips banner that routes to PhotoImport for the existing alert', () => {
    usePhotoScanStore.setState({
      phase: 'failed',
      scanFailure: { reason: 'no-trips', title: 't', message: 'm' },
    });
    const { getByText } = renderBanner();
    const node = getByText('No travel photos found — tap for details');
    fireEvent.press(node);
    expect(mockNavigate).toHaveBeenCalledWith('Passport', { screen: 'PhotoImport' });
  });

  it('cancel from banner calls service cancel via confirmCancelScan helper', () => {
    usePhotoScanStore.setState({
      phase: 'scanning',
      progress: { phase: 'scanning', current: 50, total: 100, percentage: 50 },
    });
    const { getByText } = renderBanner();
    const cancelBtn = getByText('Cancel');
    fireEvent.press(cancelBtn);
    expect(photoImportMock.cancelScan).toHaveBeenCalled();
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
