/**
 * The scheduler half of the intent sweep: which outcomes are allowed to stamp
 * the daily watermark.
 *
 * The resume guarantee lives here, not in `runIntentPass` - the sweep only
 * reports how it ended. Stamping on an outcome that did not finish the library
 * strands the tail for a full day, and nothing downstream can tell that apart
 * from a sweep that legitimately found nothing stale, so the branch is locked
 * by test rather than reasoned about.
 *
 * These drive `runIntentSweepWithWindow` rather than `maybeRunTaggingPass`:
 * the entry point resolves the native module through a dynamic import() Jest
 * cannot follow (it throws ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG), which
 * is exactly why the stamp branch was carved out behind an injectable seam.
 */

jest.mock('@config/features', () => ({
  features: { enablePhotoTagging: true, enableIntentSignals: true },
}));

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
  INTENT_PASS_MIN_INTERVAL_MS,
  INTENT_PASS_TIME_BUDGET_MS,
  runIntentSweepWithWindow,
  type IntentPassDeps,
} from '@services/photoImport/photoTaggingService';
import { getMetadata, setMetadata } from '@services/photoImport/photoCacheDb';
import type { PhotoIntentTag } from '@services/photoImport/photoTagDb';

const LAST_INTENT_PASS_KEY = 'last_intent_pass_at';

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

interface Harness {
  deps: IntentPassDeps;
  advance(ms: number): void;
}

function makeHarness(overrides: Partial<IntentPassDeps> & { ids?: string[] } = {}): Harness {
  const ids = overrides.ids ?? Array.from({ length: 10 }, (_, i) => `photo-${i}`);
  let clock = 0;

  const deps: IntentPassDeps = {
    loadAllIds: jest.fn(async () => ids),
    getStaleIds: jest.fn(async (ordered: string[]) => ordered),
    readPhotoMeta: jest.fn(async (chunk: string[]) => chunk.map(intentTag)),
    upsertIntentTags: jest.fn(async () => {}),
    chunkSize: 4,
    now: () => clock,
    yieldToUI: jest.fn(async () => {}),
    ...overrides,
  };

  return {
    deps,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function stampedWindow(): boolean {
  return (setMetadata as jest.Mock).mock.calls.some(([key]) => key === LAST_INTENT_PASS_KEY);
}

describe('runIntentSweepWithWindow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getMetadata as jest.Mock).mockResolvedValue(null);
  });

  it('stamps the window when the sweep finishes the library', async () => {
    const harness = makeHarness();

    const result = await runIntentSweepWithWindow(harness.deps, new AbortController().signal);

    expect(result?.stoppedBy).toBe('complete');
    expect(stampedWindow()).toBe(true);
  });

  it('stamps the window when there was nothing stale to sweep', async () => {
    const harness = makeHarness({ ids: [] });

    await runIntentSweepWithWindow(harness.deps, new AbortController().signal);

    expect(stampedWindow()).toBe(true);
  });

  it('leaves the window unstamped when every chunk fails', async () => {
    // The failure this test exists for: a persistent bridge error used to look
    // like a finished sweep, silencing the library for 24h with zero rows read.
    const harness = makeHarness();
    (harness.deps.readPhotoMeta as jest.Mock).mockRejectedValue(new Error('bridge down'));

    const result = await runIntentSweepWithWindow(harness.deps, new AbortController().signal);

    expect(result?.stoppedBy).toBe('incomplete');
    expect(stampedWindow()).toBe(false);
  });

  it('leaves the window unstamped when a write fails partway', async () => {
    const harness = makeHarness();
    (harness.deps.upsertIntentTags as jest.Mock).mockRejectedValueOnce(new Error('db locked'));

    await runIntentSweepWithWindow(harness.deps, new AbortController().signal);

    expect(stampedWindow()).toBe(false);
  });

  it('leaves the window unstamped when the sweep runs out of time', async () => {
    const harness = makeHarness({ ids: Array.from({ length: 100 }, (_, i) => `photo-${i}`) });
    (harness.deps.yieldToUI as jest.Mock).mockImplementation(async () => {
      harness.advance(INTENT_PASS_TIME_BUDGET_MS / 2);
    });

    const result = await runIntentSweepWithWindow(harness.deps, new AbortController().signal);

    expect(result?.stoppedBy).toBe('time-budget');
    expect(stampedWindow()).toBe(false);
  });

  it('leaves the window unstamped when the sweep is aborted', async () => {
    const controller = new AbortController();
    const harness = makeHarness();
    (harness.deps.readPhotoMeta as jest.Mock).mockImplementation(async (chunk: string[]) => {
      controller.abort();
      return chunk.map(intentTag);
    });

    const result = await runIntentSweepWithWindow(harness.deps, controller.signal);

    expect(result?.stoppedBy).toBe('aborted');
    expect(stampedWindow()).toBe(false);
  });

  it('does not sweep at all when the window is still fresh', async () => {
    (getMetadata as jest.Mock).mockResolvedValue(
      (Date.now() - INTENT_PASS_MIN_INTERVAL_MS / 2).toString()
    );
    const harness = makeHarness();

    const result = await runIntentSweepWithWindow(harness.deps, new AbortController().signal);

    expect(result).toBeNull();
    expect(harness.deps.loadAllIds).not.toHaveBeenCalled();
    expect(stampedWindow()).toBe(false);
  });

  it('does not sweep when the pass was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const harness = makeHarness();

    expect(await runIntentSweepWithWindow(harness.deps, controller.signal)).toBeNull();
    expect(harness.deps.loadAllIds).not.toHaveBeenCalled();
  });
});
