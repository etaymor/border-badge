import AsyncStorage from '@react-native-async-storage/async-storage';
import { removeLocalUserCountry, saveLocalUserCountry } from '@services/countriesDb';

import {
  __resetOnboardingSQLiteQueueForTests,
  flushOnboardingPersistence,
  ONBOARDING_PERSIST_DEBOUNCE_MS,
  useOnboardingStore,
} from '@stores/onboardingStore';

// Mock ONLY react-native's AppState module (not the whole of react-native,
// which would eagerly evaluate native module getters and crash under jest-expo).
// `react-native`'s `AppState` export is a lazy getter that requires this file,
// so mocking it here lets us capture the 'change' handler the store registers
// at import time and simulate app backgrounding without a real device.
jest.mock('react-native/Libraries/AppState/AppState', () => ({
  __esModule: true,
  default: {
    currentState: 'active',
    addEventListener: jest.fn((_event: string, handler: (state: string) => void) => {
      (global as Record<string, unknown>).__onboardingAppStateHandler = handler;
      return { remove: jest.fn() };
    }),
  },
}));

const mockAsyncStorageSetItem = AsyncStorage.setItem as jest.Mock;
const mockSaveLocalUserCountry = saveLocalUserCountry as jest.Mock;
const mockRemoveLocalUserCountry = removeLocalUserCountry as jest.Mock;

/** Invoke the store's registered AppState change handler (simulate backgrounding). */
function emitAppStateChange(state: string): void {
  const handler = (global as Record<string, unknown>).__onboardingAppStateHandler as
    | ((s: string) => void)
    | undefined;
  handler?.(state);
}

describe('onboardingStore', () => {
  beforeEach(() => {
    // Drop any pending batched SQLite changes leaked from a prior test so the
    // module-level queue/timer singletons don't bleed across cases.
    __resetOnboardingSQLiteQueueForTests();
    // Reset store to initial state before each test
    useOnboardingStore.setState({
      motivationTags: [],
      selectedCountries: [],
      currentStep: 0,
      personaTags: [],
      homeCountry: null,
      dreamDestination: null,
      bucketListCountries: [],
      visitedContinents: [],
    });
  });

  it('starts with initial state', () => {
    const state = useOnboardingStore.getState();

    expect(state.motivationTags).toEqual([]);
    expect(state.selectedCountries).toEqual([]);
    expect(state.currentStep).toBe(0);
    expect(state.personaTags).toEqual([]);
    expect(state.homeCountry).toBeNull();
    expect(state.dreamDestination).toBeNull();
    expect(state.bucketListCountries).toEqual([]);
    expect(state.visitedContinents).toEqual([]);
  });

  describe('motivationTags', () => {
    it('sets motivation tags', () => {
      const tags = ['Adventure', 'Culture', 'Food'];

      useOnboardingStore.getState().setMotivationTags(tags);

      expect(useOnboardingStore.getState().motivationTags).toEqual(tags);
    });

    it('toggles motivation tag on', () => {
      useOnboardingStore.getState().toggleMotivationTag('Adventure');

      expect(useOnboardingStore.getState().motivationTags).toContain('Adventure');
    });

    it('toggles motivation tag off', () => {
      useOnboardingStore.setState({ motivationTags: ['Adventure', 'Culture'] });

      useOnboardingStore.getState().toggleMotivationTag('Adventure');

      expect(useOnboardingStore.getState().motivationTags).not.toContain('Adventure');
      expect(useOnboardingStore.getState().motivationTags).toContain('Culture');
    });
  });

  describe('personaTags', () => {
    it('sets persona tags', () => {
      const tags = ['Explorer', 'Foodie'];

      useOnboardingStore.getState().setPersonaTags(tags);

      expect(useOnboardingStore.getState().personaTags).toEqual(tags);
    });

    it('toggles persona tag on', () => {
      useOnboardingStore.getState().togglePersonaTag('Explorer');

      expect(useOnboardingStore.getState().personaTags).toContain('Explorer');
    });

    it('toggles persona tag off', () => {
      useOnboardingStore.setState({ personaTags: ['Explorer', 'Foodie'] });

      useOnboardingStore.getState().togglePersonaTag('Explorer');

      expect(useOnboardingStore.getState().personaTags).not.toContain('Explorer');
      expect(useOnboardingStore.getState().personaTags).toContain('Foodie');
    });
  });

  describe('selectedCountries', () => {
    it('sets selected countries', () => {
      const countries = ['US', 'CA', 'MX'];

      useOnboardingStore.getState().setSelectedCountries(countries);

      expect(useOnboardingStore.getState().selectedCountries).toEqual(countries);
    });

    it('toggles country on', () => {
      useOnboardingStore.getState().toggleCountry('US');

      expect(useOnboardingStore.getState().selectedCountries).toContain('US');
    });

    it('toggles country off', () => {
      useOnboardingStore.setState({ selectedCountries: ['US', 'CA'] });

      useOnboardingStore.getState().toggleCountry('US');

      expect(useOnboardingStore.getState().selectedCountries).not.toContain('US');
      expect(useOnboardingStore.getState().selectedCountries).toContain('CA');
    });
  });

  describe('homeCountry', () => {
    it('sets home country', () => {
      useOnboardingStore.getState().setHomeCountry('US');

      expect(useOnboardingStore.getState().homeCountry).toBe('US');
    });

    it('clears home country', () => {
      useOnboardingStore.setState({ homeCountry: 'US' });

      useOnboardingStore.getState().setHomeCountry(null);

      expect(useOnboardingStore.getState().homeCountry).toBeNull();
    });
  });

  describe('dreamDestination', () => {
    it('sets dream destination', () => {
      useOnboardingStore.getState().setDreamDestination('JP');

      expect(useOnboardingStore.getState().dreamDestination).toBe('JP');
    });

    it('clears dream destination', () => {
      useOnboardingStore.setState({ dreamDestination: 'JP' });

      useOnboardingStore.getState().setDreamDestination(null);

      expect(useOnboardingStore.getState().dreamDestination).toBeNull();
    });
  });

  describe('bucketListCountries', () => {
    it('toggles bucket list country on', () => {
      useOnboardingStore.getState().toggleBucketListCountry('JP');

      expect(useOnboardingStore.getState().bucketListCountries).toContain('JP');
    });

    it('toggles bucket list country off', () => {
      useOnboardingStore.setState({ bucketListCountries: ['JP', 'IT'] });

      useOnboardingStore.getState().toggleBucketListCountry('JP');

      expect(useOnboardingStore.getState().bucketListCountries).not.toContain('JP');
      expect(useOnboardingStore.getState().bucketListCountries).toContain('IT');
    });
  });

  describe('visitedContinents', () => {
    it('adds visited continent', () => {
      useOnboardingStore.getState().addVisitedContinent('Europe');

      expect(useOnboardingStore.getState().visitedContinents).toContain('Europe');
    });

    it('does not add duplicate continent', () => {
      useOnboardingStore.setState({ visitedContinents: ['Europe'] });

      useOnboardingStore.getState().addVisitedContinent('Europe');

      expect(useOnboardingStore.getState().visitedContinents).toEqual(['Europe']);
    });

    it('removes visited continent', () => {
      useOnboardingStore.setState({ visitedContinents: ['Europe', 'Asia'] });

      useOnboardingStore.getState().removeVisitedContinent('Europe');

      expect(useOnboardingStore.getState().visitedContinents).not.toContain('Europe');
      expect(useOnboardingStore.getState().visitedContinents).toContain('Asia');
    });
  });

  describe('currentStep', () => {
    it('sets current step', () => {
      useOnboardingStore.getState().setCurrentStep(2);

      expect(useOnboardingStore.getState().currentStep).toBe(2);
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', () => {
      useOnboardingStore.setState({
        motivationTags: ['Adventure', 'Culture'],
        selectedCountries: ['US', 'CA'],
        currentStep: 2,
        personaTags: ['Explorer'],
        homeCountry: 'US',
        dreamDestination: 'JP',
        bucketListCountries: ['JP', 'IT'],
        visitedContinents: ['Europe', 'Asia'],
      });

      useOnboardingStore.getState().reset();

      const state = useOnboardingStore.getState();
      expect(state.motivationTags).toEqual([]);
      expect(state.selectedCountries).toEqual([]);
      expect(state.currentStep).toBe(0);
      expect(state.personaTags).toEqual([]);
      expect(state.homeCountry).toBeNull();
      expect(state.dreamDestination).toBeNull();
      expect(state.bucketListCountries).toEqual([]);
      expect(state.visitedContinents).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // U4: batched / debounced persistence (R5)
  // -------------------------------------------------------------------------
  describe('debounced AsyncStorage persistence', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      // Flush any leftover debounce timers and clear mock history so each test
      // starts from a clean write count. setState above already dirtied the
      // pending write; run its timer out and reset counters.
      jest.runOnlyPendingTimers();
      mockAsyncStorageSetItem.mockClear();
    });

    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    });

    it('coalesces 10 rapid toggleCountry calls into a single setItem write', () => {
      const codes = ['US', 'CA', 'MX', 'JP', 'IT', 'FR', 'DE', 'ES', 'BR', 'AU'];
      codes.forEach((code) => useOnboardingStore.getState().toggleCountry(code));

      // Before the debounce window elapses, no write has landed.
      expect(mockAsyncStorageSetItem).not.toHaveBeenCalled();

      // In-memory state is already updated synchronously (badge/progress instant).
      expect(useOnboardingStore.getState().selectedCountries).toEqual(codes);

      jest.advanceTimersByTime(ONBOARDING_PERSIST_DEBOUNCE_MS);

      expect(mockAsyncStorageSetItem).toHaveBeenCalledTimes(1);
    });

    it('does not write before the debounce window elapses', () => {
      useOnboardingStore.getState().toggleCountry('US');
      jest.advanceTimersByTime(ONBOARDING_PERSIST_DEBOUNCE_MS - 1);
      expect(mockAsyncStorageSetItem).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(mockAsyncStorageSetItem).toHaveBeenCalledTimes(1);
    });

    it('persisted JSON round-trips the exact selected-country set after flush', async () => {
      const codes = ['US', 'CA', 'MX'];
      codes.forEach((code) => useOnboardingStore.getState().toggleCountry(code));

      await flushOnboardingPersistence();

      expect(mockAsyncStorageSetItem).toHaveBeenCalledTimes(1);
      const [, rawValue] = mockAsyncStorageSetItem.mock.calls[0];
      const persisted = JSON.parse(rawValue);
      expect(persisted.state.selectedCountries).toEqual(codes);
    });

    it('flushes the pending write immediately on flushOnboardingPersistence()', async () => {
      useOnboardingStore.getState().toggleCountry('US');
      expect(mockAsyncStorageSetItem).not.toHaveBeenCalled();

      await flushOnboardingPersistence();

      expect(mockAsyncStorageSetItem).toHaveBeenCalledTimes(1);
    });

    it('flushes the pending write when the app goes to background', async () => {
      useOnboardingStore.getState().toggleCountry('US');
      expect(mockAsyncStorageSetItem).not.toHaveBeenCalled();

      emitAppStateChange('background');
      // Let the async flush microtasks settle.
      await Promise.resolve();
      await Promise.resolve();

      expect(mockAsyncStorageSetItem).toHaveBeenCalledTimes(1);
    });
  });

  describe('batched SQLite sync', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.runOnlyPendingTimers();
      mockSaveLocalUserCountry.mockClear();
      mockRemoveLocalUserCountry.mockClear();
    });

    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    });

    it('does not sync each intermediate toggle synchronously', () => {
      ['A', 'B', 'C'].forEach((code) => useOnboardingStore.getState().toggleCountry(code));

      // No per-tap writes before the batch flush.
      expect(mockSaveLocalUserCountry).not.toHaveBeenCalled();
    });

    it('syncs the batched final state once the window elapses (A,B,C -> 3 saves)', () => {
      ['A', 'B', 'C'].forEach((code) => useOnboardingStore.getState().toggleCountry(code));

      jest.advanceTimersByTime(ONBOARDING_PERSIST_DEBOUNCE_MS);

      expect(mockSaveLocalUserCountry).toHaveBeenCalledTimes(3);
      expect(mockRemoveLocalUserCountry).not.toHaveBeenCalled();
      const savedCodes = mockSaveLocalUserCountry.mock.calls.map(([arg]) => arg.country_code);
      expect(savedCodes.sort()).toEqual(['A', 'B', 'C']);
    });

    it('toggling a country on then off within the window nets to no save', () => {
      useOnboardingStore.getState().toggleCountry('A'); // add
      useOnboardingStore.getState().toggleCountry('A'); // remove (net zero for state)

      expect(useOnboardingStore.getState().selectedCountries).not.toContain('A');

      jest.advanceTimersByTime(ONBOARDING_PERSIST_DEBOUNCE_MS);

      // Net effect: no add persisted. A remove may fire (harmless no-op in db),
      // but crucially there must be NO stale save for A.
      expect(mockSaveLocalUserCountry).not.toHaveBeenCalled();
    });

    it('batches wishlist (bucket list) toggles the same way', () => {
      ['JP', 'IT'].forEach((code) => useOnboardingStore.getState().toggleBucketListCountry(code));

      expect(mockSaveLocalUserCountry).not.toHaveBeenCalled();

      jest.advanceTimersByTime(ONBOARDING_PERSIST_DEBOUNCE_MS);

      expect(mockSaveLocalUserCountry).toHaveBeenCalledTimes(2);
      const statuses = mockSaveLocalUserCountry.mock.calls.map(([arg]) => arg.status);
      expect(statuses).toEqual(['wishlist', 'wishlist']);
    });

    it('flushOnboardingPersistence drains pending SQLite changes immediately', async () => {
      useOnboardingStore.getState().toggleCountry('A');
      expect(mockSaveLocalUserCountry).not.toHaveBeenCalled();

      await flushOnboardingPersistence();

      expect(mockSaveLocalUserCountry).toHaveBeenCalledTimes(1);
      expect(mockSaveLocalUserCountry.mock.calls[0][0].country_code).toBe('A');
    });
  });

  describe('AppState listener registration', () => {
    it('registered a change handler at module load (captured for backgrounding)', () => {
      // clearAllMocks() (global beforeEach) wipes the import-time call history,
      // so assert on the captured handler instead: its presence proves the store
      // called AppState.addEventListener('change', ...) at import.
      const handler = (global as Record<string, unknown>).__onboardingAppStateHandler;
      expect(typeof handler).toBe('function');
    });

    it('flushes only on background/inactive, not on becoming active', async () => {
      useOnboardingStore.getState().toggleCountry('US');
      const setItem = AsyncStorage.setItem as jest.Mock;
      setItem.mockClear();

      emitAppStateChange('active');
      await Promise.resolve();
      expect(setItem).not.toHaveBeenCalled();

      emitAppStateChange('inactive');
      await Promise.resolve();
      await Promise.resolve();
      expect(setItem).toHaveBeenCalledTimes(1);
    });
  });
});
