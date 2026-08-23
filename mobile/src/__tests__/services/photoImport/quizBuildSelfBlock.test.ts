/**
 * The reported bug: a fresh install, permission just granted, tap "Build My
 * Challenge" -> immediate "Not Enough Photos Yet", even with qualifying
 * travel photos on the device.
 *
 * Root cause: `jobRuntime` marks a job's own kind running (jobRuntimeState's
 * shared writer lock) BEFORE that job's work starts. The quiz-build job's own
 * work calls `ensureFreshLibrary`, which reads that same lock to decide
 * whether some other writer already owns the cache. Without excluding its own
 * kind, quiz-build always sees itself as an active writer and defers - on a
 * first build the cache is empty, so the scan that should run never does.
 */

import * as MediaLibrary from 'expo-media-library';

import { ensureFreshLibrary } from '@services/photoImport/photoBackgroundSync';
import { _setJobRunning, __resetJobRuntimeStateForTesting } from '@services/jobs/jobRuntimeState';

jest.mock('expo-media-library', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getAssetsAsync: jest.fn(),
  getAssetInfoAsync: jest.fn(),
}));

jest.mock('@services/photoImport/photoCacheDb', () => ({
  getLastImportTime: jest.fn().mockResolvedValue(null),
  setLastImportTime: jest.fn().mockResolvedValue(undefined),
  cachePhotos: jest.fn().mockResolvedValue(undefined),
  getCachedPhotoCount: jest.fn().mockResolvedValue(0),
  getMetadata: jest.fn().mockResolvedValue(null),
  setMetadata: jest.fn().mockResolvedValue(undefined),
}));

const mockGetPermissionsAsync = MediaLibrary.getPermissionsAsync as jest.Mock;
const mockRequestPermissionsAsync = MediaLibrary.requestPermissionsAsync as jest.Mock;
const mockGetAssetsAsync = MediaLibrary.getAssetsAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  __resetJobRuntimeStateForTesting();
  mockGetPermissionsAsync.mockResolvedValue({ status: 'granted', accessPrivileges: 'all' });
  mockRequestPermissionsAsync.mockResolvedValue({ status: 'granted', accessPrivileges: 'all' });
  mockGetAssetsAsync.mockResolvedValue({ assets: [], totalCount: 0, hasNextPage: false });
});

describe('ensureFreshLibrary vs. the calling job\'s own "running" flag', () => {
  it('never scans when the caller does not exclude its own job kind (the bug)', async () => {
    // jobRuntime marks 'quiz-build' running before the job's work - which
    // calls ensureFreshLibrary - even starts.
    _setJobRunning('quiz-build', true);

    const result = await ensureFreshLibrary({ source: 'quiz' });

    // Buggy behavior: the job reads itself as an active writer and defers
    // without ever running the scan, on an empty first-build cache.
    expect(result.status).toBe('deferred');
    expect(mockGetAssetsAsync).not.toHaveBeenCalled();
  });

  it('attempts a real refresh (not a self-block) when the caller excludes its own job kind (the fix)', async () => {
    _setJobRunning('quiz-build', true);

    const result = await ensureFreshLibrary({ source: 'quiz', excludeKind: 'quiz-build' });

    // The extract loop's lazy `await import('./photoImportService')` cannot
    // resolve under this project's Jest config (a pre-existing limitation -
    // see photoBackgroundSync.test.ts's own note on testing this path), so it
    // surfaces as a 'failed' refresh rather than 'refreshed' here. What this
    // proves is the one thing the fix is about: it did NOT read its own
    // 'quiz-build' flag as an active writer and defer without even trying.
    expect(result.status).not.toBe('deferred');
  });

  it('still defers to a genuinely different active writer even with excludeKind set', async () => {
    _setJobRunning('trip-scan', true);

    const result = await ensureFreshLibrary({ source: 'quiz', excludeKind: 'quiz-build' });

    expect(result.status).toBe('deferred');
    expect(mockGetAssetsAsync).not.toHaveBeenCalled();
  });
});
