import { resetPhotoScanStore, usePhotoScanStore } from '@stores/photoScanStore';

describe('photoScanStore', () => {
  beforeEach(() => {
    resetPhotoScanStore();
  });

  it('starts in idle state with no progress, no countries, no failure, no result', () => {
    const state = usePhotoScanStore.getState();
    expect(state.phase).toBe('idle');
    expect(state.progress).toBeNull();
    expect(state.discoveredCountries).toEqual([]);
    expect(state.isIncremental).toBe(false);
    expect(state.scanFailure).toBeNull();
    expect(state.hasResult).toBe(false);
  });

  it('reset returns to initial state from any populated state', () => {
    usePhotoScanStore.setState({
      phase: 'completed',
      progress: { phase: 'complete', current: 100, total: 100, percentage: 100 },
      discoveredCountries: [{ code: 'JP', name: 'Japan' }],
      isIncremental: true,
      scanFailure: { reason: 'no-trips', title: 't', message: 'm' },
      hasResult: true,
    });

    resetPhotoScanStore();

    const state = usePhotoScanStore.getState();
    expect(state.phase).toBe('idle');
    expect(state.progress).toBeNull();
    expect(state.discoveredCountries).toEqual([]);
    expect(state.isIncremental).toBe(false);
    expect(state.scanFailure).toBeNull();
    expect(state.hasResult).toBe(false);
  });

  it('store schema does not contain heavyweight Map fields', () => {
    const state = usePhotoScanStore.getState();
    // Sanity check that nobody added Maps to the store. Maps would silently
    // become {} if persist middleware were ever added.
    for (const value of Object.values(state)) {
      expect(value instanceof Map).toBe(false);
    }
  });

  it('progress updates do not clobber unrelated state', () => {
    usePhotoScanStore.setState({
      phase: 'scanning',
      discoveredCountries: [{ code: 'JP', name: 'Japan' }],
    });

    usePhotoScanStore.setState({
      progress: { phase: 'scanning', current: 50, total: 100, percentage: 50 },
    });

    const state = usePhotoScanStore.getState();
    expect(state.phase).toBe('scanning');
    expect(state.discoveredCountries).toEqual([{ code: 'JP', name: 'Japan' }]);
    expect(state.progress?.percentage).toBe(50);
  });
});
