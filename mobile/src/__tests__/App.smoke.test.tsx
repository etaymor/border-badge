import { render, screen } from './utils/testUtils';

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

  it('renders welcome back title', () => {
    render(<AuthScreen navigation={mockNavigation} route={mockRoute} />);

    expect(screen.getByText('Welcome back')).toBeTruthy();
  });

  it('displays email input', () => {
    render(<AuthScreen navigation={mockNavigation} route={mockRoute} />);

    expect(screen.getByPlaceholderText('Email address')).toBeTruthy();
  });

  it('displays continue button', () => {
    render(<AuthScreen navigation={mockNavigation} route={mockRoute} />);

    expect(screen.getByText('Continue')).toBeTruthy();
  });
});
