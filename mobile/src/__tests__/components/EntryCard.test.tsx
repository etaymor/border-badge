import { render, screen } from '../utils/testUtils';
import {
  createMockEntryWithPlace,
  createMockMediaFile,
  createMockPlace,
} from '../utils/mockFactories';

import { EntryCard } from '@components/entries/EntryCard';

const EXPO_IMAGE_HOST = 'ViewManagerAdapter_ExpoImage';

function getImageUri(element: { props: Record<string, unknown> }): string | undefined {
  const source = element.props.source;
  if (Array.isArray(source)) {
    return (source[0] as { uri?: string })?.uri;
  }
  return (source as { uri?: string })?.uri;
}

describe('EntryCard', () => {
  it('renders the thumbnail as an expo-image with recycling + cache props', () => {
    const entry = createMockEntryWithPlace({
      media_files: [
        createMockMediaFile({
          thumbnail_url: 'https://cdn/thumb.jpg',
          url: 'https://cdn/full.jpg',
        }),
      ],
    });

    render(<EntryCard entry={entry} />);

    const image = screen.getByTestId('entry-card-image');
    expect(image.type).toBe(EXPO_IMAGE_HOST);
    expect(image.props.contentFit).toBe('cover');
    expect(image.props.recyclingKey).toBe(entry.id);
    expect(image.props.cachePolicy).toBe('memory-disk');
    // Explicit thumbnail dimensions preserved.
    expect(image.props.style).toEqual(expect.objectContaining({ width: 56, height: 56 }));
    expect(getImageUri(image)).toBe('https://cdn/thumb.jpg');
  });

  it('falls back to social thumbnail then google photo when there is no user media', () => {
    const entry = createMockEntryWithPlace({
      media_files: [],
      place: createMockPlace({ google_photo_url: 'https://places.googleapis.com/photo.jpg' }),
      metadata: { thumbnail_url: 'https://social/thumb.jpg' },
    });

    render(<EntryCard entry={entry} />);

    // Social thumbnail wins over google photo when no user media.
    expect(getImageUri(screen.getByTestId('entry-card-image'))).toBe('https://social/thumb.jpg');
  });

  it('does not render a thumbnail when there is no media', () => {
    const entry = createMockEntryWithPlace({
      media_files: [],
      place: createMockPlace({ google_photo_url: null }),
      metadata: null,
    });

    render(<EntryCard entry={entry} />);

    expect(screen.queryByTestId('entry-card-image')).toBeNull();
  });
});
