import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import type { TrackingPreset } from '@constants/trackingPreferences';
import {
  saveLocalUserCountry,
  removeLocalUserCountry,
  clearLocalUserCountries,
  saveHomeCountry,
  clearHomeCountry,
  type LocalUserCountry,
} from '@services/countriesDb';

/**
 * Trailing debounce window (ms) for coalescing persistence side effects.
 *
 * Rapid country taps through onboarding grids collapse into a single trailing
 * AsyncStorage write AND a single batched SQLite sync, instead of one full-store
 * JSON write + one SQLite write per tap. UI state updates stay synchronous — only
 * the persistence side effects are debounced.
 */
export const ONBOARDING_PERSIST_DEBOUNCE_MS = 500;

interface OnboardingState {
  // Existing fields
  motivationTags: string[]; // "Why I Travel" tags
  selectedCountries: string[]; // Visited countries
  currentStep: number;

  // New fields for revised onboarding flow
  personaTags: string[]; // "I Am A..." tags
  homeCountry: string | null; // Country code
  dreamDestination: string | null; // Country code (bucket list seed)
  bucketListCountries: string[]; // Countries added to bucket list during onboarding
  visitedContinents: string[]; // Tracks which continents user said "Yes" to
  displayName: string | null; // User's display name for account creation
  trackingPreference: TrackingPreset; // Country tracking preference
  countryGridTooltipShown: boolean; // Track if card tooltip tutorial has been shown

  // Actions - existing
  setMotivationTags: (tags: string[]) => void;
  toggleMotivationTag: (tag: string) => void;
  setSelectedCountries: (countries: string[]) => void;
  toggleCountry: (countryCode: string) => void;
  setCurrentStep: (step: number) => void;
  reset: () => void;

  // Actions - new
  setPersonaTags: (tags: string[]) => void;
  togglePersonaTag: (tag: string) => void;
  setHomeCountry: (code: string | null) => void;
  setDreamDestination: (code: string | null) => void;
  toggleBucketListCountry: (countryCode: string) => void;
  addVisitedContinent: (region: string) => void;
  removeVisitedContinent: (region: string) => void;
  setDisplayName: (name: string | null) => void;
  setTrackingPreference: (preference: TrackingPreset) => void;
  setCountryGridTooltipShown: (shown: boolean) => void;

  // Persistence control
  flushPersistence: () => Promise<void>;
}

const initialState = {
  motivationTags: [] as string[],
  selectedCountries: [] as string[],
  currentStep: 0,
  personaTags: [] as string[],
  homeCountry: null as string | null,
  dreamDestination: null as string | null,
  bucketListCountries: [] as string[],
  visitedContinents: [] as string[],
  displayName: null as string | null,
  trackingPreference: 'full_atlas' as TrackingPreset,
  countryGridTooltipShown: false,
};

/**
 * Helper to create a LocalUserCountry object for SQLite storage.
 */
function createLocalUserCountry(
  countryCode: string,
  status: 'visited' | 'wishlist'
): LocalUserCountry {
  return {
    id: `local-${status}-${countryCode}`,
    country_code: countryCode,
    status,
    created_at: new Date().toISOString(),
    added_during_onboarding: true,
  };
}

// ---------------------------------------------------------------------------
// Debounced AsyncStorage adapter
// ---------------------------------------------------------------------------

/**
 * Wraps a StateStorage so that `setItem` writes are coalesced onto a single
 * trailing timer. Rapid writes within the debounce window collapse into one
 * final write. `getItem` (rehydration) and `removeItem` are NOT debounced —
 * rehydration reads must be immediate.
 *
 * `flush()` writes any pending value immediately (used on app backgrounding
 * and on onboarding-flow completion to guarantee no data loss).
 */
interface DebouncedStorage extends StateStorage {
  flush: () => Promise<void>;
  __pending: () => boolean;
}

function createDebouncedStorage(base: StateStorage, waitMs: number): DebouncedStorage {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingName: string | null = null;
  let pendingValue: string | null = null;
  // In-flight write promise so flush() can await a coalesced write.
  let inFlight: Promise<void> | null = null;

  const writeNow = (): Promise<void> => {
    if (pendingName === null || pendingValue === null) {
      return Promise.resolve();
    }
    const name = pendingName;
    const value = pendingValue;
    pendingName = null;
    pendingValue = null;
    const write: Promise<void> = Promise.resolve(base.setItem(name, value)).then(
      () => undefined,
      (err) => {
        console.warn('Failed to persist onboarding state:', err);
      }
    );
    inFlight = write.finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await writeNow();
    if (inFlight) {
      await inFlight;
    }
  };

  return {
    getItem: (name) => base.getItem(name),
    setItem: (name, value) => {
      // Coalesce: remember only the latest value; reset the trailing timer.
      pendingName = name;
      pendingValue = value;
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        void writeNow();
      }, waitMs);
    },
    removeItem: (name) => {
      // Drop any pending write for this key, then remove immediately.
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pendingName = null;
      pendingValue = null;
      return base.removeItem(name);
    },
    flush,
    __pending: () => timer !== null || inFlight !== null,
  };
}

/**
 * The debounced AsyncStorage adapter backing the onboarding persist middleware.
 * Exported so tests (and any explicit flush points) can invoke `flush()`.
 */
export const onboardingPersistStorage = createDebouncedStorage(
  AsyncStorage as StateStorage,
  ONBOARDING_PERSIST_DEBOUNCE_MS
);

// ---------------------------------------------------------------------------
// Batched SQLite sync
// ---------------------------------------------------------------------------

/**
 * Pending, net country changes awaiting a batched SQLite flush.
 *
 * Keyed by `${status}:${countryCode}`. Value is the FINAL desired state:
 * `true`  → country should be saved (added),
 * `false` → country should be removed.
 *
 * Toggling a country on then off within the window nets to a no-op: the second
 * toggle either overwrites the pending entry or (if the country was already
 * persisted) leaves an explicit `false` remove. See `queueSQLiteChange`.
 */
type SqliteKey = `visited:${string}` | `wishlist:${string}`;

const pendingSqlite = new Map<
  SqliteKey,
  { countryCode: string; status: SqliteStatus; add: boolean }
>();

type SqliteStatus = 'visited' | 'wishlist';

let sqliteTimer: ReturnType<typeof setTimeout> | null = null;
let sqliteInFlight: Promise<void> | null = null;

function sqliteKey(countryCode: string, status: SqliteStatus): SqliteKey {
  return `${status}:${countryCode}` as SqliteKey;
}

/**
 * Queue a net country change for the next batched SQLite flush.
 *
 * `isAdding` reflects the toggle direction. If a country is toggled on then off
 * (or vice versa) within the debounce window, the LATEST direction wins — the
 * map holds only the final desired state, so an add-then-remove collapses to a
 * single remove (and add-then-remove of a never-persisted country still issues
 * a harmless remove, which `removeLocalUserCountry` treats as a no-op).
 */
function queueSQLiteChange(countryCode: string, status: SqliteStatus, isAdding: boolean): void {
  pendingSqlite.set(sqliteKey(countryCode, status), {
    countryCode,
    status,
    add: isAdding,
  });
  scheduleSQLiteFlush();
}

function scheduleSQLiteFlush(): void {
  if (sqliteTimer) {
    clearTimeout(sqliteTimer);
  }
  sqliteTimer = setTimeout(() => {
    sqliteTimer = null;
    void flushSQLite();
  }, ONBOARDING_PERSIST_DEBOUNCE_MS);
}

/**
 * Apply all pending net country changes to SQLite in one batch, in insertion
 * order. Returns a promise that resolves when every write settles.
 */
function flushSQLite(): Promise<void> {
  if (sqliteTimer) {
    clearTimeout(sqliteTimer);
    sqliteTimer = null;
  }
  if (pendingSqlite.size === 0) {
    return sqliteInFlight ?? Promise.resolve();
  }
  const changes = Array.from(pendingSqlite.values());
  pendingSqlite.clear();

  const work = Promise.all(
    changes.map((change) => {
      if (change.add) {
        return Promise.resolve(
          saveLocalUserCountry(createLocalUserCountry(change.countryCode, change.status))
        ).catch((err) => console.warn('Failed to save country to SQLite:', err));
      }
      return Promise.resolve(removeLocalUserCountry(change.countryCode)).catch((err) =>
        console.warn('Failed to remove country from SQLite:', err)
      );
    })
  ).then(() => undefined);

  sqliteInFlight = work.finally(() => {
    sqliteInFlight = null;
  });
  return sqliteInFlight;
}

/**
 * Immediate, non-batched SQLite sync for single, deliberate country changes
 * (home country / dream destination). These are one-off selections, not grid
 * spamming, so batching them buys nothing.
 */
function syncToSQLiteNow(countryCode: string, status: SqliteStatus, isAdding: boolean): void {
  if (isAdding) {
    saveLocalUserCountry(createLocalUserCountry(countryCode, status)).catch((err) =>
      console.warn('Failed to save country to SQLite:', err)
    );
  } else {
    removeLocalUserCountry(countryCode).catch((err) =>
      console.warn('Failed to remove country from SQLite:', err)
    );
  }
}

/**
 * Test-only: drop all pending batched SQLite changes and cancel the pending
 * flush timer without writing. Lets tests isolate the module-level singletons
 * that persist across cases within a file. Not for production use.
 */
export function __resetOnboardingSQLiteQueueForTests(): void {
  pendingSqlite.clear();
  if (sqliteTimer) {
    clearTimeout(sqliteTimer);
    sqliteTimer = null;
  }
  sqliteInFlight = null;
}

/**
 * Flush ALL pending onboarding persistence side effects immediately:
 * the debounced AsyncStorage write and the batched SQLite sync.
 *
 * Call this at onboarding-flow completion and on app backgrounding to
 * guarantee no data loss. Safe to call when nothing is pending.
 */
export async function flushOnboardingPersistence(): Promise<void> {
  await Promise.all([onboardingPersistStorage.flush(), flushSQLite()]);
}

// Flush on app backgrounding so a pending write is never lost when the OS
// suspends or kills the app. Registered once at module scope. The subscription
// is intentionally never removed (module lives for the app's lifetime); the
// handler is a cheap no-op when nothing is pending, so it is safe in tests.
let appStateSubscription: { remove: () => void } | null = null;

function handleAppStateChange(nextState: AppStateStatus): void {
  if (nextState === 'background' || nextState === 'inactive') {
    void flushOnboardingPersistence();
  }
}

/**
 * Register the AppState listener that flushes pending persistence on
 * background/inactive. Idempotent — safe to call more than once. Exported so
 * tests can control/reset it and assert it does not leak.
 */
export function registerOnboardingPersistenceAppStateListener(): void {
  if (appStateSubscription) return;
  appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
}

/**
 * Tear down the AppState listener. Primarily for tests to avoid leaking the
 * subscription across the suite.
 */
export function unregisterOnboardingPersistenceAppStateListener(): void {
  appStateSubscription?.remove();
  appStateSubscription = null;
}

registerOnboardingPersistenceAppStateListener();

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setMotivationTags: (tags) => set({ motivationTags: tags }),

      toggleMotivationTag: (tag) => {
        const current = get().motivationTags;
        const updated = current.includes(tag)
          ? current.filter((t) => t !== tag)
          : [...current, tag];
        set({ motivationTags: updated });
      },

      setSelectedCountries: (countries) => set({ selectedCountries: countries }),

      toggleCountry: (countryCode) => {
        const current = get().selectedCountries;
        const isAdding = !current.includes(countryCode);
        const updated = isAdding
          ? [...current, countryCode]
          : current.filter((c) => c !== countryCode);
        // UI state updates synchronously; persistence side effects are batched.
        set({ selectedCountries: updated });
        queueSQLiteChange(countryCode, 'visited', isAdding);
      },

      setCurrentStep: (step) => set({ currentStep: step }),

      // New actions
      setPersonaTags: (tags) => set({ personaTags: tags }),

      togglePersonaTag: (tag) => {
        const current = get().personaTags;
        const updated = current.includes(tag)
          ? current.filter((t) => t !== tag)
          : [...current, tag];
        set({ personaTags: updated });
      },

      setHomeCountry: (code) => {
        const prev = get().homeCountry;
        set({ homeCountry: code });
        // Home country is a single, deliberate selection — sync immediately.
        if (prev && prev !== code) {
          // Remove old home country if it was set
          syncToSQLiteNow(prev, 'visited', false);
        }
        if (code) {
          syncToSQLiteNow(code, 'visited', true);
          // Persist homeCountry to SQLite as backup for migration reliability
          // (Zustand persist rehydration can lose in-memory state)
          saveHomeCountry(code).catch((err) =>
            console.warn('Failed to save homeCountry to SQLite:', err)
          );
        }
      },

      setDreamDestination: (code) => {
        const prev = get().dreamDestination;
        set({ dreamDestination: code });
        // Dream destination is a single, deliberate selection — sync immediately.
        if (prev && prev !== code) {
          syncToSQLiteNow(prev, 'wishlist', false);
        }
        if (code) {
          syncToSQLiteNow(code, 'wishlist', true);
        }
      },

      toggleBucketListCountry: (countryCode) => {
        const current = get().bucketListCountries;
        const isAdding = !current.includes(countryCode);
        const updated = isAdding
          ? [...current, countryCode]
          : current.filter((c) => c !== countryCode);
        // UI state updates synchronously; persistence side effects are batched.
        set({ bucketListCountries: updated });
        queueSQLiteChange(countryCode, 'wishlist', isAdding);
      },

      addVisitedContinent: (region) => {
        const current = get().visitedContinents;
        if (!current.includes(region)) {
          set({ visitedContinents: [...current, region] });
        }
      },

      removeVisitedContinent: (region) => {
        const current = get().visitedContinents;
        set({ visitedContinents: current.filter((r) => r !== region) });
      },

      setDisplayName: (name) => set({ displayName: name }),

      setTrackingPreference: (preference) => set({ trackingPreference: preference }),

      setCountryGridTooltipShown: (shown) => set({ countryGridTooltipShown: shown }),

      flushPersistence: () => flushOnboardingPersistence(),

      reset: () => {
        // Drop any pending batched grid changes so a stale add/remove cannot
        // resurrect cleared state after the reset.
        pendingSqlite.clear();
        if (sqliteTimer) {
          clearTimeout(sqliteTimer);
          sqliteTimer = null;
        }
        set(initialState);
        // Clear SQLite user countries when resetting onboarding
        clearLocalUserCountries().catch((err) =>
          console.warn('Failed to clear SQLite user countries:', err)
        );
        clearHomeCountry().catch((err) =>
          console.warn('Failed to clear SQLite home country:', err)
        );
      },
    }),
    {
      name: 'onboarding-storage',
      storage: createJSONStorage(() => onboardingPersistStorage),
    }
  )
);

// Selectors - use these to prevent re-renders when unrelated state changes
export const selectMotivationTags = (state: OnboardingState) => state.motivationTags;
export const selectSelectedCountries = (state: OnboardingState) => state.selectedCountries;
export const selectCurrentStep = (state: OnboardingState) => state.currentStep;
export const selectPersonaTags = (state: OnboardingState) => state.personaTags;
export const selectHomeCountry = (state: OnboardingState) => state.homeCountry;
export const selectDreamDestination = (state: OnboardingState) => state.dreamDestination;
export const selectBucketListCountries = (state: OnboardingState) => state.bucketListCountries;
export const selectVisitedContinents = (state: OnboardingState) => state.visitedContinents;
export const selectDisplayName = (state: OnboardingState) => state.displayName;
export const selectTrackingPreference = (state: OnboardingState) => state.trackingPreference;
export const selectCountryGridTooltipShown = (state: OnboardingState) =>
  state.countryGridTooltipShown;
