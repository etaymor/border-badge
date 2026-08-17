/**
 * Tests for ShareCardOverlay share payload (U7).
 *
 * The share sheet must receive both the captured card image AND a profile
 * link carrying ?ref= attribution.
 */

import { fireEvent, render, screen, waitFor } from '../utils/testUtils';
import * as ShareModule from '@utils/share';

const CAPTURED_URI = 'file://captured-card.png';

// ViewShot: render children, expose capture() via ref.
jest.mock('react-native-view-shot', () => {
  const React = jest.requireActual('react');
  const MockViewShot = React.forwardRef(
    (props: { children?: React.ReactNode }, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({
        capture: () => Promise.resolve('file://captured-card.png'),
      }));
      return props.children ?? null;
    }
  );
  MockViewShot.displayName = 'MockViewShot';
  return { __esModule: true, default: MockViewShot };
});

// The card itself is covered by ShareCard.test; keep this test focused.
jest.mock('@components/share/ShareCard', () => ({
  ShareCard: () => null,
  SHARE_CARD_WIDTH: 1080,
  SHARE_CARD_HEIGHT: 1920,
}));

jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  saveToLibraryAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@services/analytics', () => ({
  Analytics: {
    shareMilestone: jest.fn(),
  },
}));

jest.mock('@hooks/useProfile', () => ({
  useProfile: jest.fn(() => ({ data: { username: 'alex' } })),
}));

import { ShareCardOverlay } from '@components/share/ShareCardOverlay';
import { useProfile } from '@hooks/useProfile';
import type { MilestoneContext } from '@utils/milestones';

const context: MilestoneContext = {
  countryCode: 'JP',
  countryName: 'Japan',
  countryRegion: 'Asia',
  countrySubregion: 'East Asia',
  newTotalCount: 5,
  milestones: [],
};

describe('ShareCardOverlay share payload', () => {
  const originalWebBaseUrl = process.env.EXPO_PUBLIC_WEB_BASE_URL;
  let shareSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_WEB_BASE_URL = 'https://atlasi.app';
    shareSpy = jest
      .spyOn(ShareModule.Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as never);
    (useProfile as jest.Mock).mockReturnValue({ data: { username: 'alex' } });
  });

  afterEach(() => {
    shareSpy.mockRestore();
    process.env.EXPO_PUBLIC_WEB_BASE_URL = originalWebBaseUrl;
  });

  it('shares the card image together with a ref-attributed profile link', async () => {
    render(<ShareCardOverlay visible context={context} onDismiss={jest.fn()} />);

    fireEvent.press(screen.getByLabelText('Share card'));

    await waitFor(() => expect(shareSpy).toHaveBeenCalledTimes(1));
    expect(shareSpy).toHaveBeenCalledWith({
      url: CAPTURED_URI,
      message: expect.stringContaining('https://atlasi.app/u/alex?ref=alex'),
    });
  });

  it('falls back to image-only sharing when no username is available', async () => {
    (useProfile as jest.Mock).mockReturnValue({ data: undefined });

    render(<ShareCardOverlay visible context={context} onDismiss={jest.fn()} />);

    fireEvent.press(screen.getByLabelText('Share card'));

    await waitFor(() => expect(shareSpy).toHaveBeenCalledTimes(1));
    expect(shareSpy).toHaveBeenCalledWith({ url: CAPTURED_URI });
  });
});
