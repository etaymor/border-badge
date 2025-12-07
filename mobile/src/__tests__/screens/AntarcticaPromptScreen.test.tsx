import { fireEvent, render, screen } from '../utils/testUtils';
import { createMockNavigation } from '../utils/mockFactories';

import { AntarcticaPromptScreen } from '@screens/onboarding/AntarcticaPromptScreen';
import { useOnboardingStore } from '@stores/onboardingStore';

import type { OnboardingStackScreenProps } from '@navigation/types';

// Mock navigation
const mockNavigation =
  createMockNavigation() as unknown as OnboardingStackScreenProps<'AntarcticaPrompt'>['navigation'];
const mockRoute = {
  key: 'test',
  name: 'AntarcticaPrompt',
} as OnboardingStackScreenProps<'AntarcticaPrompt'>['route'];

describe('AntarcticaPromptScreen', () => {
  let addVisitedContinentSpy: jest.Mock;
  let toggleCountrySpy: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up spies for store actions
    addVisitedContinentSpy = jest.fn();
    toggleCountrySpy = jest.fn();

    useOnboardingStore.setState({
      visitedContinents: [],
      addVisitedContinent: addVisitedContinentSpy,
      toggleCountry: toggleCountrySpy,
    });
  });

  describe('Yes button', () => {
    it('calls addVisitedContinent with Antarctica', () => {
      render(<AntarcticaPromptScreen navigation={mockNavigation} route={mockRoute} />);

      fireEvent.press(screen.getByText('Yes'));

      expect(addVisitedContinentSpy).toHaveBeenCalledWith('Antarctica');
    });

    it('calls toggleCountry with AQ country code', () => {
      render(<AntarcticaPromptScreen navigation={mockNavigation} route={mockRoute} />);

      fireEvent.press(screen.getByText('Yes'));

      expect(toggleCountrySpy).toHaveBeenCalledWith('AQ');
    });

    it('navigates to ProgressSummary', () => {
      render(<AntarcticaPromptScreen navigation={mockNavigation} route={mockRoute} />);

      fireEvent.press(screen.getByText('Yes'));

      expect(mockNavigation.navigate).toHaveBeenCalledWith('ProgressSummary');
    });
  });

  describe('No button', () => {
    it('navigates to ProgressSummary without modifying store', () => {
      render(<AntarcticaPromptScreen navigation={mockNavigation} route={mockRoute} />);

      fireEvent.press(screen.getByText('No'));

      expect(addVisitedContinentSpy).not.toHaveBeenCalled();
      expect(toggleCountrySpy).not.toHaveBeenCalled();
      expect(mockNavigation.navigate).toHaveBeenCalledWith('ProgressSummary');
    });
  });
});
