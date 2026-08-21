/**
 * useFirstQuizLaunch - where the post-onboarding accept actually lands.
 *
 * The offer's accept goes straight to QuizCreation even on a brand-new device
 * with a cold photo cache. Routing it through PhotoImport first was tried and
 * reverted: quizCreation.ts already calls ensureFreshLibrary and reports a
 * `scanning` step, so the wizard owns that first scan, while the detour ended
 * on the photo-trips screen having produced no challenge at all.
 *
 * The offer's own contract (arming, clearing, signOut) lives in
 * screens/FirstQuizOffer.test.tsx; this guards only the destination.
 */

import { act, waitFor } from '../utils/testUtils';
import { renderHook } from '@testing-library/react-native';

import { useFirstQuizLaunch } from '@hooks/useFirstQuizLaunch';
import { useAuthStore } from '@stores/authStore';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const mockGetLastImportTime = jest.fn();
jest.mock('@services/photoImport/photoCacheDb', () => ({
  getLastImportTime: (...args: unknown[]) => mockGetLastImportTime(...args),
}));

describe('useFirstQuizLaunch destination', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ pendingFirstQuizLaunch: false });
  });

  it('goes to QuizCreation without consulting the photo cache', async () => {
    act(() => {
      useAuthStore.getState().setPendingFirstQuizLaunch(true);
    });
    renderHook(() => useFirstQuizLaunch());

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('QuizCreation', {
        entryPoint: 'onboarding_first_quiz',
      });
    });
    // The wizard owns the first scan; the launch must not branch on the
    // watermark and strand the user in the import flow.
    expect(mockGetLastImportTime).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });
});
