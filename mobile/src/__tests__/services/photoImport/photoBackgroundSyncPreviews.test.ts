import { createRefreshProgressBridge } from '@services/photoImport/photoBackgroundSync';
import type { PhotoWithLocation, ScanProgress } from '@services/photoImport/types';

const PROGRESS: ScanProgress = {
  phase: 'scanning',
  current: 50,
  total: 100,
  percentage: 50,
};

describe('photoBackgroundSync progress bridge', () => {
  it('forwards batches without coupling their result to progress', () => {
    const onProgress = jest.fn();
    const onBatch = jest.fn();
    const bridge = createRefreshProgressBridge(onProgress, onBatch);
    const batch = [{ id: 'pt-1' } as PhotoWithLocation];

    bridge.handleBatch(batch);
    bridge.handleProgress(PROGRESS);
    bridge.handleProgress({ ...PROGRESS, current: 100, percentage: 100 });

    expect(onBatch).toHaveBeenCalledWith(batch);
    expect(onBatch).toHaveReturnedWith(undefined);
    expect(onProgress).toHaveBeenNthCalledWith(1, { current: 50, total: 100 });
    expect(onProgress).toHaveBeenNthCalledWith(2, { current: 100, total: 100 });
  });

  it('is backward compatible when no batch callback is supplied', () => {
    const onProgress = jest.fn();
    const bridge = createRefreshProgressBridge(onProgress);

    bridge.handleBatch([{ id: 'unused' } as PhotoWithLocation]);
    bridge.handleProgress(PROGRESS);

    expect(onProgress).toHaveBeenCalledWith({ current: 50, total: 100 });
  });
});
