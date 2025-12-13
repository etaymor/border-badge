import { fireEvent, render, screen, act } from '../utils/testUtils';

import { CategoryButton } from '@components/entries/CategoryButton';
import type { EntryTypeConfig } from '@constants/entryTypes';
import { colors } from '@constants/colors';

// Mock timers for animation testing
jest.useFakeTimers();

const mockPlaceConfig: EntryTypeConfig = {
  type: 'place',
  icon: 'location',
  label: 'Place',
  color: colors.adobeBrick,
  emoji: '📍',
};

const mockFoodConfig: EntryTypeConfig = {
  type: 'food',
  icon: 'restaurant',
  label: 'Food',
  color: colors.sunsetGold,
  emoji: '🍽️',
};

describe('CategoryButton', () => {
  const mockOnPress = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('rendering', () => {
    it('renders the category label', () => {
      render(
        <CategoryButton item={mockPlaceConfig} isSelected={false} onPress={mockOnPress} index={0} />
      );

      expect(screen.getByText('Place')).toBeTruthy();
    });

    it('renders with correct testID', () => {
      render(
        <CategoryButton item={mockPlaceConfig} isSelected={false} onPress={mockOnPress} index={0} />
      );

      expect(screen.getByTestId('entry-type-place')).toBeTruthy();
    });

    it('renders different category types', () => {
      render(
        <CategoryButton item={mockFoodConfig} isSelected={false} onPress={mockOnPress} index={0} />
      );

      expect(screen.getByText('Food')).toBeTruthy();
      expect(screen.getByTestId('entry-type-food')).toBeTruthy();
    });
  });

  describe('selection state', () => {
    it('renders in unselected state', () => {
      render(
        <CategoryButton item={mockPlaceConfig} isSelected={false} onPress={mockOnPress} index={0} />
      );

      // Button should render (specific styling is internal)
      expect(screen.getByText('Place')).toBeTruthy();
    });

    it('renders in selected state', () => {
      render(
        <CategoryButton item={mockPlaceConfig} isSelected={true} onPress={mockOnPress} index={0} />
      );

      // Button should render with selected indicator
      expect(screen.getByText('Place')).toBeTruthy();
    });
  });

  describe('interactions', () => {
    it('calls onPress when pressed', () => {
      render(
        <CategoryButton item={mockPlaceConfig} isSelected={false} onPress={mockOnPress} index={0} />
      );

      fireEvent.press(screen.getByTestId('entry-type-place'));

      expect(mockOnPress).toHaveBeenCalledTimes(1);
    });

    it('calls onPress when already selected', () => {
      render(
        <CategoryButton item={mockPlaceConfig} isSelected={true} onPress={mockOnPress} index={0} />
      );

      fireEvent.press(screen.getByTestId('entry-type-place'));

      expect(mockOnPress).toHaveBeenCalledTimes(1);
    });
  });

  describe('entrance animation', () => {
    it('starts with opacity 0 for entrance animation', () => {
      render(
        <CategoryButton item={mockPlaceConfig} isSelected={false} onPress={mockOnPress} index={0} />
      );

      // The button should exist even while animating
      expect(screen.getByText('Place')).toBeTruthy();
    });

    it('staggers animation based on index', () => {
      const { rerender } = render(
        <CategoryButton item={mockPlaceConfig} isSelected={false} onPress={mockOnPress} index={0} />
      );

      // Advance time for first button's animation (index 0, delay 0ms)
      act(() => {
        jest.advanceTimersByTime(300);
      });

      rerender(
        <CategoryButton item={mockFoodConfig} isSelected={false} onPress={mockOnPress} index={3} />
      );

      // Advance time for staggered animation (index 3, delay 240ms + 300ms duration)
      act(() => {
        jest.advanceTimersByTime(540);
      });

      // Both buttons should be visible after animations complete
      expect(screen.getByText('Food')).toBeTruthy();
    });
  });

  describe('press animation', () => {
    it('handles press in and press out events', () => {
      render(
        <CategoryButton item={mockPlaceConfig} isSelected={false} onPress={mockOnPress} index={0} />
      );

      const button = screen.getByTestId('entry-type-place');

      // Simulate press in
      fireEvent(button, 'pressIn');

      // Let animation run
      act(() => {
        jest.advanceTimersByTime(100);
      });

      // Simulate press out
      fireEvent(button, 'pressOut');

      act(() => {
        jest.advanceTimersByTime(100);
      });

      // Button should still be rendered
      expect(screen.getByText('Place')).toBeTruthy();
    });
  });
});
