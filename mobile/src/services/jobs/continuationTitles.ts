/**
 * continuationTitles - What the system progress UI says about a running job.
 *
 * Sourced from the `scanCopy` vocabulary (library, scan, check, found,
 * location data) and subject to the same ban: nothing here says "background"
 * or "while the app is closed". Titles are per kind; subtitles follow the
 * store's `progress.phase`.
 */

import type { LibraryJobKind } from './jobTypes';

export interface ContinuationTitle {
  title: string;
  subtitle: string;
}

const TRIP_SCAN_TITLE = 'Photo scan';
const QUIZ_BUILD_TITLE = 'Building your challenge';

const TRIP_SCAN_SUBTITLES: Record<string, string> = {
  counting: 'Counting your photos',
  scanning: 'Reading your library',
  geocoding: 'Working out where they were taken',
  complete: 'Building your trips',
};

const QUIZ_BUILD_SUBTITLES: Record<string, string> = {
  scanning: 'Reading your library',
  checking: 'Finding photos that make good questions',
  building: 'Uploading the photos your challenge uses',
};

export function continuationTitle(kind: LibraryJobKind, phase?: string | null): ContinuationTitle {
  if (kind === 'quiz-build') {
    return {
      title: QUIZ_BUILD_TITLE,
      subtitle: (phase && QUIZ_BUILD_SUBTITLES[phase]) || QUIZ_BUILD_SUBTITLES.scanning,
    };
  }
  return {
    title: TRIP_SCAN_TITLE,
    subtitle: (phase && TRIP_SCAN_SUBTITLES[phase]) || TRIP_SCAN_SUBTITLES.scanning,
  };
}

/** Every string above, for the banned-phrase test. */
export function allContinuationTitleStrings(): string[] {
  return [
    TRIP_SCAN_TITLE,
    QUIZ_BUILD_TITLE,
    ...Object.values(TRIP_SCAN_SUBTITLES),
    ...Object.values(QUIZ_BUILD_SUBTITLES),
  ];
}
