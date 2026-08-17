/**
 * The vision eligibility pass (R2): deciding which candidate photos are safe
 * and suitable to show publicly as a "guess where" puzzle.
 *
 * The pass is metered twice over, and the two meters count different things:
 * - `classifiedIds` is every photo ATTEMPTED, so a resample never re-draws one
 * - `sentCount` is every image the SERVER received, which is what its
 *   per-draft budget actually charges for
 *
 * Conflating them stranded roughly a third of the budget on photos that never
 * left the device.
 */

import { features } from '@config/features';
import { api } from '@services/api';

import { PREPARE_CONCURRENCY, prepareCandidateImage } from './quizImagePrep';
import { isBudgetExceededError, isDraftGoneError } from './quizHttpErrors';
import { recordVerdicts } from './quizVerdictStore';

import { QUIZ_MAX_PHOTOS } from './candidateSelection';

import type { GeoEligibleCandidate } from './candidateSelection';
import type { QuizCreationProgress } from './quizCreationTypes';

/**
 * How many candidates to draw per image we intend to send. On a real library
 * roughly half of the cached URIs no longer load, so drawing exactly as many
 * candidates as the batch wants left the classifier with half a batch. Drawing
 * deeper costs only local ordering work - the server budget is charged per
 * image SENT - and unused candidates stay available to the next pass.
 */
export const CANDIDATE_OVERSELECT = 3;

/**
 * Per-request timeout for the eligibility call, overriding the api client's
 * 30s default.
 *
 * The server classifies one image per model call, five at a time
 * (MAX_CONCURRENT_VISION_REQUESTS), each with a 5s timeout - so a 50-image
 * batch is ten waves and can legitimately take ~50s. Under the 30s default the
 * client hung up on batches the server had ALREADY charged to the draft's
 * budget, and reported a retryable outage for work that was about to succeed.
 * 90s matches SUGGEST_PLACES_TIMEOUT_MS, which exists for the same reason.
 */
export const QUIZ_ELIGIBILITY_TIMEOUT_MS = 90_000;

interface EligibilityResult {
  id: string;
  eligible: boolean;
  status: 'eligible' | 'ineligible' | 'error';
  reason?: string | null;
  landscape?: string | null;
}

interface EligibilityResponse {
  results: EligibilityResult[];
  classified_count: number;
  budget_remaining: number;
}

export type ClassifyBatchResult =
  | { budgetRemaining: number }
  /**
   * Not one candidate in this batch could be turned into bytes locally, so
   * nothing was sent. DISTINCT from 'unavailable': the service is fine, these
   * particular photos are unreadable (iCloud-offloaded originals, ~45% of
   * candidates on a real optimized library). The caller should draw again
   * rather than abort - reporting an outage here ended creations that had
   * thousands of readable photos left.
   */
  | 'no-images'
  /** Transport/5xx outage - retryable. */
  | 'unavailable'
  /** 404: the server draft is gone - clear the local mirror and start fresh. */
  | 'draft-gone'
  /** 429 budget-exceeded - terminal for classification; build from what we have. */
  | 'budget-exceeded';

/**
 * Running state of one creation's classification passes.
 *
 * `reasons` tallies WHY photos were rejected (people_present / indoor /
 * category_not_allowed / unclassifiable, plus the local `prepare_failed`).
 * The server has always returned a per-image reason and the client has always
 * thrown it away, which is why a thin-library decline was indistinguishable
 * from a vision outage - both looked like "0 eligible".
 */
export interface ClassificationSession {
  classifiedIds: Set<string>;
  eligible: GeoEligibleCandidate[];
  reasons: Record<string, number>;
  /**
   * Images the SERVER actually received. The per-draft budget belongs to the
   * server, and it only charges for images it was sent - counting locally
   * unreadable photos against it ended runs with a third of the budget unspent.
   */
  sentCount: number;
  /** Prepare failures whose cached URI was a ph:// asset (iCloud-offloaded). */
  offloadedFailures: number;
  /**
   * Per-photo gate verdict for THIS run, id -> eligible.
   *
   * Every entry is a free labeled example: the paid gate's opinion of a photo
   * the on-device pre-filter also had an opinion about. Comparing the two is
   * the only evidence that can justify tightening the drop rules, so the
   * per-photo answer is kept rather than only tallied.
   */
  verdictsById: Map<string, boolean>;
}

export function createClassificationSession(): ClassificationSession {
  return {
    classifiedIds: new Set<string>(),
    eligible: [],
    reasons: {},
    sentCount: 0,
    offloadedFailures: 0,
    verdictsById: new Map<string, boolean>(),
  };
}

function tally(session: ClassificationSession, reason: string): void {
  session.reasons[reason] = (session.reasons[reason] ?? 0) + 1;
}

/**
 * Report progress as PHOTOS FOUND, not images checked.
 *
 * The old per-batch `images.length / targetCount` restarted at zero on every
 * pass, so a creation that drew six batches looked like it kept losing its
 * place. Counting eligible photos against the game size is the only number
 * here that means anything to someone waiting - and it is monotonic across
 * however many passes the hunt takes.
 */
export function reportFound(
  session: ClassificationSession,
  onProgress: ((progress: QuizCreationProgress) => void) | undefined
): void {
  onProgress?.({
    step: 'checking',
    current: Math.min(session.eligible.length, QUIZ_MAX_PHOTOS),
    total: QUIZ_MAX_PHOTOS,
  });
}

/** The rejection reason that best explains a decline, or null when unclear. */
export function dominantRejectionReason(reasons: Record<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [reason, count] of Object.entries(reasons)) {
    if (reason !== 'eligible' && count > bestCount) {
      best = reason;
      bestCount = count;
    }
  }
  return best;
}

/** One line naming where the candidates went, for the creation funnel log. */
export function summarizeRejections(session: ClassificationSession): string {
  return Object.entries(session.reasons)
    .filter(([reason]) => reason !== 'eligible')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, count]) => `${reason}=${count}`)
    .join(' ');
}

/**
 * Send one batch through POST /quiz/eligibility.
 *
 * `candidates` is deliberately LONGER than `targetCount`: on a large library a
 * large share of cached URIs no longer load (iCloud-offloaded originals), and
 * preparing exactly targetCount candidates handed the classifier a half-empty
 * batch. Photos are prepared in candidate order until targetCount images are
 * in hand or the candidates run out, so a local failure costs one more draw
 * rather than one fewer question. Candidates never reached are left untouched
 * for the next pass.
 *
 * "error" statuses (transport failures inside the vision service) do not
 * produce verdicts; a batch with zero verdicts is a retryable outage.
 */
export async function classifyBatch(
  quizId: string,
  candidates: GeoEligibleCandidate[],
  targetCount: number,
  session: ClassificationSession,
  onProgress: ((progress: QuizCreationProgress) => void) | undefined
): Promise<ClassifyBatchResult> {
  const { classifiedIds, eligible } = session;
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const images: Array<{ id: string; image_base64: string }> = [];

  let cursor = 0;
  while (cursor < candidates.length && images.length < targetCount) {
    reportFound(session, onProgress);
    // 768px JPEG thumbnails via the existing vision pipeline (KTD5), prepared
    // a bounded chunk at a time; results keep the batch's candidate order. The
    // chunk narrows near the target so a full-width final chunk cannot
    // overshoot and overspend the budget.
    const chunk = candidates.slice(
      cursor,
      cursor + Math.min(PREPARE_CONCURRENCY, targetCount - images.length)
    );
    cursor += chunk.length;
    const prepared = await Promise.all(chunk.map(prepareCandidateImage));
    prepared.forEach((base64, index) => {
      const candidate = chunk[index];
      // Attempted either way: a resample must not re-draw this photo.
      classifiedIds.add(candidate.id);
      if (base64) {
        images.push({ id: candidate.id, image_base64: base64 });
      } else {
        tally(session, 'prepare_failed');
        if (candidate.uri.startsWith('ph://')) session.offloadedFailures += 1;
      }
    });
  }
  if (images.length === 0) {
    return 'no-images';
  }
  session.sentCount += images.length;

  let data: EligibilityResponse;
  try {
    ({ data } = await api.post<EligibilityResponse>(
      '/quiz/eligibility',
      { quiz_id: quizId, images },
      { timeout: QUIZ_ELIGIBILITY_TIMEOUT_MS }
    ));
  } catch (error) {
    // A 404 (draft gone) or 429 (budget exceeded) is NOT a transport failure:
    // retrying can never succeed, so neither maps to the retryable outage.
    if (isDraftGoneError(error)) return 'draft-gone';
    if (isBudgetExceededError(error)) return 'budget-exceeded';
    return 'unavailable';
  }

  let sawVerdict = false;
  // Cache BOTH outcomes. The ineligible half is the more valuable one: it is
  // what keeps the next hunt from re-drawing photos this one already paid to
  // reject. Only `error` results are skipped - they are the server failing to
  // form an opinion, not an opinion.
  const toCache: Array<{
    id: string;
    eligible: boolean;
    reason: string | null;
    landscape: string | null;
  }> = [];
  for (const result of data.results) {
    if (result.status === 'error') {
      tally(session, 'service_error');
      continue;
    }
    sawVerdict = true;
    session.verdictsById.set(result.id, result.eligible);
    const candidate = byId.get(result.id);
    if (candidate && result.eligible) {
      candidate.landscape = result.landscape ?? undefined;
      eligible.push(candidate);
      tally(session, 'eligible');
      toCache.push({
        id: result.id,
        eligible: true,
        reason: null,
        landscape: result.landscape ?? null,
      });
    } else {
      tally(session, result.reason ?? 'ineligible');
      toCache.push({
        id: result.id,
        eligible: false,
        reason: result.reason ?? 'ineligible',
        landscape: null,
      });
    }
  }
  if (features.enableVerdictCache) recordVerdicts(toCache);
  reportFound(session, onProgress);
  if (!sawVerdict) {
    return 'unavailable';
  }
  return { budgetRemaining: data.budget_remaining };
}
