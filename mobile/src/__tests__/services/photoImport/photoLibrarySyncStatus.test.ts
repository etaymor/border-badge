/**
 * Tests for the shared photo-library sync status + freshness rule (P1).
 *
 * The freshness matrix is the contract the Q5 wizard and quiz creation both
 * hang off: fresh only when a recent success exists, permission still
 * matches, and the cache is non-empty; active writers count as fresh-enough;
 * everything else scans.
 */

// In-memory stand-in for the photo-cache metadata table.
const mockMetadataStore = new Map<string, string>();
let mockCachedPhotoCount = 10;

jest.mock('@services/photoImport/photoCacheDb', () => ({
  getMetadata: jest.fn(async (key: string) => mockMetadataStore.get(key) ?? null),
  setMetadata: jest.fn(async (key: string, value: string) => {
    mockMetadataStore.set(key, value);
  }),
  getCachedPhotoCount: jest.fn(async () => mockCachedPhotoCount),
}));

const mockGetPermissions = jest.fn();
jest.mock('expo-media-library', () => ({
  getPermissionsAsync: (...args: []) => mockGetPermissions(...args),
}));

const mockIsScanRunning = jest.fn(() => false);
const mockIsBackgroundSyncFlagSet = jest.fn(() => false);
jest.mock('@services/photoImport/photoScanState', () => ({
  isScanRunning: () => mockIsScanRunning(),
  isBackgroundSyncFlagSet: () => mockIsBackgroundSyncFlagSet(),
}));

import {
  getLibraryFreshness,
  getLibrarySyncStatus,
  recordSyncError,
  recordSyncSuccess,
  LIBRARY_FRESHNESS_MS,
} from '@services/photoImport/photoLibrarySyncStatus';

beforeEach(() => {
  jest.clearAllMocks();
  mockMetadataStore.clear();
  mockCachedPhotoCount = 10;
  mockGetPermissions.mockResolvedValue({ status: 'granted', accessPrivileges: 'all' });
  mockIsScanRunning.mockReturnValue(false);
  mockIsBackgroundSyncFlagSet.mockReturnValue(false);
});

describe('sync status record', () => {
  it('round-trips success and clears any prior error', async () => {
    await recordSyncError('background', new Error('network down'));
    await recordSyncSuccess('quiz', 12);

    const status = await getLibrarySyncStatus();
    expect(status.lastSuccessAt).not.toBeNull();
    expect(status.lastSource).toBe('quiz');
    expect(status.lastNewPhotoCount).toBe(12);
    expect(status.lastError).toBeNull();
    expect(status.lastErrorAt).toBeNull();
    expect(status.permissionFingerprint).toBe('granted');
  });

  it('records errors with a truncated message', async () => {
    await recordSyncError('trip-scan', new Error('x'.repeat(300)));

    const status = await getLibrarySyncStatus();
    expect(status.lastError).toHaveLength(100);
    expect(status.lastErrorAt).not.toBeNull();
    expect(status.lastSource).toBe('trip-scan');
  });

  it('tolerates corrupt persisted JSON', async () => {
    mockMetadataStore.set('photo_library_sync_status', '{not json');

    const status = await getLibrarySyncStatus();
    expect(status.lastSuccessAt).toBeNull();
  });
});

describe('freshness matrix', () => {
  it('is fresh right after a successful sync', async () => {
    await recordSyncSuccess('background', 3);

    const freshness = await getLibraryFreshness();
    expect(freshness).toMatchObject({ fresh: true, reason: 'synced-recently' });
  });

  it('goes stale once the window elapses', async () => {
    await recordSyncSuccess('background', 3);
    const status = await getLibrarySyncStatus();
    mockMetadataStore.set(
      'photo_library_sync_status',
      JSON.stringify({ ...status, lastSuccessAt: Date.now() - LIBRARY_FRESHNESS_MS - 1000 })
    );

    const freshness = await getLibraryFreshness();
    expect(freshness).toMatchObject({ fresh: false, reason: 'stale' });
  });

  it('is never fresh before the first sync', async () => {
    const freshness = await getLibraryFreshness();
    expect(freshness).toMatchObject({ fresh: false, reason: 'never-synced' });
  });

  it('is never fresh with an empty cache, even after a success', async () => {
    await recordSyncSuccess('background', 0);
    mockCachedPhotoCount = 0;

    const freshness = await getLibraryFreshness();
    expect(freshness).toMatchObject({ fresh: false, reason: 'never-synced' });
  });

  it('invalidates on a permission flip (limited <-> granted)', async () => {
    await recordSyncSuccess('background', 3);
    mockGetPermissions.mockResolvedValue({ status: 'granted', accessPrivileges: 'limited' });

    const freshness = await getLibraryFreshness();
    expect(freshness).toMatchObject({ fresh: false, reason: 'permission-changed' });
  });

  it('reports no-permission without ever prompting', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'denied' });

    const freshness = await getLibraryFreshness();
    expect(freshness).toMatchObject({ fresh: false, reason: 'no-permission' });
  });

  it('treats an active writer as fresh-enough', async () => {
    mockIsScanRunning.mockReturnValue(true);

    const freshness = await getLibraryFreshness();
    expect(freshness).toMatchObject({ fresh: true, reason: 'writer-active' });
  });

  it('a forced check (maxStalenessMs 0) reads recent successes as stale', async () => {
    await recordSyncSuccess('background', 3);

    const freshness = await getLibraryFreshness(0);
    expect(freshness).toMatchObject({ fresh: false, reason: 'stale' });
  });
});
