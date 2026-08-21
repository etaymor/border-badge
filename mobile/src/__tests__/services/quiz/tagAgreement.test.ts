import { computeAgreement, passRate } from '@services/quiz/tagAgreement';
import type { PrefilterTier } from '@services/quiz/tagSignals';

const tiers = (entries: Array<[string, PrefilterTier]>) => new Map(entries);
const verdicts = (entries: Array<[string, boolean]>) => new Map(entries);

describe('computeAgreement', () => {
  it('counts sends and passes per tier', () => {
    const result = computeAgreement(
      verdicts([
        ['a', true],
        ['b', false],
        ['c', true],
      ]),
      tiers([
        ['a', 'likely'],
        ['b', 'likely'],
        ['c', 'marginal'],
      ])
    );

    expect(result.byTier.likely).toEqual({ sent: 2, passed: 1 });
    expect(result.byTier.marginal).toEqual({ sent: 1, passed: 1 });
    expect(result.compared).toBe(3);
  });

  it('flags likely photos the gate rejected', () => {
    // The signal that says "likely" is not trustworthy enough to become a drop.
    const result = computeAgreement(
      verdicts([
        ['a', false],
        ['b', false],
      ]),
      tiers([
        ['a', 'likely'],
        ['b', 'likely'],
      ])
    );

    expect(result.likelyRejected).toBe(2);
  });

  it('counts marginal photos the gate PASSED as the false-negative estimate', () => {
    // Each of these is a photo a future marginal-drop rule would have thrown
    // away unseen. This number is the whole argument against tightening early.
    const result = computeAgreement(
      verdicts([
        ['a', true],
        ['b', true],
        ['c', false],
      ]),
      tiers([
        ['a', 'marginal'],
        ['b', 'marginal'],
        ['c', 'marginal'],
      ])
    );

    expect(result.marginalPassed).toBe(2);
  });

  it('ignores classified photos that had no prediction', () => {
    // Untagged photos carry no signal; counting them would dilute the rates.
    const result = computeAgreement(
      verdicts([
        ['tagged', true],
        ['untagged', false],
      ]),
      tiers([['tagged', 'likely']])
    );

    expect(result.compared).toBe(1);
    expect(result.byTier.likely.sent).toBe(1);
  });

  it('ignores predictions for photos that were never classified', () => {
    const result = computeAgreement(verdicts([]), tiers([['a', 'likely']]));

    expect(result.compared).toBe(0);
    expect(result.byTier.likely.sent).toBe(0);
  });

  it('reports zeros for an empty run rather than throwing', () => {
    const result = computeAgreement(new Map(), new Map());

    expect(result).toMatchObject({ compared: 0, likelyRejected: 0, marginalPassed: 0 });
  });
});

describe('passRate', () => {
  it('is null when nothing was sent, never NaN', () => {
    // A NaN would silently poison any dashboard aggregating these.
    expect(passRate({ sent: 0, passed: 0 })).toBeNull();
  });

  it('computes the ratio', () => {
    expect(passRate({ sent: 4, passed: 1 })).toBe(0.25);
  });
});
