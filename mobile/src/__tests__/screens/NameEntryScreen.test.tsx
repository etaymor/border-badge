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
    useOnboardingStore.setState({ displayName: null });
  });

  describe('validation', () => {
    it('rejects empty name with error', () => {
      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      // Press continue without entering a name
      fireEvent.press(screen.getByTestId('name-entry-continue'));

      expect(screen.getByText('Please enter your name')).toBeTruthy();
      expect(mockNavigation.navigate).not.toHaveBeenCalled();
    });

    it('rejects name less than 2 characters with error', () => {
      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      const input = screen.getByTestId('name-entry-input');
      fireEvent.changeText(input, 'A');
      fireEvent.press(screen.getByTestId('name-entry-continue'));

      expect(screen.getByText('Name must be at least 2 characters')).toBeTruthy();
      expect(mockNavigation.navigate).not.toHaveBeenCalled();
    });

    it('rejects name over 50 characters with error', () => {
      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      const input = screen.getByTestId('name-entry-input');
      const longName = 'A'.repeat(51);
      fireEvent.changeText(input, longName);
      fireEvent.press(screen.getByTestId('name-entry-continue'));

      expect(screen.getByText('Name must be 50 characters or less')).toBeTruthy();
      expect(mockNavigation.navigate).not.toHaveBeenCalled();
    });

    it('trims whitespace before validation', () => {
      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      const input = screen.getByTestId('name-entry-input');
      // Spaces around "A" - after trim, only 1 character
      fireEvent.changeText(input, '   A   ');
      fireEvent.press(screen.getByTestId('name-entry-continue'));

      expect(screen.getByText('Name must be at least 2 characters')).toBeTruthy();
    });

    it('clears error when user types after validation failure', () => {
      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      const input = screen.getByTestId('name-entry-input');

      // Trigger validation error
      fireEvent.press(screen.getByTestId('name-entry-continue'));
      expect(screen.getByText('Please enter your name')).toBeTruthy();

      // Start typing
      fireEvent.changeText(input, 'J');

      // Error should be cleared
      expect(screen.queryByText('Please enter your name')).toBeNull();
    });
  });

  describe('successful submission', () => {
    it('stores trimmed name to onboarding store on valid submission', () => {
      const setDisplayNameSpy = jest.fn();
      useOnboardingStore.setState({ setDisplayName: setDisplayNameSpy });

      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      const input = screen.getByTestId('name-entry-input');
      fireEvent.changeText(input, '  Bob Smith  ');
      fireEvent.press(screen.getByTestId('name-entry-continue'));

      expect(setDisplayNameSpy).toHaveBeenCalledWith('Bob Smith');
    });

    it('navigates to AccountCreation on valid submission', () => {
      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      const input = screen.getByTestId('name-entry-input');
      fireEvent.changeText(input, 'Bob Smith');
      fireEvent.press(screen.getByTestId('name-entry-continue'));

      expect(mockNavigation.navigate).toHaveBeenCalledWith('AccountCreation');
    });

    it('accepts valid name with exactly 2 characters', () => {
      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      const input = screen.getByTestId('name-entry-input');
      fireEvent.changeText(input, 'Jo');
      fireEvent.press(screen.getByTestId('name-entry-continue'));

      expect(mockNavigation.navigate).toHaveBeenCalledWith('AccountCreation');
    });

    it('accepts valid name with exactly 50 characters', () => {
      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      const input = screen.getByTestId('name-entry-input');
      const maxName = 'A'.repeat(50);
      fireEvent.changeText(input, maxName);
      fireEvent.press(screen.getByTestId('name-entry-continue'));

      expect(mockNavigation.navigate).toHaveBeenCalledWith('AccountCreation');
    });
  });

  describe('pre-population', () => {
    it('pre-populates input with stored displayName if available', () => {
      useOnboardingStore.setState({ displayName: 'Existing Name' });

      render(<NameEntryScreen navigation={mockNavigation} route={mockRoute} />);

      const input = screen.getByTestId('name-entry-input');
      expect(input.props.value).toBe('Existing Name');
    });
  });
});
