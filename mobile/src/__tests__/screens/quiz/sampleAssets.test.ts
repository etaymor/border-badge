import {
  demoCountry,
  demoOptions,
  demoPhoto,
  guessWhereMark,
  introPoster,
  introVideo,
  resultsAccent,
} from '../../../screens/quiz/sampleAssets';

describe('quiz sampleAssets', () => {
  it('resolves every bundled asset', () => {
    expect(introVideo).toBeTruthy();
    expect(introPoster).toBeTruthy();
    expect(demoPhoto).toBeTruthy();
    expect(guessWhereMark).toBeTruthy();
    expect(resultsAccent).toBeTruthy();
  });

  it('has exactly four demo options', () => {
    expect(demoOptions).toHaveLength(4);
  });

  it('includes the correct country among the demo options', () => {
    expect(demoOptions).toContain(demoCountry);
  });

  it('has no duplicate demo options', () => {
    expect(new Set(demoOptions).size).toBe(demoOptions.length);
  });
});
