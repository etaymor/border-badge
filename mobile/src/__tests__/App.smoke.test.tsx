import { render, screen } from './utils/testUtils';

import { LoginScreen } from '@screens/auth/LoginScreen';
import type { AuthStackScreenProps } from '@navigation/types';

// Mock navigation for individual screen tests
const mockNavigate = jest.fn();
const mockNavigation = {
  navigate: mockNavigate,
  goBack: jest.fn(),
  setOptions: jest.fn(),
} as unknown as AuthStackScreenProps<'Login'>['navigation'];

const mockRoute = {} as AuthStackScreenProps<'Login'>['route'];

describe('LoginScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders login title', () => {
    render(<LoginScreen navigation={mockNavigation} route={mockRoute} />);

    expect(screen.getByText('Login')).toBeTruthy();
  });

  it('displays sign up link', () => {
    render(<LoginScreen navigation={mockNavigation} route={mockRoute} />);

    expect(screen.getByText("Don't have an account? Sign up")).toBeTruthy();
  });

  it('displays forgot password link', () => {
    render(<LoginScreen navigation={mockNavigation} route={mockRoute} />);

    expect(screen.getByText('Forgot password?')).toBeTruthy();
  });
});
