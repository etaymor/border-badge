import { boundCountryPreviews } from '@services/quiz/quizBuildJob';
import type { CountryPreviewRow } from '@services/photoImport/scanPreviewPicker';
import { patchJobSlice, resetJobSlice, useLibraryJobStore } from '@stores/libraryJobStore';

describe('quiz build country preview publishing', () => {
  it('caps the job detail at ten countries and two previews per country', () => {
    const rows: CountryPreviewRow[] = Array.from({ length: 12 }, (_, countryIndex) => ({
      code: `C${countryIndex}`,
      name: `Country ${countryIndex}`,
      previews: Array.from({ length: 3 }, (_, previewIndex) => ({
        assetId: `${countryIndex}-${previewIndex}`,
        uri: `file:///${countryIndex}-${previewIndex}.jpg`,
      })),
    }));

    const bounded = boundCountryPreviews(rows);

    expect(bounded).toHaveLength(10);
    expect(bounded.every((row) => row.previews.length === 2)).toBe(true);
  });

  it('clears preview rows when the quiz build slice resets', () => {
    patchJobSlice('quiz-build', {
      detail: {
        step: 'scanning',
        pickUris: [],
        examined: 0,
        countryPreviews: [
          {
            code: 'PT',
            name: 'Portugal',
            previews: [{ assetId: 'pt-1', uri: 'file:///pt-1.jpg' }],
          },
        ],
      },
    });

    resetJobSlice('quiz-build');

    expect(useLibraryJobStore.getState().jobs['quiz-build'].detail.countryPreviews).toEqual([]);
  });
});
