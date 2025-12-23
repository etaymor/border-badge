import { render, screen, fireEvent } from './utils/testUtils';

import { AuthScreen } from '@screens/auth';
import type { AuthStackScreenProps } from '@navigation/types';

// Mock navigation for individual screen tests
const mockNavigate = jest.fn();
const mockNavigation = {
  navigate: mockNavigate,
  goBack: jest.fn(),
  setOptions: jest.fn(),
  canGoBack: jest.fn().mockReturnValue(false),
} as unknown as AuthStackScreenProps<'Login'>['navigation'];

const mockRoute = {} as AuthStackScreenProps<'Login'>['route'];

describe('AuthScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders create account title (password mode default)', () => {
    render(<AuthScreen navigation={mockNavigation} route={mockRoute} />);

    // Password mode with sign-up is the default
    expect(screen.getByText('Create account')).toBeTruthy();
  });

  it('displays email input', () => {
    render(<AuthScreen navigation={mockNavigation} route={mockRoute} />);

    expect(screen.getByPlaceholderText('Email address')).toBeTruthy();
  });

  it('displays password input after entering valid email', () => {
    render(<AuthScreen navigation={mockNavigation} route={mockRoute} />);

    // Password field is hidden until email is valid
    expect(screen.queryByPlaceholderText('Password')).toBeNull();

    // Enter a valid email
    const emailInput = screen.getByPlaceholderText('Email address');
    fireEvent.changeText(emailInput, 'test@example.com');

    // Now password field should be visible
    expect(screen.getByPlaceholderText('Password')).toBeTruthy();
  });

  it('displays create account button (password mode default)', () => {
    render(<AuthScreen navigation={mockNavigation} route={mockRoute} />);

    expect(screen.getByText('Create Account')).toBeTruthy();
  });
});
