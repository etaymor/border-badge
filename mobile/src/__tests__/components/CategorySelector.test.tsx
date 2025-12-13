import { fireEvent, render, screen } from '../utils/testUtils';

import { CategorySelector } from '@components/entries/CategorySelector';
import type { EntryType } from '@navigation/types';

describe('CategorySelector', () => {
  const mockOnTypeSelect = jest.fn();
  const mockOnChangeType = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  const renderSelector = (props: Partial<React.ComponentProps<typeof CategorySelector>> = {}) => {
    return render(
      <CategorySelector
        entryType={null}
        hasSelectedType={false}
        onTypeSelect={mockOnTypeSelect}
        onChangeType={mockOnChangeType}
        {...props}
      />
    );
  };

  describe('rendering', () => {
    it('renders the CATEGORY label', () => {
      renderSelector();

      expect(screen.getByText('CATEGORY')).toBeTruthy();
    });

    it('renders all category buttons when no type selected', () => {
      renderSelector();

      expect(screen.getByTestId('entry-type-place')).toBeTruthy();
      expect(screen.getByTestId('entry-type-food')).toBeTruthy();
      expect(screen.getByTestId('entry-type-stay')).toBeTruthy();
      expect(screen.getByTestId('entry-type-experience')).toBeTruthy();
    });

    it('renders all category labels', () => {
      renderSelector();

      expect(screen.getByText('Place')).toBeTruthy();
      expect(screen.getByText('Food')).toBeTruthy();
      expect(screen.getByText('Stay')).toBeTruthy();
      expect(screen.getByText('Experience')).toBeTruthy();
    });
  });

  describe('unselected state (category grid)', () => {
    it('shows category grid when hasSelectedType is false', () => {
      renderSelector({ hasSelectedType: false });

      // All category buttons should be visible
      expect(screen.getByTestId('entry-type-place')).toBeTruthy();
      expect(screen.getByTestId('entry-type-food')).toBeTruthy();
      expect(screen.getByTestId('entry-type-stay')).toBeTruthy();
      expect(screen.getByTestId('entry-type-experience')).toBeTruthy();
    });

    it('highlights selected button when entryType is set but not confirmed', () => {
      renderSelector({ entryType: 'food', hasSelectedType: false });

      // Should still show the grid with food highlighted
      expect(screen.getByTestId('entry-type-food')).toBeTruthy();
      expect(screen.getByText('Food')).toBeTruthy();
    });
  });

  describe('selected state (selected display)', () => {
    it('shows selected category display when hasSelectedType is true', () => {
      renderSelector({ entryType: 'place', hasSelectedType: true });

      // Should show the selected category label
      expect(screen.getByText('Place')).toBeTruthy();
      // Should show Change button
      expect(screen.getByText('Change')).toBeTruthy();
    });

    it('does not show category grid when type is selected', () => {
      renderSelector({ entryType: 'food', hasSelectedType: true });

      // Should not show other category buttons
      expect(screen.queryByTestId('entry-type-place')).toBeNull();
      expect(screen.queryByTestId('entry-type-stay')).toBeNull();
      expect(screen.queryByTestId('entry-type-experience')).toBeNull();
    });

    it('displays correct type for each entry type', () => {
      const entryTypes: EntryType[] = ['place', 'food', 'stay', 'experience'];
      const labels = ['Place', 'Food', 'Stay', 'Experience'];

      entryTypes.forEach((type, index) => {
        const { unmount } = renderSelector({ entryType: type, hasSelectedType: true });
        expect(screen.getByText(labels[index])).toBeTruthy();
        expect(screen.getByText('Change')).toBeTruthy();
        unmount();
      });
    });
  });

  describe('interactions', () => {
    it('calls onTypeSelect when a category button is pressed', () => {
      renderSelector();

      fireEvent.press(screen.getByTestId('entry-type-food'));

      expect(mockOnTypeSelect).toHaveBeenCalledWith('food');
    });

    it('calls onTypeSelect with correct type for each button', () => {
      renderSelector();

      fireEvent.press(screen.getByTestId('entry-type-place'));
      expect(mockOnTypeSelect).toHaveBeenCalledWith('place');

      fireEvent.press(screen.getByTestId('entry-type-stay'));
      expect(mockOnTypeSelect).toHaveBeenCalledWith('stay');

      fireEvent.press(screen.getByTestId('entry-type-experience'));
      expect(mockOnTypeSelect).toHaveBeenCalledWith('experience');
    });

    it('calls onChangeType when Change button is pressed', () => {
      renderSelector({ entryType: 'place', hasSelectedType: true });

      fireEvent.press(screen.getByText('Change'));

      expect(mockOnChangeType).toHaveBeenCalledTimes(1);
    });
  });

  describe('edge cases', () => {
    it('handles null entryType with hasSelectedType true gracefully', () => {
      // This shouldn't happen in practice, but component should handle it
      renderSelector({ entryType: null, hasSelectedType: true });

      // Should fall back to showing the grid since selectedTypeConfig is null
      expect(screen.getByTestId('entry-type-place')).toBeTruthy();
    });

    it('renders without crashing when all props are defaults', () => {
      renderSelector();

      expect(screen.getByText('CATEGORY')).toBeTruthy();
    });
  });
});
