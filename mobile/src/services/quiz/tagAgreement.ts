/**
 * Comparing the free on-device prediction against the paid gate's verdict.
 *
 * Every classified photo that also carried a tag tier is a free labeled
 * example, and this is the only evidence that can justify tightening the drop
 * rules. Release 1 ships in shadow mode - aggressive ranking, three
 * near-certain drops - precisely because nobody has that evidence yet.
 *
 * The number to watch is `likelyRejected`: photos the device called `likely`
 * that the gate then rejected. A high count means the "likely" signal is
 * unreliable and must not become a drop. The mirror number, `marginalPassed`,
 * is the false-negative estimate for any FUTURE drop rule aimed at `marginal`:
 * every one of those photos would have been thrown away unseen.
 */

import type { PrefilterTier } from './tagSignals';

export interface TierAgreement {
  sent: number;
  passed: number;
}

export interface PrefilterAgreement {
  byTier: Record<PrefilterTier, TierAgreement>;
  /** Photos predicted `likely` that the gate rejected. */
  likelyRejected: number;
  /**
   * Photos predicted `marginal` that the gate PASSED - the photos a marginal
   * drop rule would have silently cost the user.
   */
  marginalPassed: number;
  /** Total photos that had both a prediction and a verdict. */
  compared: number;
}

const emptyAgreement = (): Record<PrefilterTier, TierAgreement> => ({
  drop: { sent: 0, passed: 0 },
  likely: { sent: 0, passed: 0 },
  unknown: { sent: 0, passed: 0 },
  marginal: { sent: 0, passed: 0 },
});

/**
 * Join this run's gate verdicts against the tiers predicted for the same
 * photos. Ids without a prediction (untagged) are skipped: they carry no
 * signal, so counting them would dilute the very rates we are measuring.
 */
export function computeAgreement(
  verdictsById: Map<string, boolean>,
  tierById: Map<string, PrefilterTier>
): PrefilterAgreement {
  const byTier = emptyAgreement();
  let likelyRejected = 0;
  let marginalPassed = 0;
  let compared = 0;

  for (const [id, eligible] of verdictsById) {
    const tier = tierById.get(id);
    if (!tier) continue;
    compared += 1;
    byTier[tier].sent += 1;
    if (eligible) byTier[tier].passed += 1;
    if (tier === 'likely' && !eligible) likelyRejected += 1;
    if (tier === 'marginal' && eligible) marginalPassed += 1;
  }

  return { byTier, likelyRejected, marginalPassed, compared };
}

/** Pass rate for one tier, or null when nothing in that tier was sent. */
export function passRate(agreement: TierAgreement): number | null {
  if (agreement.sent === 0) return null;
  return agreement.passed / agreement.sent;
}
