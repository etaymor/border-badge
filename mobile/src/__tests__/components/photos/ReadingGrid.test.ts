import { READING_GRID_TILE_COUNT, placeNextReadingTile } from '@components/photos/ReadingGrid';
import type { ReadingPreview } from '@services/photoImport/scanPreviewPicker';

const preview = (id: number): ReadingPreview => ({
  assetId: `p${id}`,
  uri: `file:///p${id}.jpg`,
  isTravel: false,
});

describe('placeNextReadingTile', () => {
  it('fills every tile exactly once before replacing any', () => {
    let state = {
      tiles: Array.from(
        { length: READING_GRID_TILE_COUNT },
        () => null
      ) as (ReadingPreview | null)[],
      churnCursor: 0,
    };
    for (let id = 0; id < READING_GRID_TILE_COUNT; id += 1) {
      state = {
        ...placeNextReadingTile(state.tiles, preview(id), state.churnCursor),
      } as typeof state;
    }

    expect(state.tiles.every((tile) => tile !== null)).toBe(true);
    expect(new Set(state.tiles.map((tile) => tile?.assetId)).size).toBe(READING_GRID_TILE_COUNT);
    expect(state.churnCursor).toBe(0);
  });

  it('does not fill in reading order', () => {
    const empty = Array.from({ length: READING_GRID_TILE_COUNT }, () => null);
    const { tiles } = placeNextReadingTile(empty, preview(0), 0);

    expect(tiles.findIndex((tile) => tile !== null)).not.toBe(0);
  });

  it('churns a different tile each time once full', () => {
    const full = Array.from({ length: READING_GRID_TILE_COUNT }, (_, index) => preview(index));
    const first = placeNextReadingTile(full, preview(100), 0);
    const second = placeNextReadingTile(first.tiles, preview(101), first.churnCursor);

    const changedFirst = first.tiles.findIndex((tile) => tile?.assetId === 'p100');
    const changedSecond = second.tiles.findIndex((tile) => tile?.assetId === 'p101');
    expect(changedFirst).not.toBe(-1);
    expect(changedSecond).not.toBe(changedFirst);
  });
});
