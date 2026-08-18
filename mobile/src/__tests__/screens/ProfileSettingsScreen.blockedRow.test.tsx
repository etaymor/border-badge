/**
 * Tests for the "Blocked Travelers" row in ProfileSettingsScreen.
 *
 * Kept separate from ProfileSettingsScreen.test.tsx because this suite mocks
 * the social feature flag on.
 *
 * Covers:
 * - the row renders when social is enabled and navigates to the
 *   BlockedUsers screen in the Friends stack
 * - the row is hidden when social is disabled
 */

import React from 'react';
import { fireEvent, render, screen } from '../utils/testUtils';

import { ProfileSettingsScreen } from '@screens/profile/ProfileSettingsScreen';
import type { PassportStackScreenProps } from '@navigation/types';
import * as useCountriesModule from '@hooks/useCountries';
import * as useUserCountriesModule from '@hooks/useUserCountries';
import * as useProfileModule from '@hooks/useProfile';
import * as useUpdateDisplayNameModule from '@hooks/useUpdateDisplayName';
import * as useAuthModule from '@hooks/useAuth';
import * as usePhotoPermissionsModule from '@hooks/usePhotoPermissions';
import { createMockNavigation } from '../utils/mockFactories';

// Mutable feature flags so both flag states can be tested in one suite.
const mockFeatures = { enableSocial: true };
jest.mock('@config/features', () => ({
  get features() {
    return mockFeatures;
  },
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(undefined),
}));

const mockNavigate = jest.fn();
const mockNavigation = {
  ...createMockNavigation(),
  navigate: mockNavigate,
} as unknown as PassportStackScreenProps<'ProfileSettings'>['navigation'];

const mockRoute = {
  key: 'test',
  name: 'ProfileSettings',
} as PassportStackScreenProps<'ProfileSettings'>['route'];

function mockHooks() {
  // Static permission status: avoids the hook's async initial check firing
  // state updates after the test completes.
  jest.spyOn(usePhotoPermissionsModule, 'usePhotoPermissionStatus').mockReturnValue({
    status: 'granted',
    isLoading: false,
    refresh: jest.fn(),
  } as unknown as ReturnType<typeof usePhotoPermissionsModule.usePhotoPermissionStatus>);

  jest.spyOn(useAuthModule, 'useSignOut').mockReturnValue({
    mutate: jest.fn(),
    mutateAsync: jest.fn().mockResolvedValue(undefined),
    isPending: false,
  } as unknown as ReturnType<typeof useAuthModule.useSignOut>);

  jest.spyOn(useAuthModule, 'useDeleteAccount').mockReturnValue({
    mutate: jest.fn(),
    mutateAsync: jest.fn().mockResolvedValue(undefined),
    isPending: false,
  } as unknown as ReturnType<typeof useAuthModule.useDeleteAccount>);

  jest.spyOn(useCountriesModule, 'useCountries').mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useCountriesModule.useCountries>);

  jest.spyOn(useCountriesModule, 'useCountryByCode').mockReturnValue({
    data: undefined,
    isLoading: false,
  } as unknown as ReturnType<typeof useCountriesModule.useCountryByCode>);

  jest.spyOn(useUserCountriesModule, 'useUserCountries').mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useUserCountriesModule.useUserCountries>);

  jest.spyOn(useProfileModule, 'useProfile').mockReturnValue({
    data: { display_name: 'Test User', username: 'test_user' },
    isLoading: false,
    error: null,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useProfileModule.useProfile>);

  jest.spyOn(useUpdateDisplayNameModule, 'useUpdateDisplayName').mockReturnValue({
    mutate: jest.fn(),
    mutateAsync: jest.fn().mockResolvedValue(undefined),
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateDisplayNameModule.useUpdateDisplayName>);
}

function renderScreen() {
  return render(<ProfileSettingsScreen navigation={mockNavigation} route={mockRoute} />);
}

describe('ProfileSettingsScreen blocked travelers row', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHooks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the row and navigates to the BlockedUsers screen', () => {
    mockFeatures.enableSocial = true;
    renderScreen();

    const row = screen.getByTestId('blocked-travelers-row');
    expect(screen.getByText('Blocked Travelers')).toBeTruthy();

    fireEvent.press(row);
    expect(mockNavigate).toHaveBeenCalledWith('Friends', { screen: 'BlockedUsers' });
  });

  it('hides the row when social features are disabled', () => {
    mockFeatures.enableSocial = false;
    renderScreen();

    expect(screen.queryByTestId('blocked-travelers-row')).toBeNull();
    expect(screen.queryByText('Blocked Travelers')).toBeNull();
  });
});
