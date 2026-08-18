import { fireEvent, render, screen } from '../utils/testUtils';
import { createMockNavigation } from '../utils/mockFactories';

import { NameEntryScreen } from '@screens/onboarding/NameEntryScreen';
import { useOnboardingStore } from '@stores/onboardingStore';

import type { OnboardingStackScreenProps } from '@navigation/types';

// Mock navigation
const mockNavigation =
  createMockNavigation() as unknown as OnboardingStackScreenProps<'NameEntry'>['navigation'];
const mockRoute = {
  key: 'test',
  name: 'NameEntry',
} as OnboardingStackScreenProps<'NameEntry'>['route'];

describe('NameEntryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset onboarding store
    useOnboardingStore.setState({ username: null, displayName: null });
  });

  describe('validation', () => {
    it('rejects empty username with error', () => {
      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      // Press continue without entering a username
      fireEvent.press(screen.getByTestId('username-entry-continue'));

      expect(screen.getByText('Please enter a username')).toBeTruthy();
      expect(mockNavigation.navigate).not.toHaveBeenCalled();
    });

    it('rejects username less than 3 characters with error', () => {
      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      const input = screen.getByTestId('username-entry-input');
      fireEvent.changeText(input, 'ab');
      fireEvent.press(screen.getByTestId('username-entry-continue'));

      expect(screen.getByText('Username must be at least 3 characters')).toBeTruthy();
      expect(mockNavigation.navigate).not.toHaveBeenCalled();
    });

    it('rejects username over 30 characters with error', () => {
      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      const input = screen.getByTestId('username-entry-input');
      const longName = 'a'.repeat(31);
      fireEvent.changeText(input, longName);
      fireEvent.press(screen.getByTestId('username-entry-continue'));

      expect(screen.getByText('Username must be 30 characters or less')).toBeTruthy();
      expect(mockNavigation.navigate).not.toHaveBeenCalled();
    });

    it('strips invalid characters from input as user types', () => {
      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      const input = screen.getByTestId('username-entry-input');
      // Input sanitizes as you type - invalid chars are stripped
      fireEvent.changeText(input, 'user@name!test');
      fireEvent.press(screen.getByTestId('username-entry-continue'));

      // Should navigate successfully because @ and ! were stripped, leaving "usernametest"
      expect(mockNavigation.navigate).toHaveBeenCalledWith('AccountCreation');
    });

    it('trims whitespace before validation', () => {
      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      const input = screen.getByTestId('username-entry-input');
      // Spaces around "ab" - after trim, only 2 characters (below min of 3)
      fireEvent.changeText(input, '   ab   ');
      fireEvent.press(screen.getByTestId('username-entry-continue'));

      expect(screen.getByText('Username must be at least 3 characters')).toBeTruthy();
    });

    it('clears error when user types after validation failure', () => {
      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      const input = screen.getByTestId('username-entry-input');

      // Trigger validation error
      fireEvent.press(screen.getByTestId('username-entry-continue'));
      expect(screen.getByText('Please enter a username')).toBeTruthy();

      // Start typing
      fireEvent.changeText(input, 'u');

      // Error should be cleared
      expect(screen.queryByText('Please enter a username')).toBeNull();
    });
  });

  describe('successful submission', () => {
    it('stores trimmed username to onboarding store on valid submission', () => {
      const setUsernameSpy = jest.fn();
      useOnboardingStore.setState({ setUsername: setUsernameSpy });

      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      const input = screen.getByTestId('username-entry-input');
      fireEvent.changeText(input, '  bob_smith  ');
      fireEvent.press(screen.getByTestId('username-entry-continue'));

      expect(setUsernameSpy).toHaveBeenCalledWith('bob_smith');
    });

    it('navigates to AccountCreation on valid submission', () => {
      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      const input = screen.getByTestId('username-entry-input');
      fireEvent.changeText(input, 'bob_smith');
      fireEvent.press(screen.getByTestId('username-entry-continue'));

      expect(mockNavigation.navigate).toHaveBeenCalledWith('AccountCreation');
    });

    it('accepts valid username with exactly 3 characters', () => {
      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      const input = screen.getByTestId('username-entry-input');
      fireEvent.changeText(input, 'joe');
      fireEvent.press(screen.getByTestId('username-entry-continue'));

      expect(mockNavigation.navigate).toHaveBeenCalledWith('AccountCreation');
    });

    it('accepts valid username with exactly 30 characters', () => {
      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      const input = screen.getByTestId('username-entry-input');
      const maxName = 'a'.repeat(30);
      fireEvent.changeText(input, maxName);
      fireEvent.press(screen.getByTestId('username-entry-continue'));

      expect(mockNavigation.navigate).toHaveBeenCalledWith('AccountCreation');
    });
  });

  describe('pre-population', () => {
    it('pre-populates input with stored username if available', () => {
      useOnboardingStore.setState({ username: 'existing_name' });

      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      const input = screen.getByTestId('username-entry-input');
      expect(input.props.value).toBe('existing_name');
    });
  });
});
