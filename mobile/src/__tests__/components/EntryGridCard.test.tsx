/* eslint-disable @typescript-eslint/no-require-imports */
import { fireEvent, render, screen } from '../utils/testUtils';
import {
  createMockEntryWithPlace,
  createMockMediaFile,
  createMockPlace,
} from '../utils/mockFactories';

// Introspection mock (U5): make every rendered expo-blur BlurView leave a
// queryable marker so we can assert the perf pass removed all live blur stacks.
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

// expo-image renders a native host component ("ViewManagerAdapter_ExpoImage").
// The presence of expo-image-only props (contentFit / cachePolicy / recyclingKey)
// proves the render was converted off RN Image, which has none of these (U7).
const EXPO_IMAGE_HOST = 'ViewManagerAdapter_ExpoImage';

/**
 * Extract the resolved `uri` from an expo-image `source` prop.
 * expo-image normalizes `source={{ uri }}` to `[{ uri }]`.
 */
function getImageUri(element: { props: { source: unknown } }): string | undefined {
  const source = element.props.source;
  if (Array.isArray(source)) {
    return (source[0] as { uri?: string })?.uri;
  }
  return (source as { uri?: string })?.uri;
}

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

  // U7 perf pass: the thumbnail decodes at display size via expo-image.
  it('renders the thumbnail as an expo-image with an explicit sized style', () => {
    const entry = createMockEntryWithPlace({
      media_files: [createMockMediaFile({ url: 'https://cdn/full.jpg', thumbnail_url: null })],
    });

    render(<EntryGridCard entry={entry} />);

    const image = screen.getByTestId('entry-grid-card-image');
    // expo-image host element (not RN Image)
    expect(image.type).toBe(EXPO_IMAGE_HOST);
    // measurable size (style gives 100% width/height inside a sized aspect-ratio container)
    expect(image.props.style).toEqual(expect.objectContaining({ width: '100%', height: '100%' }));
    expect(image.props.contentFit).toBe('cover');
    expect(image.props.recyclingKey).toBe(entry.id);
    expect(image.props.cachePolicy).toBe('memory-disk');
  });

  it('prefers user media thumbnail_url over all other sources', () => {
    const entry = createMockEntryWithPlace({
      media_files: [
        createMockMediaFile({
          thumbnail_url: 'https://cdn/thumb.jpg',
          url: 'https://cdn/full.jpg',
        }),
      ],
      place: createMockPlace({ google_photo_url: 'https://google/photo.jpg' }),
      metadata: { thumbnail_url: 'https://social/thumb.jpg' },
    });

    render(<EntryGridCard entry={entry} />);

    expect(getImageUri(screen.getByTestId('entry-grid-card-image'))).toBe('https://cdn/thumb.jpg');
  });

  it('falls back to user media url when thumbnail_url is null', () => {
    const entry = createMockEntryWithPlace({
      media_files: [createMockMediaFile({ thumbnail_url: null, url: 'https://cdn/full.jpg' })],
      place: createMockPlace({ google_photo_url: 'https://google/photo.jpg' }),
    });

    render(<EntryGridCard entry={entry} />);

    expect(getImageUri(screen.getByTestId('entry-grid-card-image'))).toBe('https://cdn/full.jpg');
  });

  it('falls back to google_photo_url when there is no user media', () => {
    const entry = createMockEntryWithPlace({
      media_files: [],
      place: createMockPlace({ google_photo_url: 'https://google/photo.jpg' }),
      metadata: { thumbnail_url: 'https://social/thumb.jpg' },
    });

    render(<EntryGridCard entry={entry} />);

    expect(getImageUri(screen.getByTestId('entry-grid-card-image'))).toBe(
      'https://google/photo.jpg'
    );
  });

  it('falls back to social thumbnail_url when no user media or google photo', () => {
    const entry = createMockEntryWithPlace({
      media_files: [],
      place: createMockPlace({ google_photo_url: null }),
      metadata: { thumbnail_url: 'https://social/thumb.jpg' },
    });

    render(<EntryGridCard entry={entry} />);

    expect(getImageUri(screen.getByTestId('entry-grid-card-image'))).toBe(
      'https://social/thumb.jpg'
    );
  });

  it('renders the icon placeholder (no image) when there is no media at all', () => {
    const entry = createMockEntryWithPlace({
      media_files: [],
      place: createMockPlace({ google_photo_url: null }),
      metadata: null,
    });

    render(<EntryGridCard entry={entry} />);

    expect(screen.queryByTestId('entry-grid-card-image')).toBeNull();
  });
});
