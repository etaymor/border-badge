/**
 * quizCreationCopy - The two sentences the creation wizard has to compute.
 *
 * Everything the wizard says that is FIXED lives in `constants/scanCopy`. What
 * lives here is the copy that depends on runtime data the copy module has no
 * business knowing about: a build outcome's rejection reason, and a wall-clock
 * delta. Same rule as scanCopy's — anything parameterized is a function, never
 * a template assembled at the call site.
 */

import type { QuizCreationOutcome } from '@services/quiz/quizCreation';

/**
 * Name the rule that actually failed. The backend has always returned a
 * per-image rejection reason; until it was surfaced here, every decline read
 * "too few passed those checks" whether the photos had people in them, were
 * indoors, or the vision service returned nothing at all.
 */
export function thinLibraryReason(outcome: QuizCreationOutcome | null): string {
  if (outcome?.status !== 'thin-library' || !outcome.hasGeoCandidates) {
    return 'We could not find geotagged travel photos in your library.';
  }
  switch (outcome.dominantReason) {
    case 'people_present':
      return 'Most of the ones we checked had people in them.';
    case 'indoor':
      return 'Most of the ones we checked were taken indoors.';
    case 'category_not_allowed':
      return 'Most of the ones we checked were not scenery or landmarks.';
    case 'prepare_failed':
      return 'Most of the ones we checked could not be opened - they may still be in iCloud.';
    case 'unclassifiable':
    case 'service_error':
      return 'We could not read most of the ones we checked. Try again in a moment.';
    default:
      return 'We found travel photos, but too few passed those checks.';
  }
}

export function formatSyncedAgo(lastSuccessAt: number | null): string | null {
  if (!lastSuccessAt) return null;
  const minutes = Math.max(1, Math.round((Date.now() - lastSuccessAt) / 60_000));
  if (minutes < 60) return `synced ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `synced ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
}
