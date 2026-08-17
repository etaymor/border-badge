/**
 * Tests for FeedCard and the feedItemConfig registry.
 *
 * Covers:
 * - known activity types render through the registry (incl. trip_updated,
 *   added without touching FeedCard internals)
 * - unknown activity types are default-skipped (render nothing, no crash) —
 *   the standing wire-compat rule
 * - feedKeyExtractor yields stable, index-independent keys (activity_id)
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { FeedCard } from '@components/friends';
import {
  feedItemConfig,
  getFeedItemConfig,
  feedKeyExtractor,
} from '@components/friends/feedItemConfig';
import type { FeedItem } from '@hooks/useSocialHome';

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    activity_id: 'activity-1',
    activity_type: 'country_visited',
    created_at: '2024-01-15T10:00:00Z',
    user: { user_id: 'user-1', username: 'traveler1', avatar_url: null },
    country: { country_id: 'country-1', country_name: 'Japan', country_code: 'JP' },
    entry: null,
    ...overrides,
  };
}

describe('FeedCard', () => {
  it('renders a country_visited card via the registry', () => {
    const { getByText } = render(<FeedCard item={makeItem()} />);

    expect(getByText(/planted a flag in/)).toBeTruthy();
    expect(getByText('Japan')).toBeTruthy();
  });

  it('renders an entry_added card with the entry verb and location', () => {
    const item = makeItem({
      activity_id: 'activity-2',
      activity_type: 'entry_added',
      country: null,
      entry: {
        entry_id: 'entry-1',
        entry_name: 'Ramen Alley',
        entry_type: 'food',
        location_name: 'Sapporo',
        image_url: null,
      },
    });
    const { getByText } = render(<FeedCard item={item} />);

    expect(getByText(/discovered/)).toBeTruthy();
    expect(getByText('Ramen Alley')).toBeTruthy();
    expect(getByText('Sapporo')).toBeTruthy();
  });

  it('renders trip_updated via the registry without FeedCard changes', () => {
    const item = makeItem({
      activity_id: 'activity-3',
      activity_type: 'trip_updated',
    });
    const { getByText } = render(<FeedCard item={item} />);

    expect(getByText(/updated their trip in/)).toBeTruthy();
    expect(getByText('Japan')).toBeTruthy();
  });

  it('renders trip_updated without a country using the bare verb', () => {
    const item = makeItem({
      activity_id: 'activity-4',
      activity_type: 'trip_updated',
      country: null,
    });
    const { getByText } = render(<FeedCard item={item} />);

    expect(getByText(/updated their trip/)).toBeTruthy();
  });

  it('default-skips unknown activity types: renders nothing and does not crash', () => {
    const item = makeItem({
      activity_id: 'activity-5',
      activity_type: 'group_trip_started', // future server type this build does not know
    });

    const { toJSON, queryByText } = render(<FeedCard item={item} />);

    expect(toJSON()).toBeNull();
    expect(queryByText('traveler1')).toBeNull();
  });
});

describe('feedItemConfig registry', () => {
  it('has entries for all known activity types', () => {
    expect(Object.keys(feedItemConfig).sort()).toEqual([
      'country_visited',
      'entry_added',
      'trip_updated',
    ]);
  });

  it('returns undefined for unknown types (callers must skip)', () => {
    expect(getFeedItemConfig(makeItem({ activity_type: 'nope' }))).toBeUndefined();
  });
});

describe('feedKeyExtractor', () => {
  it('keys by activity_id, independent of list position', () => {
    const items = [
      makeItem({ activity_id: 'a1' }),
      makeItem({ activity_id: 'a2' }),
      makeItem({ activity_id: 'a3' }),
    ];
    const keysBefore = items.map((item) => feedKeyExtractor(item));

    // Pull-to-refresh prepends fresh items; existing items shift index but
    // must keep the same keys so their cards are not remounted.
    const refreshed = [makeItem({ activity_id: 'new-1' }), ...items];
    const keysAfter = refreshed.map((item) => feedKeyExtractor(item));

    expect(keysAfter.slice(1)).toEqual(keysBefore);
    expect(keysBefore).toEqual(['a1', 'a2', 'a3']);
    expect(new Set(keysAfter).size).toBe(keysAfter.length);
  });

  it('falls back to type+timestamp for pre-U4 cached items without activity_id', () => {
    const legacy = makeItem();
    delete (legacy as Partial<FeedItem>).activity_id;

    expect(feedKeyExtractor(legacy)).toBe('country_visited-2024-01-15T10:00:00Z');
  });
});
