/**
 * The system progress UI strings obey the same vocabulary ban as `scanCopy`.
 */

import { allContinuationTitleStrings, continuationTitle } from '@services/jobs/continuationTitles';

const BANNED: RegExp[] = [
  /background/i,
  /while the app is closed/i,
  /camera roll/i,
  /\bGPS\b/i,
  /\bEXIF\b/i,
  /geotag/i,
  /\bimport/i,
  /\bsync/i,
  /\bindex/i,
];

describe('continuationTitles', () => {
  it.each(allContinuationTitleStrings())('%s is clean', (value) => {
    for (const pattern of BANNED) expect(value).not.toMatch(pattern);
  });

  it('names the kind and follows the phase', () => {
    expect(continuationTitle('trip-scan', 'geocoding')).toEqual({
      title: 'Photo scan',
      subtitle: 'Working out where they were taken',
    });
    expect(continuationTitle('quiz-build', 'checking').title).toBe('Building your challenge');
    // Unknown / missing phases fall back rather than rendering nothing.
    expect(continuationTitle('quiz-build', 'nonsense').subtitle).toBe('Reading your library');
    expect(continuationTitle('trip-scan', null).subtitle).toBe('Reading your library');
  });
});
