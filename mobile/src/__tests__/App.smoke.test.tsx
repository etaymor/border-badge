import { render, screen } from './utils/testUtils';

import { PhoneAuthScreen } from '@screens/auth/PhoneAuthScreen';
import type { AuthStackScreenProps } from '@navigation/types';

// Mock navigation for individual screen tests
const mockNavigate = jest.fn();
const mockNavigation = {
  navigate: mockNavigate,
  goBack: jest.fn(),
  setOptions: jest.fn(),
  canGoBack: jest.fn().mockReturnValue(false),
} as unknown as AuthStackScreenProps<'PhoneAuth'>['navigation'];

const mockRoute = {} as AuthStackScreenProps<'PhoneAuth'>['route'];

describe('PhoneAuthScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders welcome back title', () => {
    render(<PhoneAuthScreen navigation={mockNavigation} route={mockRoute} />);

    expect(screen.getByText('Welcome back')).toBeTruthy();
  });

  it('displays phone number input', () => {
    render(<PhoneAuthScreen navigation={mockNavigation} route={mockRoute} />);

    expect(screen.getByText('Phone Number')).toBeTruthy();
  });

  it('displays continue button', () => {
    render(<PhoneAuthScreen navigation={mockNavigation} route={mockRoute} />);

    expect(screen.getByText('Continue')).toBeTruthy();
  });
});
