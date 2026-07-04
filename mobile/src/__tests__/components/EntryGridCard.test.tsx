/* eslint-disable @typescript-eslint/no-require-imports */
import { fireEvent, render, screen } from '../utils/testUtils';

// Introspection mock: make every rendered expo-blur BlurView leave a queryable
// marker so we can assert the perf pass removed all live blur stacks (U5).
// The component no longer imports BlurView, so zero markers === zero BlurViews.
jest.mock('expo-blur', () => {
  const mockReact = require('react');
  return {
    BlurView: ({ children, style }: { children?: React.ReactNode; style?: unknown }) =>
      mockReact.createElement('View', { testID: 'blur-view-instance', style }, children),
  };
});

import { EntryGridCard } from '@components/entries/EntryGridCard';
import type { EntryWithPlace } from '@hooks/useEntries';

function makeEntry(overrides: Partial<EntryWithPlace> = {}): EntryWithPlace {
  return {
    id: 'entry-1',
    trip_id: 'trip-1',
    entry_type: 'place',
    title: 'Eiffel Tower',
    notes: null,
    link: null,
    entry_date: null,
    created_at: '2026-01-01T00:00:00Z',
    metadata: null,
    place: null,
    media_files: [],
    ...overrides,
  };
}

describe('EntryGridCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders entry title', () => {
    render(<EntryGridCard entry={makeEntry()} />);

    expect(screen.getByText('Eiffel Tower')).toBeTruthy();
  });

  it('calls onPress when card is tapped', () => {
    const onPress = jest.fn();
    render(<EntryGridCard entry={makeEntry()} onPress={onPress} />);

    fireEvent.press(screen.getByText('Eiffel Tower'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  // U5 perf pass: repeated grid cells must not composite live blur stacks.
  // The title pane, type badge, and media-count badge BlurViews were replaced
  // with translucent solid fills.
  it('renders zero live BlurView instances (no media-count badge)', () => {
    render(<EntryGridCard entry={makeEntry()} />);

    expect(screen.queryAllByTestId('blur-view-instance')).toHaveLength(0);
  });

  it('renders zero live BlurView instances (with media-count badge)', () => {
    const entry = makeEntry({
      media_files: [
        { id: 'm1', url: 'https://example.com/1.jpg' },
        { id: 'm2', url: 'https://example.com/2.jpg' },
      ] as EntryWithPlace['media_files'],
    });

    render(<EntryGridCard entry={entry} />);

    // The media-count badge (4th potential BlurView) is present in this branch.
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryAllByTestId('blur-view-instance')).toHaveLength(0);
  });
});
