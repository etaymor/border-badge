import React from 'react';

import type { AuthStackScreenProps, OnboardingStackScreenProps } from '@navigation/types';
import { AccountCreationScreen } from '@screens/onboarding/AccountCreationScreen';
import { PhoneAuthScreen } from '@screens/auth/PhoneAuthScreen';
import { useSendOTP, useVerifyOTP } from '@hooks/useAuth';
import { useOnboardingStore } from '@stores/onboardingStore';

import { fireEvent, render, waitFor } from '../utils/testUtils';
import { createMockNavigation } from '../utils/mockFactories';

jest.mock('@hooks/useAuth');

const mockUseSendOTP = useSendOTP as jest.Mock;
const mockUseVerifyOTP = useVerifyOTP as jest.Mock;

function setupAuthMocks() {
  const mutateSend = jest.fn((_payload, options) => {
    options?.onSuccess?.();
  });

  mockUseSendOTP.mockReturnValue({
    mutate: mutateSend,
    isPending: false,
  });

  mockUseVerifyOTP.mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
  });

  return { mutateSend };
}

describe('Change number flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupAuthMocks();

    // Reset onboarding store to avoid state leakage between tests
    useOnboardingStore.setState((state) => ({
      ...state,
      homeCountry: null,
      displayName: null,
    }));
  });

  it('clears phone input when changing number on PhoneAuthScreen', async () => {
    const navigation =
      createMockNavigation() as unknown as AuthStackScreenProps<'PhoneAuth'>['navigation'];
    const route = {
      key: 'test-auth',
      name: 'PhoneAuth',
    } as AuthStackScreenProps<'PhoneAuth'>['route'];

    const { getByTestId, getByText } = render(
      <PhoneAuthScreen navigation={navigation} route={route} />
    );

    fireEvent.changeText(getByTestId('phone-auth-input'), '5551234567');
    fireEvent.press(getByTestId('phone-auth-send-button'));

    await waitFor(() => expect(getByText('Change number')).toBeTruthy());

    fireEvent.press(getByText('Change number'));

    await waitFor(() => expect(getByTestId('phone-auth-input').props.value).toBe(''));
  });

  it('clears phone input when changing number on AccountCreationScreen', async () => {
    const navigation =
      createMockNavigation() as unknown as OnboardingStackScreenProps<'AccountCreation'>['navigation'];
    const route = {
      key: 'test-account',
      name: 'AccountCreation',
    } as OnboardingStackScreenProps<'AccountCreation'>['route'];

    const { getByTestId, getByText } = render(
      <AccountCreationScreen navigation={navigation} route={route} />
    );

    fireEvent.changeText(getByTestId('account-creation-phone'), '5551234567');
    fireEvent.press(getByTestId('account-creation-send-button'));

    await waitFor(() => expect(getByText('Change number')).toBeTruthy());

    fireEvent.press(getByText('Change number'));

    await waitFor(() => expect(getByTestId('account-creation-phone').props.value).toBe(''));
  });
});
