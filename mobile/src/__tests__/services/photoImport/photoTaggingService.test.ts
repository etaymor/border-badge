/**
 * Tagging-pass mechanics, driven through the injected deps seam.
 *
 * That seam exists precisely so these tests can run: photoBackgroundSync
 * resolves its dependencies through a dynamic import() Jest cannot follow,
 * which is why its own test file re-implements the lock inline instead of
 * importing the module. runTaggingPass takes its deps as an argument, so the
 * real pass logic is exercised here rather than a copy of it.
 */

jest.mock('@services/photoImport/photoCacheDb', () => ({
  getMetadata: jest.fn().mockResolvedValue(null),
  setMetadata: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@services/photoImport/photoTagDb', () => ({
  getUntaggedIds: jest.fn(),
  upsertTags: jest.fn(),
  upsertIntentTags: jest.fn(),
  TAGGER_VERSION: 1,
  INTENT_META_VERSION: 1,
}));

jest.mock('@services/photoImport/photoBackgroundSync', () => ({
  isBackgroundSyncInProgress: jest.fn(() => false),
}));

jest.mock('@services/jobs/jobRuntimeState', () => ({
  isScanRunning: jest.fn(() => false),
  isAnyLibraryJobRunning: jest.fn(() => false),
}));

import {
  abortTaggingPass,
  INTENT_PASS_TIME_BUDGET_MS,
  isTaggingPassInProgress,
  runIntentPass,
  runTaggingPass,
  TAGGING_PASS_PHOTO_BUDGET,
  TAGGING_PASS_TIME_BUDGET_MS,
  type IntentPassDeps,
  type TaggingPassDeps,
} from '@services/photoImport/photoTaggingService';
import type { PhotoIntentTag, PhotoMlTag } from '@services/photoImport/photoTagDb';

const CHUNK = 32;

function tag(id: string): PhotoMlTag {
  return {
    id,
    taggerVersion: 1,
    status: 'ok',
    isScreenshot: false,
    faceCount: 0,
    maxFaceArea: 0,
    totalFaceArea: 0,
    humanCount: 0,
    maxHumanArea: 0,
    totalHumanArea: 0,
    labels: [],
    aestheticScore: null,
    isUtility: null,
    computedAt: 1,
  };
}

interface Harness {
  deps: TaggingPassDeps;
  committed: string[][];
  taggedChunks: string[][];
  advance(ms: number): void;
}

function makeHarness(overrides: Partial<TaggingPassDeps> & { ids?: string[] } = {}): Harness {
  const ids = overrides.ids ?? Array.from({ length: 100 }, (_, i) => `photo-${i}`);
  const committed: string[][] = [];
  const taggedChunks: string[][] = [];
  let clock = 0;

  const deps: TaggingPassDeps = {
    loadPriorityIds: jest.fn(async () => ids),
    getUntaggedIds: jest.fn(async (ordered: string[]) => ordered),
    tagPhotos: jest.fn(async (chunk: string[]) => {
      taggedChunks.push(chunk);
      return chunk.map(tag);
    }),
    upsertTags: jest.fn(async (tags: PhotoMlTag[]) => {
      committed.push(tags.map((t) => t.id));
    }),
    chunkSize: CHUNK,
    now: () => clock,
    yieldToUI: jest.fn(async () => {}),
    ...overrides,
  };

  return {
    deps,
    committed,
    taggedChunks,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('runTaggingPass', () => {
  it('tags every pending photo in chunks', async () => {
    const harness = makeHarness();

    const result = await runTaggingPass(harness.deps, new AbortController().signal);

    expect(result.stoppedBy).toBe('complete');
    expect(result.tagged).toBe(100);
    expect(harness.taggedChunks.map((c) => c.length)).toEqual([32, 32, 32, 4]);
  });

  it('preserves the caller-supplied priority order', async () => {
    // Coverage where it matters depends entirely on this: the pass must tag the
    // photos quiz creation would reach for FIRST, not an arbitrary slice.
    const ids = ['a', 'b', 'c', 'd'];
    const harness = makeHarness({ ids, chunkSize: 2 });

    await runTaggingPass(harness.deps, new AbortController().signal);

    expect(harness.taggedChunks).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('commits after every chunk so the table is the resume watermark', async () => {
    const harness = makeHarness({ ids: ['a', 'b', 'c'], chunkSize: 1 });

    await runTaggingPass(harness.deps, new AbortController().signal);

    expect(harness.committed).toEqual([['a'], ['b'], ['c']]);
  });

  it('stops at the photo budget', async () => {
    const harness = makeHarness({
      ids: Array.from({ length: TAGGING_PASS_PHOTO_BUDGET * 2 }, (_, i) => `photo-${i}`),
    });

    const result = await runTaggingPass(harness.deps, new AbortController().signal);

    expect(result.stoppedBy).toBe('photo-budget');
    expect(result.tagged).toBeGreaterThanOrEqual(TAGGING_PASS_PHOTO_BUDGET);
    expect(result.tagged).toBeLessThan(TAGGING_PASS_PHOTO_BUDGET + CHUNK);
  });

  it('stops at the time budget even when photos remain', async () => {
    const harness = makeHarness({
      ids: Array.from({ length: 500 }, (_, i) => `photo-${i}`),
    });
    // Each chunk burns a big slice of the wall clock.
    (harness.deps.yieldToUI as jest.Mock).mockImplementation(async () => {
      harness.advance(TAGGING_PASS_TIME_BUDGET_MS / 2);
    });

    const result = await runTaggingPass(harness.deps, new AbortController().signal);

    expect(result.stoppedBy).toBe('time-budget');
    expect(result.tagged).toBeLessThan(500);
  });

  it('stops immediately when aborted mid-pass', async () => {
    const controller = new AbortController();
    const harness = makeHarness({ chunkSize: 10 });
    (harness.deps.tagPhotos as jest.Mock).mockImplementation(async (chunk: string[]) => {
      controller.abort();
      return chunk.map(tag);
    });

    const result = await runTaggingPass(harness.deps, controller.signal);

    expect(result.stoppedBy).toBe('aborted');
    // The chunk that was already in flight still commits - throwing that work
    // away would mean re-tagging it on the next pass for no reason.
    expect(harness.committed).toHaveLength(1);
  });

  it('does not call the tagger at all when aborted before it starts', async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = makeHarness();

    const result = await runTaggingPass(harness.deps, controller.signal);

    expect(result.stoppedBy).toBe('aborted');
    expect(harness.deps.tagPhotos).not.toHaveBeenCalled();
  });

  it('skips a chunk whose native call throws and keeps going', async () => {
    const harness = makeHarness({ ids: ['a', 'b', 'c', 'd'], chunkSize: 2 });
    (harness.deps.tagPhotos as jest.Mock)
      .mockRejectedValueOnce(new Error('vision blew up'))
      .mockImplementation(async (chunk: string[]) => chunk.map(tag));

    const result = await runTaggingPass(harness.deps, new AbortController().signal);

    expect(result.stoppedBy).toBe('complete');
    expect(harness.committed).toEqual([['c', 'd']]);
  });

  it('survives a failed write without ending the pass', async () => {
    const harness = makeHarness({ ids: ['a', 'b'], chunkSize: 1 });
    (harness.deps.upsertTags as jest.Mock)
      .mockRejectedValueOnce(new Error('db locked'))
      .mockResolvedValue(undefined);

    const result = await runTaggingPass(harness.deps, new AbortController().signal);

    expect(result.stoppedBy).toBe('complete');
    expect(result.tagged).toBe(1);
  });

  it('does nothing when the version filter leaves no work', async () => {
    const harness = makeHarness();
    (harness.deps.getUntaggedIds as jest.Mock).mockResolvedValue([]);

    const result = await runTaggingPass(harness.deps, new AbortController().signal);

    expect(result).toMatchObject({ tagged: 0, chunks: 0, stoppedBy: 'complete' });
    expect(harness.deps.tagPhotos).not.toHaveBeenCalled();
  });

  it('re-tags only what getUntaggedIds returns after a version bump', async () => {
    // A TAGGER_VERSION bump surfaces as stale ids coming back from the filter;
    // the pass must not re-tag the whole library to find them.
    const harness = makeHarness({ ids: ['a', 'b', 'c', 'd'], chunkSize: 2 });
    (harness.deps.getUntaggedIds as jest.Mock).mockResolvedValue(['b', 'd']);

    await runTaggingPass(harness.deps, new AbortController().signal);

    expect(harness.taggedChunks).toEqual([['b', 'd']]);
  });

  it('yields to the UI between chunks', async () => {
    const harness = makeHarness({ ids: ['a', 'b', 'c', 'd'], chunkSize: 2 });

    await runTaggingPass(harness.deps, new AbortController().signal);

    expect(harness.deps.yieldToUI).toHaveBeenCalledTimes(2);
  });
});

function intentTag(id: string): PhotoIntentTag {
  return {
    id,
    metaVersion: 1,
    isFavorite: false,
    hasAdjustments: false,
    subtypes: [],
    burstId: null,
    burstIsRepresentative: false,
    sourceUserLibrary: true,
    inUserAlbum: false,
    altitude: null,
    gpsSpeed: null,
    refreshedAt: 1,
  };
}

interface IntentHarness {
  deps: IntentPassDeps;
  committed: string[][];
  advance(ms: number): void;
}

function makeIntentHarness(
  overrides: Partial<IntentPassDeps> & { ids?: string[] } = {}
): IntentHarness {
  const ids = overrides.ids ?? Array.from({ length: 10 }, (_, i) => `photo-${i}`);
  const committed: string[][] = [];
  let clock = 0;

  const deps: IntentPassDeps = {
    loadAllIds: jest.fn(async () => ids),
    getStaleIds: jest.fn(async (ordered: string[]) => ordered),
    readPhotoMeta: jest.fn(async (chunk: string[]) => chunk.map(intentTag)),
    upsertIntentTags: jest.fn(async (tags: PhotoIntentTag[]) => {
      committed.push(tags.map((t) => t.id));
    }),
    chunkSize: 4,
    now: () => clock,
    yieldToUI: jest.fn(async () => {}),
    ...overrides,
  };

  return {
    deps,
    committed,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('runIntentPass', () => {
  it('resumes into the stale tail instead of re-reading fresh rows', async () => {
    // A prior time-budgeted sweep already refreshed photo-0..photo-5; the
    // staleness filter must make this sweep start at the tail.
    const harness = makeIntentHarness({
      getStaleIds: jest.fn(async (ordered: string[]) => ordered.slice(6)),
    });

    const result = await runIntentPass(harness.deps, new AbortController().signal);

    expect(result.tagged).toBe(4);
    expect(harness.committed).toEqual([['photo-6', 'photo-7', 'photo-8', 'photo-9']]);
  });

  it('sweeps every id and commits after every chunk', async () => {
    const harness = makeIntentHarness();

    const result = await runIntentPass(harness.deps, new AbortController().signal);

    expect(result.stoppedBy).toBe('complete');
    expect(result.tagged).toBe(10);
    // Per-chunk commits are what let an interrupted sweep keep finished work.
    expect(harness.committed).toEqual([
      ['photo-0', 'photo-1', 'photo-2', 'photo-3'],
      ['photo-4', 'photo-5', 'photo-6', 'photo-7'],
      ['photo-8', 'photo-9'],
    ]);
  });

  it('stops when aborted mid-pass but keeps the in-flight chunk', async () => {
    const controller = new AbortController();
    const harness = makeIntentHarness();
    (harness.deps.readPhotoMeta as jest.Mock).mockImplementation(async (chunk: string[]) => {
      controller.abort();
      return chunk.map(intentTag);
    });

    const result = await runIntentPass(harness.deps, controller.signal);

    expect(result.stoppedBy).toBe('aborted');
    expect(harness.committed).toHaveLength(1);
  });

  it('stops at the time budget even when ids remain', async () => {
    const harness = makeIntentHarness({
      ids: Array.from({ length: 100 }, (_, i) => `photo-${i}`),
    });
    (harness.deps.yieldToUI as jest.Mock).mockImplementation(async () => {
      harness.advance(INTENT_PASS_TIME_BUDGET_MS / 2);
    });

    const result = await runIntentPass(harness.deps, new AbortController().signal);

    expect(result.stoppedBy).toBe('time-budget');
    expect(result.tagged).toBeLessThan(100);
  });

  it('does not report complete when every chunk fails to read', async () => {
    // A persistent native failure is not "nothing left to do": reporting
    // complete would stamp the 24h window and silence the sweep for a day.
    const harness = makeIntentHarness();
    (harness.deps.readPhotoMeta as jest.Mock).mockRejectedValue(new Error('bridge down'));

    const result = await runIntentPass(harness.deps, new AbortController().signal);

    expect(result.stoppedBy).toBe('incomplete');
    expect(result.tagged).toBe(0);
  });

  it('does not report complete when every write fails', async () => {
    const harness = makeIntentHarness();
    (harness.deps.upsertIntentTags as jest.Mock).mockRejectedValue(new Error('db locked'));

    const result = await runIntentPass(harness.deps, new AbortController().signal);

    expect(result.stoppedBy).toBe('incomplete');
    expect(result.tagged).toBe(0);
  });

  it('reports incomplete when only some chunks fail', async () => {
    // Partial progress still leaves stale rows behind, so the window must stay
    // unstamped and the next pass must pick the survivors up.
    const harness = makeIntentHarness();
    (harness.deps.readPhotoMeta as jest.Mock)
      .mockRejectedValueOnce(new Error('one bad chunk'))
      .mockImplementation(async (chunk: string[]) => chunk.map(intentTag));

    const result = await runIntentPass(harness.deps, new AbortController().signal);

    expect(result.stoppedBy).toBe('incomplete');
    expect(result.tagged).toBe(6);
  });

  it('does nothing for an empty library', async () => {
    const harness = makeIntentHarness({ ids: [] });

    const result = await runIntentPass(harness.deps, new AbortController().signal);

    expect(result).toMatchObject({ tagged: 0, chunks: 0, stoppedBy: 'complete' });
    expect(harness.deps.readPhotoMeta).not.toHaveBeenCalled();
    expect(harness.deps.upsertIntentTags).not.toHaveBeenCalled();
  });
});

describe('tagging lock', () => {
  it('reports idle and tolerates an abort with no pass running', () => {
    expect(isTaggingPassInProgress()).toBe(false);
    expect(() => abortTaggingPass()).not.toThrow();
    expect(isTaggingPassInProgress()).toBe(false);
  });
});
