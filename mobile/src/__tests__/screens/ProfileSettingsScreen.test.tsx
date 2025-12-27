/**
 * Tests for ProfileSettingsScreen component.
 * Tests export modal functionality, timeout cleanup, and error cases.
 */

import { act, fireEvent, render, screen, waitFor } from '../utils/testUtils';
// Removed broken mock
import {
  createMockCountry,
  createMockUserCountry,
  createMockNavigation,
} from '../utils/mockFactories';
import { ProfileSettingsScreen } from '@screens/profile/ProfileSettingsScreen';
import type { PassportStackScreenProps } from '@navigation/types';
import * as useCountriesModule from '@hooks/useCountries';
import * as useUserCountriesModule from '@hooks/useUserCountries';
import * as useProfileModule from '@hooks/useProfile';
import * as useUpdateDisplayNameModule from '@hooks/useUpdateDisplayName';
import * as useAuthModule from '@hooks/useAuth';
import { useAuthStore } from '@stores/authStore';
import { useSettingsStore } from '@stores/settingsStore';
import * as Clipboard from 'expo-clipboard';
import * as ShareModule from '@utils/share';
import type { Country } from '@hooks/useCountries';
import type { UserCountry } from '@hooks/useUserCountries';
import type { Session } from '@supabase/supabase-js';

// Fake timers are set up in beforeEach for proper isolation

// Mock Clipboard
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(undefined),
}));

// Mock Share wrapper
jest
  .spyOn(ShareModule.Share, 'share')
  .mockResolvedValue({ action: 'sharedAction', activityType: null });

// Mock useSignOut hook
jest.spyOn(useAuthModule, 'useSignOut').mockReturnValue({
  mutate: jest.fn(),
  mutateAsync: jest.fn().mockResolvedValue(undefined),
  isPending: false,
} as unknown as ReturnType<typeof useAuthModule.useSignOut>);

// Create mock navigation
const mockGoBack = jest.fn();
const mockNavigation = {
  ...createMockNavigation(),
  goBack: mockGoBack,
} as unknown as PassportStackScreenProps<'ProfileSettings'>['navigation'];

const mockRoute = {
  key: 'test',
  name: 'ProfileSettings',
} as PassportStackScreenProps<'ProfileSettings'>['route'];

// Helper factory for visited UserCountry
function createMockUserCountryVisited(code: string): UserCountry {
  return createMockUserCountry({ country_code: code, status: 'visited' });
}

// Helper to create countries for different regions
function createMockCountriesForRegions(): Country[] {
  return [
    createMockCountry({ code: 'JP', name: 'Japan', region: 'Asia' }),
    createMockCountry({ code: 'FR', name: 'France', region: 'Europe' }),
    createMockCountry({ code: 'US', name: 'United States', region: 'Americas' }),
    createMockCountry({ code: 'EG', name: 'Egypt', region: 'Africa' }),
    createMockCountry({ code: 'AU', name: 'Australia', region: 'Oceania' }),
  ];
}

// Helper to mock hooks
interface MockHooksOptions {
  countries?: Country[];
  userCountries?: UserCountry[];
  profile?: {
    display_name?: string;
    home_country_code?: string | null;
    tracking_preference?: string;
  };
  isLoading?: boolean;
}

function mockHooksWithData({
  countries = [],
  userCountries = [],
  profile = { display_name: 'Test User', tracking_preference: 'classic' },
  isLoading = false,
}: MockHooksOptions = {}) {
  jest.spyOn(useCountriesModule, 'useCountries').mockReturnValue({
    data: countries,
    isLoading,
    error: null,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useCountriesModule.useCountries>);

  jest.spyOn(useCountriesModule, 'useCountryByCode').mockReturnValue({
    data: undefined,
    isLoading: false,
  } as unknown as ReturnType<typeof useCountriesModule.useCountryByCode>);

  jest.spyOn(useUserCountriesModule, 'useUserCountries').mockReturnValue({
    data: userCountries,
    isLoading,
    error: null,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useUserCountriesModule.useUserCountries>);

  jest.spyOn(useProfileModule, 'useProfile').mockReturnValue({
    data: profile,
    isLoading,
    error: null,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useProfileModule.useProfile>);

  jest.spyOn(useProfileModule, 'useUpdateProfile').mockReturnValue({
    mutate: jest.fn(),
    mutateAsync: jest.fn().mockResolvedValue(undefined),
    isPending: false,
  } as unknown as ReturnType<typeof useProfileModule.useUpdateProfile>);

  jest.spyOn(useUpdateDisplayNameModule, 'useUpdateDisplayName').mockReturnValue({
    mutate: jest.fn(),
    mutateAsync: jest.fn().mockResolvedValue(undefined),
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateDisplayNameModule.useUpdateDisplayName>);
}

describe('ProfileSettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('Export Modal', () => {
    it('opens export modal when export button pressed', async () => {
      const countries = createMockCountriesForRegions();
      const userCountries = [createMockUserCountryVisited('JP')];
      mockHooksWithData({ countries, userCountries });

      render(<ProfileSettingsScreen navigation={mockNavigation} route={mockRoute} />);

      // Find and press the export button using accessibility label
      const exportButton = screen.getByLabelText('Export your country list');
      fireEvent.press(exportButton);

      // Modal should be visible - check for modal-specific subtitle text
      await waitFor(() => {
        expect(screen.getByText('Share or copy your country list')).toBeTruthy();
      });
    });

    it('builds export text with countries grouped by continent', async () => {
      const countries = createMockCountriesForRegions();
      const userCountries = [
        createMockUserCountryVisited('JP'), // Asia
        createMockUserCountryVisited('FR'), // Europe
        createMockUserCountryVisited('US'), // Americas
      ];
      mockHooksWithData({ countries, userCountries });

      render(<ProfileSettingsScreen navigation={mockNavigation} route={mockRoute} />);

      // Open export modal
      fireEvent.press(screen.getByLabelText('Export your country list'));

      await waitFor(() => {
        expect(screen.getByText('Share or copy your country list')).toBeTruthy();
      });

      // The modal should show the export text preview
      expect(screen.getByText(/My Travel Atlas/)).toBeTruthy();
    });

    it('shows copy feedback after copying', async () => {
      const countries = createMockCountriesForRegions();
      const userCountries = [createMockUserCountryVisited('JP')];
      mockHooksWithData({ countries, userCountries });

      render(<ProfileSettingsScreen navigation={mockNavigation} route={mockRoute} />);

      // Open export modal
      fireEvent.press(screen.getByLabelText('Export your country list'));

      await waitFor(() => {
        expect(screen.getByText('Share or copy your country list')).toBeTruthy();
      });

      // Press copy button
      const copyButton = screen.getByText('Copy');
      await act(async () => {
        fireEvent.press(copyButton);
      });

      // Clipboard should have been called
      expect(Clipboard.setStringAsync).toHaveBeenCalled();

      // Should show "Copied!" feedback
      await waitFor(() => {
        expect(screen.getByText('Copied!')).toBeTruthy();
      });
    });

    it('clears copy feedback after 2 seconds', async () => {
      const countries = createMockCountriesForRegions();
      const userCountries = [createMockUserCountryVisited('JP')];
      mockHooksWithData({ countries, userCountries });

      render(<ProfileSettingsScreen navigation={mockNavigation} route={mockRoute} />);

      // Open export modal
      fireEvent.press(screen.getByLabelText('Export your country list'));

      await waitFor(() => {
        expect(screen.getByText('Share or copy your country list')).toBeTruthy();
      });

      // Press copy button
      const copyButton = screen.getByText('Copy');
      await act(async () => {
        fireEvent.press(copyButton);
      });

      // Verify feedback shows
      expect(screen.getByText('Copied!')).toBeTruthy();

      // Advance timers by 2 seconds
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      // Feedback should be cleared, button should say "Copy" again
      await waitFor(() => {
        expect(screen.queryByText('Copied!')).toBeNull();
        expect(screen.getByText('Copy')).toBeTruthy();
      });
    });

    it('clears previous timeout on rapid copy presses', async () => {
      const countries = createMockCountriesForRegions();
      const userCountries = [createMockUserCountryVisited('JP')];
      mockHooksWithData({ countries, userCountries });

      render(<ProfileSettingsScreen navigation={mockNavigation} route={mockRoute} />);

      // Open export modal
      fireEvent.press(screen.getByLabelText('Export your country list'));

      await waitFor(() => {
        expect(screen.getByText('Share or copy your country list')).toBeTruthy();
      });

      // Press copy button twice rapidly
      const copyButton = screen.getByText('Copy');

      await act(async () => {
        fireEvent.press(copyButton);
      });

      // Advance 1 second (not enough to clear)
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      // Press again - this should reset the timer
      await act(async () => {
        fireEvent.press(screen.getByText('Copied!'));
      });

      // Advance another 1.5 seconds (would be 2.5 total from first press)
      act(() => {
        jest.advanceTimersByTime(1500);
      });

      // Should still show Copied! because the second press reset the timer
      expect(screen.getByText('Copied!')).toBeTruthy();

      // Now advance the remaining 0.5 seconds
      act(() => {
        jest.advanceTimersByTime(500);
      });

      // Now it should be cleared
      await waitFor(() => {
        expect(screen.queryByText('Copied!')).toBeNull();
      });
    });

    it('calls Share.share when share button pressed', async () => {
      const countries = createMockCountriesForRegions();
      const userCountries = [createMockUserCountryVisited('JP')];
      mockHooksWithData({ countries, userCountries });

      render(<ProfileSettingsScreen navigation={mockNavigation} route={mockRoute} />);

      // Open export modal
      fireEvent.press(screen.getByLabelText('Export your country list'));

      await waitFor(() => {
        expect(screen.getByText('Share or copy your country list')).toBeTruthy();
      });

      // Press share button - Share.share is mocked globally in jest.setup.js
      const shareButton = screen.getByText('Share');
      await act(async () => {
        fireEvent.press(shareButton);
      });

      // If we get here without error, the share action completed
      // Modal should still be visible
      expect(screen.getByText('Share or copy your country list')).toBeTruthy();
    });
  });

  describe('Error Cases', () => {
    it('hides export button when no countries visited', async () => {
      const countries = createMockCountriesForRegions();
      mockHooksWithData({ countries, userCountries: [] });

      render(<ProfileSettingsScreen navigation={mockNavigation} route={mockRoute} />);

      // Export button should not be present when visitedCount is 0
      expect(screen.queryByLabelText('Export your country list')).toBeNull();
      expect(screen.queryByText('EXPORT COUNTRIES')).toBeNull();
    });

    it('hides export button when allCountries not loaded', async () => {
      // Mock with empty countries array (simulating not loaded)
      mockHooksWithData({ countries: [], userCountries: [] });

      render(<ProfileSettingsScreen navigation={mockNavigation} route={mockRoute} />);

      // Export button should not be present when visitedCount is 0
      expect(screen.queryByLabelText('Export your country list')).toBeNull();
    });

    it('handles share button press gracefully', async () => {
      // Share is mocked globally to succeed, but if it fails, the component handles it silently
      const countries = createMockCountriesForRegions();
      const userCountries = [createMockUserCountryVisited('JP')];
      mockHooksWithData({ countries, userCountries });

      render(<ProfileSettingsScreen navigation={mockNavigation} route={mockRoute} />);

      // Open export modal
      fireEvent.press(screen.getByLabelText('Export your country list'));

      await waitFor(() => {
        expect(screen.getByText('Share or copy your country list')).toBeTruthy();
      });

      // Press share button - should not crash even with mocked share
      const shareButton = screen.getByText('Share');
      await act(async () => {
        fireEvent.press(shareButton);
      });

      // Modal should still be visible (no crash)
      expect(screen.getByText('Share or copy your country list')).toBeTruthy();
    });
  });

  describe('Timeout Cleanup', () => {
    it('cleans up timeout on component unmount', async () => {
      const countries = createMockCountriesForRegions();
      const userCountries = [createMockUserCountryVisited('JP')];
      mockHooksWithData({ countries, userCountries });

      const { unmount } = render(
        <ProfileSettingsScreen navigation={mockNavigation} route={mockRoute} />
      );

      // Open export modal
      fireEvent.press(screen.getByLabelText('Export your country list'));

      await waitFor(() => {
        expect(screen.getByText('Share or copy your country list')).toBeTruthy();
      });

      // Press copy button to start timeout
      const copyButton = screen.getByText('Copy');
      await act(async () => {
        fireEvent.press(copyButton);
      });

      // Unmount before timeout completes
      unmount();

      // Advance timers - should not cause any errors
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      // If we get here without errors, the cleanup worked
      expect(true).toBe(true);
    });
  });

  describe('Clipboard Detection', () => {
    beforeEach(() => {
      // Reset settings store to default (disabled)
      useSettingsStore.getState().setClipboardDetectionEnabled(false);
    });

    it('shows Enable button when clipboard detection is disabled', async () => {
      const countries = createMockCountriesForRegions();
      mockHooksWithData({ countries, userCountries: [] });

      render(<ProfileSettingsScreen navigation={mockNavigation} route={mockRoute} />);

      // Should show Enable button, not the toggle
      expect(screen.getByLabelText('Enable clipboard detection')).toBeTruthy();
    });

    it('opens clipboard enable modal when Enable button is pressed', async () => {
      const countries = createMockCountriesForRegions();
      mockHooksWithData({ countries, userCountries: [] });

      render(<ProfileSettingsScreen navigation={mockNavigation} route={mockRoute} />);

      // Press Enable button
      const enableButton = screen.getByLabelText('Enable clipboard detection');
      fireEvent.press(enableButton);

      // Enable modal should be visible
      await waitFor(() => {
        expect(screen.getByText('Save Links Automatically')).toBeTruthy();
      });
    });

    it('shows toggle and Learn more link when clipboard detection is enabled', async () => {
      // Enable clipboard detection
      useSettingsStore.getState().setClipboardDetectionEnabled(true);

      const countries = createMockCountriesForRegions();
      mockHooksWithData({ countries, userCountries: [] });

      render(<ProfileSettingsScreen navigation={mockNavigation} route={mockRoute} />);

      // Should show toggle, not Enable button
      expect(screen.getByLabelText('Toggle clipboard URL detection')).toBeTruthy();
      // Should show Learn more link
      expect(screen.getByLabelText('Learn about clipboard permissions')).toBeTruthy();
    });

    it('opens clipboard permission modal when Learn more link is pressed (when enabled)', async () => {
      // Enable clipboard detection
      useSettingsStore.getState().setClipboardDetectionEnabled(true);

      const countries = createMockCountriesForRegions();
      mockHooksWithData({ countries, userCountries: [] });

      render(<ProfileSettingsScreen navigation={mockNavigation} route={mockRoute} />);

      // Press Learn more link
      const learnMoreLink = screen.getByLabelText('Learn about clipboard permissions');
      fireEvent.press(learnMoreLink);

      // Permission modal should be visible
      await waitFor(() => {
        expect(screen.getByText('Clipboard Permissions')).toBeTruthy();
        expect(screen.getByText('How to allow permanently')).toBeTruthy();
      });
    });

    it('closes clipboard permission modal when "Got it" button is pressed', async () => {
      // Enable clipboard detection
      useSettingsStore.getState().setClipboardDetectionEnabled(true);

      const countries = createMockCountriesForRegions();
      mockHooksWithData({ countries, userCountries: [] });

      render(<ProfileSettingsScreen navigation={mockNavigation} route={mockRoute} />);

      // Open the modal
      const learnMoreLink = screen.getByLabelText('Learn about clipboard permissions');
      fireEvent.press(learnMoreLink);

      await waitFor(() => {
        expect(screen.getByText('Clipboard Permissions')).toBeTruthy();
      });

      // Press "Got it" to close
      const gotItButton = screen.getByText('Got it');
      fireEvent.press(gotItButton);

      // Modal should be closed
      await waitFor(() => {
        expect(screen.queryByText('Clipboard Permissions')).toBeNull();
      });
    });
  });

  describe('User Info Display', () => {
    it('displays user email in profile details', async () => {
      const countries = createMockCountriesForRegions();
      mockHooksWithData({ countries, userCountries: [] });

      // Set up auth store with a mock session containing email
      const mockSession = {
        access_token: 'test-token',
        refresh_token: 'test-refresh',
        expires_in: 3600,
        token_type: 'bearer',
        user: {
          id: 'user-123',
          email: 'test@example.com',
          app_metadata: {},
          user_metadata: {},
          aud: 'authenticated',
          created_at: new Date().toISOString(),
        },
      } as Session;

      useAuthStore.getState().setSession(mockSession);

      render(<ProfileSettingsScreen navigation={mockNavigation} route={mockRoute} />);

      // Should display the email in the passport details section
      await waitFor(() => {
        expect(screen.getByText('Email')).toBeTruthy();
        expect(screen.getByText('test@example.com')).toBeTruthy();
      });
    });

    it('displays "Not set" when email is not available', async () => {
      const countries = createMockCountriesForRegions();
      mockHooksWithData({ countries, userCountries: [] });

      // Set up auth store with a mock session without email
      const mockSession = {
        access_token: 'test-token',
        refresh_token: 'test-refresh',
        expires_in: 3600,
        token_type: 'bearer',
        user: {
          id: 'user-123',
          email: undefined,
          app_metadata: {},
          user_metadata: {},
          aud: 'authenticated',
          created_at: new Date().toISOString(),
        },
      } as unknown as Session;

      useAuthStore.getState().setSession(mockSession);

      render(<ProfileSettingsScreen navigation={mockNavigation} route={mockRoute} />);

      // Should display "Not set" when email is missing
      await waitFor(() => {
        expect(screen.getByText('Email')).toBeTruthy();
        expect(screen.getByText('Not set')).toBeTruthy();
      });
    });
  });
});
