/**
 * Tests for jobDurableFlag - the breadcrumb that survives an app suspend.
 *
 * The legacy-compat cases matter most: they are what keeps an OTA safe in both
 * directions for a user who is mid-scan when the update lands.
 */

import {
  clearDurableJob,
  readDurableJob,
  saveDurableCheckpoint,
  writeDurableJob,
} from '@services/jobs/jobDurableFlag';

const mockMetadata = new Map<string, string>();

jest.mock('@services/photoImport/photoCacheDb', () => ({
  getMetadata: jest.fn(async (key: string) => mockMetadata.get(key) ?? null),
  setMetadata: jest.fn(async (key: string, value: string) => {
    mockMetadata.set(key, value);
  }),
}));

beforeEach(() => {
  mockMetadata.clear();
  jest.clearAllMocks();
});

describe('readDurableJob', () => {
  it('returns null when nothing was in progress', async () => {
    expect(await readDurableJob('trip-scan')).toBeNull();
    expect(await readDurableJob('quiz-build')).toBeNull();
  });

  it('round-trips a written record', async () => {
    await writeDurableJob('quiz-build', { startedAt: 1234, options: { a: 1 } });
    const record = await readDurableJob('quiz-build');
    expect(record).toMatchObject({ v: 1, startedAt: 1234, options: { a: 1 } });
  });

  it('falls back to the legacy trip-scan pair when the new key is absent', async () => {
    // A user who was mid-scan when the runtime OTA landed has only these.
    mockMetadata.set('scan_in_progress', 'true');
    mockMetadata.set('scan_started_at', '999');

    const record = await readDurableJob('trip-scan');
    expect(record).toEqual({ v: 1, startedAt: 999 });
  });

  it('does not apply the legacy fallback to quiz-build', async () => {
    mockMetadata.set('scan_in_progress', 'true');
    expect(await readDurableJob('quiz-build')).toBeNull();
  });

  it('treats a corrupt record as no-job rather than throwing', async () => {
    mockMetadata.set('job:trip-scan:state', '{not json');
    expect(await readDurableJob('trip-scan')).toBeNull();
  });
});

describe('writeDurableJob', () => {
  it('dual-writes the legacy pair for trip-scan so a rollback still resumes', async () => {
    await writeDurableJob('trip-scan', { startedAt: 42 });
    expect(mockMetadata.get('scan_in_progress')).toBe('true');
    expect(mockMetadata.get('scan_started_at')).toBe('42');
  });

  it('does not write legacy keys for quiz-build', async () => {
    await writeDurableJob('quiz-build', { startedAt: 42 });
    expect(mockMetadata.has('scan_in_progress')).toBe(false);
  });
});

describe('clearDurableJob', () => {
  it('flips the legacy flag to false so a rolled-back bundle cannot resurrect a finished scan', async () => {
    await writeDurableJob('trip-scan', { startedAt: 42 });
    await clearDurableJob('trip-scan');

    expect(await readDurableJob('trip-scan')).toBeNull();
    expect(mockMetadata.get('scan_in_progress')).toBe('false');
  });
});

describe('saveDurableCheckpoint', () => {
  it('updates the checkpoint while preserving startedAt and options', async () => {
    await writeDurableJob('quiz-build', { startedAt: 7, options: { entry: 'intro' } });
    await saveDurableCheckpoint('quiz-build', { stage: 'hunt', picks: ['a', 'b'] });

    const record = await readDurableJob('quiz-build');
    expect(record).toMatchObject({
      startedAt: 7,
      options: { entry: 'intro' },
      checkpoint: { stage: 'hunt', picks: ['a', 'b'] },
    });
  });

  it('is a no-op when no job is in progress', async () => {
    await saveDurableCheckpoint('quiz-build', { stage: 'hunt' });
    expect(await readDurableJob('quiz-build')).toBeNull();
  });
});

describe('lastCheckpointAt', () => {
  it('is stamped by saveDurableCheckpoint and read back', async () => {
    const realNow = Date.now;
    Date.now = () => 1_000_000;
    try {
      await writeDurableJob('quiz-build', { startedAt: 7 });
      await saveDurableCheckpoint('quiz-build', { stage: 'hunt' });
    } finally {
      Date.now = realNow;
    }
    const record = await readDurableJob('quiz-build');
    expect(record?.lastCheckpointAt).toBe(1_000_000);
    expect(record?.startedAt).toBe(7);
  });

  it('legacy records without it still parse, with the field absent', async () => {
    await writeDurableJob('trip-scan', { startedAt: 7, checkpoint: { done: false } });
    const record = await readDurableJob('trip-scan');
    expect(record).toMatchObject({ startedAt: 7, checkpoint: { done: false } });
    expect(record?.lastCheckpointAt).toBeUndefined();
  });
});
