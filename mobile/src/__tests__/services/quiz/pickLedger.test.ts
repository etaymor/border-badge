/**
 * Tests for the pick ledger: the game is decided AS photos are found, so the
 * creation screen's live preview is the game rather than a guess at it.
 *
 * The invariant every test here defends: `picks` is append-only. A photo that
 * takes a slot keeps it for the rest of the run - through every later find,
 * and through `finalize`.
 */

import { QUIZ_MAX_PHOTOS } from '@services/quiz/candidateSelection';
import { createPickLedger } from '@services/quiz/pickLedger';
import type { GeoEligibleCandidate } from '@services/quiz/candidateSelection';

const DAY_MS = 86_400_000;
const BASE = Date.UTC(2024, 0, 1);

let idCounter = 0;

function makeCandidate(overrides: Partial<GeoEligibleCandidate> = {}): GeoEligibleCandidate {
  idCounter += 1;
  return {
    id: `photo-${idCounter}`,
    uri: `file:///photo-${idCounter}.jpg`,
    // One distinct day per candidate, and far enough apart in time that
    // nothing reads as a burst.
    creationTime: BASE + idCounter * DAY_MS,
    latitude: 48.85,
    longitude: 2.35,
    countryCode: 'FR',
    ...overrides,
  };
}

/** Candidates from n distinct days, each in its own country-year. */
function distinctCandidates(count: number): GeoEligibleCandidate[] {
  return Array.from({ length: count }, (_, index) =>
    makeCandidate({ creationTime: BASE + index * 400 * DAY_MS })
  );
}

describe('createPickLedger', () => {
  it('locks a distinct find into the next slot', () => {
    const ledger = createPickLedger();
    const candidates = distinctCandidates(3);

    expect(candidates.map((candidate) => ledger.offer(candidate))).toEqual([true, true, true]);
    expect(ledger.picks).toEqual(candidates);
    expect(ledger.bench).toEqual([]);
  });

  it('benches a repeat of the same asset id without disturbing the picks', () => {
    const ledger = createPickLedger();
    const [first] = distinctCandidates(1);

    expect(ledger.offer(first)).toBe(true);
    expect(ledger.offer(first)).toBe(false);
    expect(ledger.picks).toEqual([first]);
    // A same-id re-offer is not a bench candidate either - it is the SAME
    // photo, so promoting it later would put one photo in two slots.
    expect(ledger.bench).toEqual([]);
  });

  it('benches a second photo from a day already in the game', () => {
    const ledger = createPickLedger();
    const morning = makeCandidate({ creationTime: BASE + 9 * 3_600_000 });
    const evening = makeCandidate({ creationTime: BASE + 20 * 3_600_000 });

    expect(ledger.offer(morning)).toBe(true);
    expect(ledger.offer(evening)).toBe(false);
    expect(ledger.picks).toEqual([morning]);
    expect(ledger.bench).toEqual([evening]);
  });

  it('benches a repeat of a (country, year) pair already in the game', () => {
    const ledger = createPickLedger();
    const january = makeCandidate({ creationTime: Date.UTC(2024, 0, 5) });
    const august = makeCandidate({ creationTime: Date.UTC(2024, 7, 5) });

    expect(ledger.offer(january)).toBe(true);
    expect(ledger.offer(august)).toBe(false);
    // A different year in the same country is a different question.
    const nextYear = makeCandidate({ creationTime: Date.UTC(2025, 7, 5) });
    expect(ledger.offer(nextYear)).toBe(true);
    expect(ledger.picks).toEqual([january, nextYear]);
  });

  it('benches a burst sibling of a locked pick (BUG-2)', () => {
    const ledger = createPickLedger();
    const frame = makeCandidate({ creationTime: BASE + 12 * 3_600_000 });
    // Seconds later, metres away: the same photo as far as a player is
    // concerned - and it arrives in a LATER batch, so only a running check
    // catches it.
    const sibling = makeCandidate({
      creationTime: frame.creationTime + 4_000,
      latitude: frame.latitude + 0.0001,
      longitude: frame.longitude,
    });

    expect(ledger.offer(frame)).toBe(true);
    expect(ledger.offer(sibling)).toBe(false);
    expect(ledger.picks).toEqual([frame]);
  });

  it('stops locking once the game is full and benches the overflow', () => {
    const ledger = createPickLedger();
    const candidates = distinctCandidates(QUIZ_MAX_PHOTOS + 2);

    for (const candidate of candidates) ledger.offer(candidate);

    expect(ledger.picks).toHaveLength(QUIZ_MAX_PHOTOS);
    expect(ledger.picks).toEqual(candidates.slice(0, QUIZ_MAX_PHOTOS));
    expect(ledger.bench).toEqual(candidates.slice(QUIZ_MAX_PHOTOS));
  });

  it('finalize changes nothing when the game filled diversely', () => {
    const ledger = createPickLedger();
    const candidates = distinctCandidates(QUIZ_MAX_PHOTOS);
    for (const candidate of candidates) ledger.offer(candidate);

    expect(ledger.finalize()).toEqual(candidates);
    expect(ledger.picks).toEqual(candidates);
  });

  it('finalize tops a thin game up from the bench, appending only', () => {
    const ledger = createPickLedger();
    // One country, one year, three days: the strict pass takes the first
    // photo of each day and benches the rest.
    const days = [0, 1, 2].map((day) =>
      makeCandidate({ creationTime: Date.UTC(2024, 0, 1 + day, 9) })
    );
    const seconds = [0, 1, 2].map((day) =>
      makeCandidate({ creationTime: Date.UTC(2024, 0, 1 + day, 20) })
    );
    ledger.offer(days[0]);
    for (const candidate of [...days.slice(1), ...seconds]) ledger.offer(candidate);

    const lockedDuringHunt = [...ledger.picks];
    expect(lockedDuringHunt).toEqual([days[0]]);

    const final = ledger.finalize();
    // Everything shown during the hunt is still there, still first.
    expect(final.slice(0, lockedDuringHunt.length)).toEqual(lockedDuringHunt);
    expect(final).toHaveLength(6);
    // Pass 2 (distinct day) runs before pass 3 (anything left).
    expect(final.slice(0, 3)).toEqual(days);
  });

  it('finalize never promotes a near-duplicate of an already promoted photo', () => {
    const ledger = createPickLedger();
    const anchor = makeCandidate({ creationTime: Date.UTC(2024, 0, 1, 9) });
    // Two burst frames from a different day: both are benched by the
    // country-year rule, and pass 3 must take at most one of them.
    const burstA = makeCandidate({ creationTime: Date.UTC(2024, 0, 2, 9) });
    const burstB = makeCandidate({
      creationTime: burstA.creationTime + 5_000,
      latitude: burstA.latitude,
      longitude: burstA.longitude,
    });

    for (const candidate of [anchor, burstA, burstB]) ledger.offer(candidate);
    const final = ledger.finalize();

    expect(final).toContain(anchor);
    expect(final.filter((pick) => pick === burstA || pick === burstB)).toHaveLength(1);
  });

  it('finalize is idempotent', () => {
    const ledger = createPickLedger();
    const days = [0, 0, 1].map((day) =>
      makeCandidate({ creationTime: Date.UTC(2024, 0, 1 + day, 9 + day) })
    );
    for (const candidate of days) ledger.offer(candidate);

    const first = [...ledger.finalize()];
    expect(ledger.finalize()).toEqual(first);
  });

  it('never removes or reorders a locked pick across a whole run', () => {
    const ledger = createPickLedger();
    const snapshots: string[][] = [];
    const feed = [
      ...distinctCandidates(3),
      // Same-day and same-country-year repeats interleaved with fresh finds.
      makeCandidate({ creationTime: BASE + 3 * DAY_MS }),
      makeCandidate({ creationTime: BASE + 3 * DAY_MS + 3_600_000 }),
      ...distinctCandidates(2),
    ];

    for (const candidate of feed) {
      ledger.offer(candidate);
      snapshots.push(ledger.picks.map((pick) => pick.id));
    }
    ledger.finalize();
    snapshots.push(ledger.picks.map((pick) => pick.id));

    for (let i = 1; i < snapshots.length; i++) {
      const previous = snapshots[i - 1];
      const current = snapshots[i];
      expect(current.length).toBeGreaterThanOrEqual(previous.length);
      expect(current.slice(0, previous.length)).toEqual(previous);
    }
  });
});
