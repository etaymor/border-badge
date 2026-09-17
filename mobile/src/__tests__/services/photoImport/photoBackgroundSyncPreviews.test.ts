import { createRefreshProgressBridge } from '@services/photoImport/photoBackgroundSync';
import type { CountryPreviewRow } from '@services/photoImport/scanPreviewPicker';
import type { PhotoWithLocation, ScanProgress } from '@services/photoImport/types';

const PROGRESS: ScanProgress = {
  phase: 'scanning',
  current: 50,
  total: 100,
  percentage: 50,
};

describe('photoBackgroundSync preview progress bridge', () => {
  it('attaches changed previews once and leaves ordinary progress structurally quiet', () => {
    const rows: readonly CountryPreviewRow[] = [
      {
        code: 'PT',
        name: 'Portugal',
        previews: [{ assetId: 'pt-1', uri: 'file:///pt-1.jpg' }],
      },
    ];
    const onProgress = jest.fn();
    const onBatch = jest.fn().mockReturnValueOnce(rows).mockReturnValueOnce(undefined);
    const bridge = createRefreshProgressBridge(onProgress, onBatch);

    bridge.handleBatch([{ id: 'pt-1' } as PhotoWithLocation]);
    bridge.handleProgress(PROGRESS);
    bridge.handleProgress({ ...PROGRESS, current: 100, percentage: 100 });

    expect(onProgress).toHaveBeenNthCalledWith(1, {
      current: 50,
      total: 100,
      countryPreviews: rows,
    });
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
