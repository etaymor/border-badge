/**
 * Tests for `useWorkflowAnalytics` (U11).
 *
 * Two things are under test here:
 *
 *  1. The exit measurement surface — the fraction of clusters ever scrolled
 *     into view, and the settled-versus-enqueued split read off the dispatch
 *     controller at departure.
 *  2. The re-anchored ad conversion. Its old trigger required EVERY cluster to
 *     be confirmed, rejected or hidden; progressive interaction makes that rare,
 *     so it now rides the first-confirmation-plus-departure signal the review
 *     prompt on this screen already uses, with the lifetime dedupe unchanged.
 *
 * `AdEvents` is deliberately NOT mocked: the "once per lifetime" claim lives in
 * its AsyncStorage flag, and a mocked module would only be testing the mock.
 */

import { renderHook, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppEventsLogger } from 'react-native-fbsdk-next';

jest.mock('@react-native-async-storage/async-storage');

jest.mock('react-native-fbsdk-next', () => ({
  AppEventsLogger: {
    logEvent: jest.fn(),
    logPurchase: jest.fn(),
    setUserID: jest.fn(),
    clearUserID: jest.fn(),
  },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'mock-uuid-abcd1234'),
}));

jest.mock('@config/env', () => ({
  get isProduction() {
    return true;
  },
}));

jest.mock('@services/api', () => ({
  api: {
    post: jest.fn().mockResolvedValue({ data: { status: 'ok' } }),
  },
}));

jest.mock('@services/analytics', () => ({
  Analytics: {
    photoImportWorkflowCompleted: jest.fn(),
    photoImportWorkflowExited: jest.fn(),
  },
}));

// Imported after the mocks so the real AdEvents picks them up.
import { Analytics } from '@services/analytics';
import { suggestionDispatch } from '@services/photoImport/suggestionDispatch';
import { useWorkflowAnalytics } from '../../../screens/photos/useWorkflowAnalytics';
import type { TripCandidateDisplay } from '@services/photoImport';

const mockAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

/** In-memory AsyncStorage so the lifetime dedupe is genuine across mounts. */
function installAsyncStorage() {
  const store = new Map<string, string>();
  mockAsyncStorage.getItem.mockImplementation(async (key: string) => store.get(key) ?? null);
  mockAsyncStorage.setItem.mockImplementation(async (key: string, value: string) => {
    store.set(key, value);
  });
  return store;
}

const CLUSTER_IDS = ['cl-1', 'cl-2', 'cl-3', 'cl-4'];

const candidate = (clusterIds: string[] = CLUSTER_IDS): TripCandidateDisplay =>
  ({
    id: 'cand-1',
    countryCode: 'JP',
    dateRange: { start: new Date('2024-01-01'), end: new Date('2024-01-05') },
    photoIds: [],
    photoCount: clusterIds.length,
    previewUris: [],
    previewAssetIds: [],
    locationClusterIds: clusterIds,
  }) as unknown as TripCandidateDisplay;

function setup(clusterIds: string[] = CLUSTER_IDS) {
  return renderHook(() =>
    useWorkflowAnalytics({
      phase: 'suggestions',
      selectedCandidate: candidate(clusterIds),
      dismissedClusterIdsInternal: new Set<string>(),
      apiSuggestionsData: undefined,
      cachedSuggestions: [],
    })
  );
}

const exitedProps = () => (Analytics.photoImportWorkflowExited as jest.Mock).mock.calls.at(-1)?.[0];

const photoImportAdEvents = () =>
  (AppEventsLogger.logEvent as jest.Mock).mock.calls.filter(
    (call) => call[0] === 'FirstPhotoImport'
  );

/** Let the fire-and-forget AdEvents promise chain settle. */
const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  installAsyncStorage();
  // The dispatch controller is a module-level singleton (KTD21).
  suggestionDispatch.resetForTests();
});

describe('useWorkflowAnalytics - scrolled-into-view fraction (U11)', () => {
  it('records the fraction of clusters ever scrolled into view', async () => {
    const { result, unmount } = setup();

    act(() => {
      result.current.markClustersViewed(['cl-1', 'cl-2']);
      // Scrolling back over a row must not double-count it.
      result.current.markClustersViewed(['cl-1']);
      result.current.incrementConfirmed();
    });

    unmount();

    expect(exitedProps()).toMatchObject({
      totalClusters: 4,
      viewedClusters: 2,
      viewedClusterRate: 50,
    });
  });

  it('reports zero when the user leaves without any row becoming visible', () => {
    const { result, unmount } = setup();

    act(() => {
      result.current.incrementConfirmed();
    });
    unmount();

    expect(exitedProps()).toMatchObject({ viewedClusters: 0, viewedClusterRate: 0 });
  });
});

describe('useWorkflowAnalytics - concurrency split at exit (U11/R18)', () => {
  it('records the settled-versus-enqueued split and the per-generation retry counts', () => {
    // Four clusters accepted by the controller; one of them attributed a
    // failure, so exactly one has settled.
    suggestionDispatch.claim(CLUSTER_IDS);
    suggestionDispatch.addFailedClusterIds([{ id: 'cl-1', retryDisabled: false }]);
    suggestionDispatch.recordRetryAttempt();
    suggestionDispatch.recordRetryAttempt();

    const { result, unmount } = setup();
    act(() => {
      result.current.incrementConfirmed();
    });
    unmount();

    expect(exitedProps()).toMatchObject({
      enqueuedClusters: 4,
      settledClusters: 1,
      unsettledClusters: 3,
      retryAttempts: 2,
      retryGenerations: 1,
      maxRetryAttemptsPerGeneration: 2,
    });
  });

  it('emits no coordinate, cluster id or place id in any event (R27)', () => {
    suggestionDispatch.claim(CLUSTER_IDS);

    const { result, unmount } = setup();
    act(() => {
      result.current.markClustersViewed(CLUSTER_IDS);
      result.current.incrementConfirmed();
    });
    unmount();

    const serialized = JSON.stringify(exitedProps());
    for (const forbidden of [...CLUSTER_IDS, 'ChIJ', '35.6', '139.7', 'cand-1']) {
      expect(serialized).not.toContain(forbidden);
    }
    // Every value is a plain aggregate.
    for (const value of Object.values(exitedProps())) {
      expect(typeof value).toBe('number');
    }
  });
});

describe('useWorkflowAnalytics - ad conversion re-anchor (U11)', () => {
  it('fires on first confirmation plus departure, without waiting for every cluster', async () => {
    const { result } = setup();

    act(() => {
      result.current.incrementConfirmed();
    });
    // Three of four clusters are still unresolved — the old trigger would never
    // have fired here.
    act(() => {
      result.current.trackDeparture();
    });
    await flush();

    expect(photoImportAdEvents()).toHaveLength(1);
  });

  it('does not fire when the user leaves without confirming anything', async () => {
    const { result, unmount } = setup();

    act(() => {
      result.current.trackDeparture();
    });
    unmount();
    await flush();

    expect(photoImportAdEvents()).toHaveLength(0);
  });

  it('fires once when departure is followed by unmount in the same session', async () => {
    const { result, unmount } = setup();

    act(() => {
      result.current.incrementConfirmed();
      result.current.trackDeparture();
    });
    await flush();
    unmount();
    await flush();

    expect(photoImportAdEvents()).toHaveLength(1);
  });

  it('does not fire twice for a user who returns to the same trip', async () => {
    const first = setup();
    act(() => {
      first.result.current.incrementConfirmed();
      first.result.current.trackDeparture();
    });
    await flush();
    first.unmount();
    await flush();

    // Same user, same trip, second visit.
    const second = setup();
    act(() => {
      second.result.current.incrementConfirmed();
      second.result.current.trackDeparture();
    });
    await flush();
    second.unmount();
    await flush();

    expect(photoImportAdEvents()).toHaveLength(1);
  });

  it('still fires for a workflow that reaches full completion', async () => {
    // The completion effect re-evaluates when the dismissed set changes, which
    // is how the screen drives it.
    const { result, rerender, unmount } = renderHook(
      ({ dismissed }: { dismissed: Set<string> }) =>
        useWorkflowAnalytics({
          phase: 'suggestions',
          selectedCandidate: candidate(['only-1']),
          dismissedClusterIdsInternal: dismissed,
          apiSuggestionsData: undefined,
          cachedSuggestions: [],
        }),
      { initialProps: { dismissed: new Set<string>() } }
    );

    act(() => {
      result.current.incrementConfirmed();
    });
    rerender({ dismissed: new Set(['only-1']) });

    // Every cluster processed, so the completion event fires...
    expect(Analytics.photoImportWorkflowCompleted).toHaveBeenCalled();
    // ...and the conversion no longer rides on it.
    expect(photoImportAdEvents()).toHaveLength(0);

    unmount();
    await flush();

    // Departure still delivers it — a completed workflow leaves too.
    expect(photoImportAdEvents()).toHaveLength(1);
  });
});
