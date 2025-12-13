/**
 * Tests for EntryFormScreen component.
 * Tests category selection, form validation, and entry creation/editing.
 */

import { fireEvent, render, screen, act } from '../utils/testUtils';
import {
  createMockTrip,
  createMockEntryWithPlace,
  createMockNavigation,
} from '../utils/mockFactories';
import { EntryFormScreen } from '@screens/entries/EntryFormScreen';
import type { TripsStackScreenProps } from '@navigation/types';
import * as useEntriesModule from '@hooks/useEntries';
import * as useTripsModule from '@hooks/useTrips';

// Mock timers for animations
jest.useFakeTimers();

// Create mock navigation
const mockNavigation =
  createMockNavigation() as unknown as TripsStackScreenProps<'EntryForm'>['navigation'];

// Helper to create mock route with params
function createEntryFormRoute(params: {
  tripId: string;
  entryId?: string;
  entryType?: 'place' | 'food' | 'stay' | 'experience';
}) {
  return {
    key: 'test',
    name: 'EntryForm',
    params,
  } as TripsStackScreenProps<'EntryForm'>['route'];
}

// Mock the entry and trip hooks
function mockHooks({
  entry = null,
  trip = createMockTrip(),
  isLoadingEntry = false,
  createEntryMutate = jest.fn(),
  updateEntryMutate = jest.fn(),
}: {
  entry?: ReturnType<typeof createMockEntryWithPlace> | null;
  trip?: ReturnType<typeof createMockTrip> | null;
  isLoadingEntry?: boolean;
  createEntryMutate?: jest.Mock;
  updateEntryMutate?: jest.Mock;
} = {}) {
  jest.spyOn(useEntriesModule, 'useEntry').mockReturnValue({
    data: entry ?? undefined,
    isLoading: isLoadingEntry,
  } as unknown as ReturnType<typeof useEntriesModule.useEntry>);

  jest.spyOn(useTripsModule, 'useTrip').mockReturnValue({
    data: trip ?? undefined,
    isLoading: false,
  } as unknown as ReturnType<typeof useTripsModule.useTrip>);

  const createEntry = {
    mutateAsync: createEntryMutate,
    isPending: false,
  };

  const updateEntry = {
    mutateAsync: updateEntryMutate,
    isPending: false,
  };

  jest
    .spyOn(useEntriesModule, 'useCreateEntry')
    .mockReturnValue(createEntry as unknown as ReturnType<typeof useEntriesModule.useCreateEntry>);

  jest
    .spyOn(useEntriesModule, 'useUpdateEntry')
    .mockReturnValue(updateEntry as unknown as ReturnType<typeof useEntriesModule.useUpdateEntry>);
}

describe('EntryFormScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('Rendering - Create Mode', () => {
    it('renders the Add Entry header', () => {
      mockHooks();
      const route = createEntryFormRoute({ tripId: 'trip-123' });

      render(<EntryFormScreen navigation={mockNavigation} route={route} />);

      expect(screen.getByText('Add Entry')).toBeTruthy();
    });

    it('shows category selection grid initially', () => {
      mockHooks();
      const route = createEntryFormRoute({ tripId: 'trip-123' });

      render(<EntryFormScreen navigation={mockNavigation} route={route} />);

      // All category buttons should be visible
      expect(screen.getByTestId('entry-type-place')).toBeTruthy();
      expect(screen.getByTestId('entry-type-food')).toBeTruthy();
      expect(screen.getByTestId('entry-type-stay')).toBeTruthy();
      expect(screen.getByTestId('entry-type-experience')).toBeTruthy();
    });

    it('shows trip context in subtitle', () => {
      mockHooks({ trip: createMockTrip({ name: 'Tokyo Adventure' }) });
      const route = createEntryFormRoute({ tripId: 'trip-123' });

      render(<EntryFormScreen navigation={mockNavigation} route={route} />);

      expect(screen.getByText('Adding to Tokyo Adventure')).toBeTruthy();
    });

    it('shows default subtitle when trip name not available', () => {
      mockHooks({ trip: null });
      const route = createEntryFormRoute({ tripId: 'trip-123' });

      render(<EntryFormScreen navigation={mockNavigation} route={route} />);

      expect(screen.getByText('What would you like to remember?')).toBeTruthy();
    });
  });

  describe('Rendering - Edit Mode', () => {
    it('renders the Edit Entry header', () => {
      mockHooks({
        entry: createMockEntryWithPlace({ id: 'entry-123', title: 'Test Entry' }),
      });
      const route = createEntryFormRoute({ tripId: 'trip-123', entryId: 'entry-123' });

      render(<EntryFormScreen navigation={mockNavigation} route={route} />);

      // Wait for data to load and form to populate
      act(() => {
        jest.advanceTimersByTime(100);
      });

      expect(screen.getByText('Edit Entry')).toBeTruthy();
    });

    it('shows loading indicator while loading entry', () => {
      mockHooks({ isLoadingEntry: true });
      const route = createEntryFormRoute({ tripId: 'trip-123', entryId: 'entry-123' });

      render(<EntryFormScreen navigation={mockNavigation} route={route} />);

      // Should show loading state, not the form
      expect(screen.queryByText('Edit Entry')).toBeNull();
    });

    it('shows "Update your memory" subtitle in edit mode', () => {
      mockHooks({
        entry: createMockEntryWithPlace({ id: 'entry-123' }),
      });
      const route = createEntryFormRoute({ tripId: 'trip-123', entryId: 'entry-123' });

      render(<EntryFormScreen navigation={mockNavigation} route={route} />);

      act(() => {
        jest.advanceTimersByTime(100);
      });

      expect(screen.getByText('Update your memory')).toBeTruthy();
    });
  });

  describe('Category Selection', () => {
    it('selects a category when button is pressed', () => {
      mockHooks();
      const route = createEntryFormRoute({ tripId: 'trip-123' });

      render(<EntryFormScreen navigation={mockNavigation} route={route} />);

      fireEvent.press(screen.getByTestId('entry-type-food'));

      // Wait for animations
      act(() => {
        jest.advanceTimersByTime(500);
      });

      // After selection, the form fields should appear
      // The Change button appears in the selected category display
      expect(screen.getByText('Change')).toBeTruthy();
    });

    it('shows form fields after category selection', () => {
      mockHooks();
      const route = createEntryFormRoute({ tripId: 'trip-123' });

      render(<EntryFormScreen navigation={mockNavigation} route={route} />);

      fireEvent.press(screen.getByTestId('entry-type-place'));

      act(() => {
        jest.advanceTimersByTime(500);
      });

      // Form fields should be visible
      expect(screen.getByText('LOCATION')).toBeTruthy();
      expect(screen.getByText('LINK (OPTIONAL)')).toBeTruthy();
      expect(screen.getByText('PHOTOS')).toBeTruthy();
      expect(screen.getByText('NOTES')).toBeTruthy();
    });

    it('allows changing selected category', () => {
      mockHooks();
      const route = createEntryFormRoute({ tripId: 'trip-123' });

      render(<EntryFormScreen navigation={mockNavigation} route={route} />);

      // Select a category
      fireEvent.press(screen.getByTestId('entry-type-food'));

      act(() => {
        jest.advanceTimersByTime(500);
      });

      // Press Change button
      fireEvent.press(screen.getByText('Change'));

      act(() => {
        jest.advanceTimersByTime(300);
      });

      // Category grid should be visible again
      expect(screen.getByTestId('entry-type-place')).toBeTruthy();
      expect(screen.getByTestId('entry-type-food')).toBeTruthy();
    });

    it('pre-selects category when entryType is provided in route params', () => {
      mockHooks();
      const route = createEntryFormRoute({ tripId: 'trip-123', entryType: 'stay' });

      render(<EntryFormScreen navigation={mockNavigation} route={route} />);

      act(() => {
        jest.advanceTimersByTime(500);
      });

      // Should show the selected category display, not the grid
      expect(screen.getByText('Change')).toBeTruthy();
      expect(screen.getByText('Stay')).toBeTruthy();
    });
  });

  describe('Form Fields by Category', () => {
    it('shows location field for place type', () => {
      mockHooks();
      const route = createEntryFormRoute({ tripId: 'trip-123', entryType: 'place' });

      render(<EntryFormScreen navigation={mockNavigation} route={route} />);

      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(screen.getByText('LOCATION')).toBeTruthy();
    });

    it('shows location field for food type', () => {
      mockHooks();
      const route = createEntryFormRoute({ tripId: 'trip-123', entryType: 'food' });

      render(<EntryFormScreen navigation={mockNavigation} route={route} />);

      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(screen.getByText('LOCATION')).toBeTruthy();
    });

    it('shows location field for stay type', () => {
      mockHooks();
      const route = createEntryFormRoute({ tripId: 'trip-123', entryType: 'stay' });

      render(<EntryFormScreen navigation={mockNavigation} route={route} />);

      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(screen.getByText('LOCATION')).toBeTruthy();
    });

    it('does not show location field for experience type', () => {
      mockHooks();
      const route = createEntryFormRoute({ tripId: 'trip-123', entryType: 'experience' });

      render(<EntryFormScreen navigation={mockNavigation} route={route} />);

      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(screen.queryByText('LOCATION')).toBeNull();
    });

    it('shows name field for experience type', () => {
      mockHooks();
      const route = createEntryFormRoute({ tripId: 'trip-123', entryType: 'experience' });

      render(<EntryFormScreen navigation={mockNavigation} route={route} />);

      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(screen.getByText('NAME')).toBeTruthy();
    });
  });

  describe('Navigation', () => {
    it('navigates back when back button is pressed', () => {
      mockHooks();
      const route = createEntryFormRoute({ tripId: 'trip-123' });

      render(<EntryFormScreen navigation={mockNavigation} route={route} />);

      // Find the back button (GlassBackButton) by accessibility label
      const backButton = screen.getByLabelText('Go back');
      fireEvent.press(backButton);

      expect(mockNavigation.goBack).toHaveBeenCalled();
    });
  });

  describe('Save Button', () => {
    it('shows Save Entry button in create mode', () => {
      mockHooks();
      const route = createEntryFormRoute({ tripId: 'trip-123', entryType: 'experience' });

      render(<EntryFormScreen navigation={mockNavigation} route={route} />);

      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(screen.getByTestId('entry-save-button')).toBeTruthy();
      expect(screen.getByText('Save Entry')).toBeTruthy();
    });

    it('shows Save Changes button in edit mode', () => {
      mockHooks({
        entry: createMockEntryWithPlace({ id: 'entry-123', entry_type: 'experience' }),
      });
      const route = createEntryFormRoute({ tripId: 'trip-123', entryId: 'entry-123' });

      render(<EntryFormScreen navigation={mockNavigation} route={route} />);

      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(screen.getByText('Save Changes')).toBeTruthy();
    });
  });

  describe('Photo Section', () => {
    it('shows photo count display', () => {
      mockHooks();
      const route = createEntryFormRoute({ tripId: 'trip-123', entryType: 'place' });

      render(<EntryFormScreen navigation={mockNavigation} route={route} />);

      act(() => {
        jest.advanceTimersByTime(500);
      });

      // Should show photo count like "0/10"
      expect(screen.getByText(/\/10/)).toBeTruthy();
    });
  });
});
