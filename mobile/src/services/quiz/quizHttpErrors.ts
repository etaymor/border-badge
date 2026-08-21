/**
 * Response classification for the quiz endpoints.
 *
 * Two failures must never be mistaken for a generic outage, because retrying
 * either one can only make things worse: a 404 means the server draft is gone
 * (retry loops forever), and a budget-exceeded 429 means classification is
 * finished for this draft (retry re-spends money for nothing).
 */

interface HttpErrorLike {
  response?: {
    status?: number;
    data?: { detail?: string | { code?: string } };
  };
}

function httpStatus(error: unknown): number | null {
  const status = (error as HttpErrorLike)?.response?.status;
  return typeof status === 'number' ? status : null;
}

function httpDetailCode(error: unknown): string | null {
  const detail = (error as HttpErrorLike)?.response?.data?.detail;
  if (detail && typeof detail === 'object' && typeof detail.code === 'string') {
    return detail.code;
  }
  return null;
}

/** The server draft no longer exists (owner deleted it / it was purged). */
export function isDraftGoneError(error: unknown): boolean {
  return httpStatus(error) === 404;
}

/**
 * The per-draft classification budget is spent (429 with the explicit code).
 * NOT a transport failure: retrying never succeeds, and re-classifying only
 * re-spends budget - the flow must proceed with what is already eligible.
 */
export function isBudgetExceededError(error: unknown): boolean {
  return (
    httpStatus(error) === 429 && httpDetailCode(error) === 'QUIZ_CLASSIFICATION_BUDGET_EXCEEDED'
  );
}
