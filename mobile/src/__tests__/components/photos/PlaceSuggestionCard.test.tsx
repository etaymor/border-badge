/**
 * Tests for PlaceSuggestionCard.
 *
 * Covers the override redesign:
 *  - the override action uses the pencil ('pencil') icon
 *  - the alternatives strip appears on the photo when there are multiple options
 *  - confirm/reject callbacks forward decision metadata used by photo_import evals
 */

/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { PlaceSuggestionCard } from '../../../screens/photos/components/PlaceSuggestionCard';
import type { ClusterSuggestion, PlaceSuggestion } from '../../../services/photoImport';

jest.mock('expo-image', () => {
  const mockReact = require('react');
  return {
    Image: ({ style }: { style: unknown }) =>
      mockReact.createElement('Image', { style, testID: 'hero-image' }),
  };
});

const buildPlace = (overrides: Partial<PlaceSuggestion> = {}): PlaceSuggestion => ({
  place_id: 'ChIJ_default',
  name: 'A Place',
  address: '1 Default St',
  location: { latitude: 0, longitude: 0 },
  category: 'place',
  distance_m: 10,
  types: ['point_of_interest'],
  ...overrides,
});

const buildSuggestion = (
  places: PlaceSuggestion[],
  clusterId = 'cluster-x'
): ClusterSuggestion => ({
  cluster_id: clusterId,
  photo_ids: ['p1'],
  places,
});

describe('PlaceSuggestionCard', () => {
  it('renders the pencil icon for the override action', () => {
    const onConfirm = jest.fn();
    const onReject = jest.fn();
    const { UNSAFE_getAllByProps } = render(
      <PlaceSuggestionCard
        suggestion={buildSuggestion([buildPlace()])}
        previewUris={['https://example.com/p1.jpg']}
        onConfirm={onConfirm}
        onReject={onReject}
        onPhotoPress={jest.fn()}
      />
    );

    const pencilIcons = UNSAFE_getAllByProps({ name: 'pencil' });
    expect(pencilIcons.length).toBeGreaterThan(0);
  });

  it('forwards rank, alternatives_count, and alternatives_viewed on confirm of the top suggestion', () => {
    const onConfirm = jest.fn();
    const onReject = jest.fn();
    const top = buildPlace({ place_id: 'ChIJ_top', name: 'Top' });
    const alt = buildPlace({ place_id: 'ChIJ_alt', name: 'Alt' });

    const { getByLabelText } = render(
      <PlaceSuggestionCard
        suggestion={buildSuggestion([top, alt])}
        previewUris={['https://example.com/p1.jpg']}
        onConfirm={onConfirm}
        onReject={onReject}
        onPhotoPress={jest.fn()}
      />
    );

    fireEvent.press(getByLabelText('Confirm place suggestion'));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ cluster_id: 'cluster-x' }),
      expect.objectContaining({ place_id: 'ChIJ_top' }),
      { suggested_rank: 1, alternatives_count: 2, alternatives_viewed: 1 }
    );
  });

  it('counts cycled alternatives and forwards the on-screen place when confirming', () => {
    const onConfirm = jest.fn();
    const onReject = jest.fn();
    const top = buildPlace({ place_id: 'ChIJ_top', name: 'Top' });
    const alt = buildPlace({ place_id: 'ChIJ_alt', name: 'Alt' });

    const { getByLabelText } = render(
      <PlaceSuggestionCard
        suggestion={buildSuggestion([top, alt])}
        previewUris={['https://example.com/p1.jpg']}
        onConfirm={onConfirm}
        onReject={onReject}
        onPhotoPress={jest.fn()}
      />
    );

    fireEvent.press(getByLabelText('Next suggestion'));
    fireEvent.press(getByLabelText('Confirm place suggestion'));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ place_id: 'ChIJ_alt' }),
      { suggested_rank: 2, alternatives_count: 2, alternatives_viewed: 2 }
    );
  });

  it('forwards meta on reject (override) using the place currently on screen', () => {
    const onConfirm = jest.fn();
    const onReject = jest.fn();
    const top = buildPlace({ place_id: 'ChIJ_top', name: 'Top' });

    const { getByLabelText } = render(
      <PlaceSuggestionCard
        suggestion={buildSuggestion([top])}
        previewUris={['https://example.com/p1.jpg']}
        onConfirm={onConfirm}
        onReject={onReject}
        onPhotoPress={jest.fn()}
      />
    );

    fireEvent.press(getByLabelText('Edit place suggestion'));

    expect(onReject).toHaveBeenCalledWith(expect.objectContaining({ cluster_id: 'cluster-x' }), {
      suggested_rank: 1,
      alternatives_count: 1,
      alternatives_viewed: 1,
    });
  });

  it('hides the alternatives strip when there is only one option', () => {
    const { queryByLabelText } = render(
      <PlaceSuggestionCard
        suggestion={buildSuggestion([buildPlace()])}
        previewUris={['https://example.com/p1.jpg']}
        onConfirm={jest.fn()}
        onReject={jest.fn()}
        onPhotoPress={jest.fn()}
      />
    );

    expect(queryByLabelText('Next suggestion')).toBeNull();
    expect(queryByLabelText('Previous suggestion')).toBeNull();
  });

  it('keeps chevrons responsive across re-renders (post-save tap regression)', () => {
    // Reproduces the "after saving a place, chevrons stop responding" bug:
    // the parent re-renders but does not unmount surviving cards. Simulate
    // that by rerendering with new prop identities and verify the chevron
    // taps still cycle the index forward.
    const top = buildPlace({ place_id: 'ChIJ_top', name: 'Top' });
    const alt = buildPlace({ place_id: 'ChIJ_alt', name: 'Alt' });
    const onConfirm = jest.fn();

    const { getByLabelText, rerender } = render(
      <PlaceSuggestionCard
        suggestion={buildSuggestion([top, alt])}
        previewUris={['https://example.com/p1.jpg']}
        onConfirm={onConfirm}
        onReject={jest.fn()}
        onPhotoPress={jest.fn()}
      />
    );

    // Re-render with fresh callback identities (mimicking parent state churn
    // after a sibling save) — same suggestion object so local state survives.
    rerender(
      <PlaceSuggestionCard
        suggestion={buildSuggestion([top, alt])}
        previewUris={['https://example.com/p1.jpg']}
        onConfirm={onConfirm}
        onReject={jest.fn()}
        onPhotoPress={jest.fn()}
      />
    );

    fireEvent.press(getByLabelText('Next suggestion'));
    fireEvent.press(getByLabelText('Confirm place suggestion'));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ place_id: 'ChIJ_alt' }),
      expect.objectContaining({ suggested_rank: 2 })
    );
  });

  it('resets the alternatives index when FlashList recycles the cell into a new cluster', () => {
    const onConfirm = jest.fn();
    const three = [
      buildPlace({ place_id: 'ChIJ_1', name: 'First' }),
      buildPlace({ place_id: 'ChIJ_2', name: 'Second' }),
      buildPlace({ place_id: 'ChIJ_3', name: 'Third' }),
    ];

    const { getByLabelText, getByText, rerender } = render(
      <PlaceSuggestionCard
        suggestion={buildSuggestion(three, 'cluster-a')}
        previewUris={['https://example.com/p1.jpg']}
        onConfirm={onConfirm}
        onReject={jest.fn()}
        onPhotoPress={jest.fn()}
      />
    );

    // Cycle to the 3rd of 3 options.
    fireEvent.press(getByLabelText('Next suggestion'));
    fireEvent.press(getByLabelText('Next suggestion'));
    expect(getByText('3 of 3 options')).toBeTruthy();

    // FlashList hands this pooled cell to a cluster with only ONE option, without
    // remounting. A leaked index of 2 would read past `places` and render nothing.
    const one = [buildPlace({ place_id: 'ChIJ_only', name: 'Only Place' })];
    rerender(
      <PlaceSuggestionCard
        suggestion={buildSuggestion(one, 'cluster-b')}
        previewUris={['https://example.com/p2.jpg']}
        onConfirm={onConfirm}
        onReject={jest.fn()}
        onPhotoPress={jest.fn()}
      />
    );

    expect(getByText('Only Place')).toBeTruthy();

    // And the decision metadata restarts at rank 1 rather than inheriting rank 3.
    fireEvent.press(getByLabelText('Confirm place suggestion'));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ place_id: 'ChIJ_only' }),
      expect.objectContaining({ suggested_rank: 1, alternatives_viewed: 1 })
    );
  });
});
